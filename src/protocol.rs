//! The `mark://` custom protocol: serves the app shell, the embedded assets and
//! the local files (images, fonts, media) that a document references.

use std::borrow::Cow;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use wry::http::{header, Request, Response, StatusCode, Uri};

/// Path prefix for files baked into the binary.
pub const ASSET_PREFIX: &str = "/__mark__/";
/// Path prefix for absolute paths on disk, produced by the URL rewriters in
/// `render.rs`. Absolute means the webview cannot mangle a `../` for us.
pub const FILE_PREFIX: &str = "/__file__/";

/// Extensions we are willing to hand to the webview.
///
/// A document can point at any path on disk, including `../../secrets`. Rather
/// than jail the reader to one directory -- which breaks the very common
/// `docs/page.md` referencing `../assets/logo.png` -- we only serve file types
/// that a renderer has a reason to load. `/etc/passwd` and `~/.ssh/id_rsa` are
/// not among them.
const SERVABLE: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "ico", "apng", "woff", "woff2",
    "ttf", "otf", "mp4", "webm", "ogv", "mp3", "ogg", "wav", "flac", "m4a", "pdf",
];

/// One entry in [`ASSETS`] for a KaTeX font.
///
/// The name carries the `fonts/` in front of it because that is what the
/// stylesheet asks for: `katex.min.css` is served from `/__mark__/`, and the
/// `url(fonts/KaTeX_Main-Regular.woff2)` in it resolves against that. Only the
/// `woff2` faces are embedded -- every `@font-face` lists `woff2, woff, ttf` and
/// the webview stops at the first format it understands.
macro_rules! katex_font {
    ($name:literal) => {
        (
            concat!("fonts/", $name),
            "font/woff2",
            include_bytes!(concat!("assets/katex/fonts/", $name)),
        )
    };
}

/// Files compiled into the executable, served under [`ASSET_PREFIX`].
const ASSETS: &[(&str, &str, &[u8])] = &[
    (
        "style.css",
        "text/css; charset=utf-8",
        include_bytes!("assets/style.css"),
    ),
    (
        "app.js",
        "text/javascript; charset=utf-8",
        include_bytes!("assets/app.js"),
    ),
    (
        "inter-latin.woff2",
        "font/woff2",
        include_bytes!("assets/fonts/inter-latin.woff2"),
    ),
    (
        "inter-latin-ext.woff2",
        "font/woff2",
        include_bytes!("assets/fonts/inter-latin-ext.woff2"),
    ),
    (
        "jetbrains-mono-latin.woff2",
        "font/woff2",
        include_bytes!("assets/fonts/jetbrains-mono-latin.woff2"),
    ),
    (
        "jetbrains-mono-latin-ext.woff2",
        "font/woff2",
        include_bytes!("assets/fonts/jetbrains-mono-latin-ext.woff2"),
    ),
    // KaTeX's own stylesheet and the faces it draws with. Unlike the script
    // beside them these are stored as they are: a woff2 is compressed already,
    // and 25 KB of CSS is not worth a second inflate.
    (
        "katex.min.css",
        "text/css; charset=utf-8",
        include_bytes!("assets/katex/katex.min.css"),
    ),
    katex_font!("KaTeX_AMS-Regular.woff2"),
    katex_font!("KaTeX_Caligraphic-Bold.woff2"),
    katex_font!("KaTeX_Caligraphic-Regular.woff2"),
    katex_font!("KaTeX_Fraktur-Bold.woff2"),
    katex_font!("KaTeX_Fraktur-Regular.woff2"),
    katex_font!("KaTeX_Main-Bold.woff2"),
    katex_font!("KaTeX_Main-BoldItalic.woff2"),
    katex_font!("KaTeX_Main-Italic.woff2"),
    katex_font!("KaTeX_Main-Regular.woff2"),
    katex_font!("KaTeX_Math-BoldItalic.woff2"),
    katex_font!("KaTeX_Math-Italic.woff2"),
    katex_font!("KaTeX_SansSerif-Bold.woff2"),
    katex_font!("KaTeX_SansSerif-Italic.woff2"),
    katex_font!("KaTeX_SansSerif-Regular.woff2"),
    katex_font!("KaTeX_Script-Regular.woff2"),
    katex_font!("KaTeX_Size1-Regular.woff2"),
    katex_font!("KaTeX_Size2-Regular.woff2"),
    katex_font!("KaTeX_Size3-Regular.woff2"),
    katex_font!("KaTeX_Size4-Regular.woff2"),
    katex_font!("KaTeX_Typewriter-Regular.woff2"),
];

/// Files compiled into the executable compressed, served under [`ASSET_PREFIX`]
/// after being inflated.
///
/// mermaid is 3.5 MB as it ships and 976 KB in gzip, which is the difference
/// between a viewer that fits in memory twice over and one that carries a
/// diagram renderer nobody asked for. KaTeX is smaller -- 272 KB against 76 KB
/// -- and is here for the same reason: most documents have no fence to draw and
/// no formula to typeset, so the cost is paid per process and only by the ones
/// that do.
const PACKED: &[(&str, &str, &[u8])] = &[
    (
        "mermaid.min.js",
        "text/javascript; charset=utf-8",
        include_bytes!("assets/mermaid/mermaid.min.js.gz"),
    ),
    (
        "katex.min.js",
        "text/javascript; charset=utf-8",
        include_bytes!("assets/katex/katex.min.js.gz"),
    ),
];

/// The inflated bodies, in the order of [`PACKED`], filled in on first use.
///
/// A `OnceLock` in a static is what lets the response keep borrowing the bytes
/// rather than copying 3.5 MB into every request.
static UNPACKED: OnceLock<Vec<Vec<u8>>> = OnceLock::new();

/// Inflate every packed asset. Failing here would mean the bytes compiled into
/// the binary are not the bytes gzip wrote, so an empty body is as useful an
/// answer as any and the webview reports it as a script that did nothing.
fn unpacked(index: usize) -> &'static [u8] {
    &UNPACKED.get_or_init(|| {
        PACKED
            .iter()
            .map(|(_, _, packed)| {
                let mut body = Vec::new();
                let _ = flate2::read::GzDecoder::new(*packed).read_to_end(&mut body);
                body
            })
            .collect()
    })[index]
}

/// The page's own Inter, as a script that hands it to app.js with every face's
/// address swapped for its bytes.
///
/// A diagram copied as a picture is drawn as an SVG *image*, and an image
/// reaches nothing outside itself: not the `@font-face` rules of the page it
/// came from, and not a `mark://` URL. Left alone, its labels come out in
/// whatever the system substitutes for Inter, and no longer fit the boxes
/// mermaid measured for them. So the faces have to travel inside the drawing,
/// which means as text. The page cannot fetch the woff2 files and encode them
/// itself -- `connect-src 'none'` refuses exactly that, on purpose -- but a
/// script is something the policy does let it load, so the encoding is done
/// here, once, the first time a diagram is copied.
///
/// The rules are read out of style.css rather than written a second time, so a
/// face added there, or a range changed, reaches the picture too.
const DIAGRAM_FONT: &str = "diagram-font.js";
static DIAGRAM_FONT_BODY: OnceLock<Vec<u8>> = OnceLock::new();

fn diagram_font() -> &'static [u8] {
    DIAGRAM_FONT_BODY.get_or_init(|| {
        let css = std::str::from_utf8(asset("style.css").unwrap_or_default()).unwrap_or_default();
        let mut faces = String::new();

        for rest in css.split("@font-face").skip(1) {
            let Some(end) = rest.find('}') else {
                continue;
            };
            let mut face = format!("@font-face{}", &rest[..=end]);
            if !face.contains("\"Inter\"") {
                continue;
            }
            for (name, _, bytes) in ASSETS {
                let address = format!("url(\"{name}\")");
                if face.contains(&address) {
                    let inline = format!(
                        "url(data:font/woff2;base64,{})",
                        crate::base64::encode(bytes)
                    );
                    face = face.replace(&address, &inline);
                }
            }
            faces.push_str(&face);
        }

        format!(
            "window.__markDiagramFont = {};\n",
            serde_json::Value::from(faces)
        )
        .into_bytes()
    })
}

fn asset(name: &str) -> Option<&'static [u8]> {
    ASSETS
        .iter()
        .find(|(n, _, _)| *n == name)
        .map(|(_, _, body)| *body)
}


/// Build a URL the webview will route back to our handler.
///
/// The origin of a custom protocol differs per platform, which wry documents:
/// WebKit (Linux, macOS) keeps the scheme, while WebView2 maps it onto an http
/// subdomain. This is the only place in the app that needs to know.
pub fn url(path: &str) -> String {
    let path = path.trim_start_matches('/');
    #[cfg(windows)]
    {
        format!("http://mark.localhost/{path}")
    }
    #[cfg(not(windows))]
    {
        format!("mark://localhost/{path}")
    }
}

/// Resolve `reference` against `base` and clean up any `.` / `..` in it.
///
/// Purely lexical, because the target may not exist yet and we still want a
/// stable URL for it.
pub fn resolve(base: &Path, reference: &str) -> PathBuf {
    let joined = base.join(reference);
    let mut out = PathBuf::new();
    for part in joined.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other),
        }
    }
    out
}

/// Turn an absolute filesystem path into a URL for this protocol.
///
/// The whole path is escaped into a single URL segment, separators included, so
/// that it survives the round trip byte for byte. A Windows drive letter and a
/// Unix leading slash then need no special casing on the way back.
pub fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy();
    let encoded = utf8_percent_encode(&text, NON_ALPHANUMERIC).to_string();
    url(&format!("{FILE_PREFIX}{encoded}"))
}

/// The path a URL produced by [`file_url`] refers to, if it is one.
pub fn path_from_url(url: &str) -> Option<PathBuf> {
    let uri: Uri = url.parse().ok()?;
    let encoded = uri.path().strip_prefix(FILE_PREFIX)?;
    let decoded = percent_decode_str(encoded).decode_utf8().ok()?;
    Some(PathBuf::from(decoded.as_ref()))
}

/// The fragment a link carries past the file it names -- `section` in
/// `other.md#section` -- or `None` when there is none to jump to.
///
/// Read off the text rather than the parsed `Uri`, because `Uri` has nowhere to
/// keep a fragment and drops it; that is why `path_from_url` never sees one.
/// The first `#` is the right one to split on: `file_url` encodes any `#` that
/// is part of the path, so only the fragment's is left bare. It stays encoded,
/// the way the page's own links hand it over, and the page decodes it.
pub fn fragment_of(url: &str) -> Option<&str> {
    url.split_once('#')
        .map(|(_, fragment)| fragment)
        .filter(|fragment| !fragment.is_empty())
}

/// Answer one request. `doc_dir` is the directory of the document on screen, and
/// changes as the reader follows links between files.
pub fn serve(
    request: &Request<Vec<u8>>,
    doc_dir: &Path,
    shell: &str,
) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path();

    if path == "/" || path == "/index.html" {
        return html(shell.to_owned().into_bytes());
    }

    if let Some(name) = path.strip_prefix(ASSET_PREFIX) {
        if name == DIAGRAM_FONT {
            return ok(Cow::Borrowed(diagram_font()), "text/javascript; charset=utf-8");
        }
        if let Some((_, mime, body)) = ASSETS.iter().find(|(n, _, _)| *n == name) {
            return ok(Cow::Borrowed(*body), mime);
        }
        return match PACKED.iter().position(|(n, _, _)| *n == name) {
            Some(index) => ok(Cow::Borrowed(unpacked(index)), PACKED[index].1),
            None => not_found(),
        };
    }

    let decoded = match percent_decode_str(path).decode_utf8() {
        Ok(text) => text.into_owned(),
        Err(_) => return not_found(),
    };

    let target = match decoded.strip_prefix(FILE_PREFIX) {
        Some(absolute) => PathBuf::from(absolute),
        // A relative reference that survived the rewriters, typically from raw
        // HTML in the document. Resolve it the way a browser would.
        None => resolve(doc_dir, decoded.trim_start_matches('/')),
    };

    serve_file(&target)
}

fn serve_file(path: &Path) -> Response<Cow<'static, [u8]>> {
    let servable = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SERVABLE.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false);

    if !servable {
        return forbidden();
    }

    match std::fs::read(path) {
        Ok(body) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ok(Cow::Owned(body), mime.as_ref())
        }
        Err(_) => not_found(),
    }
}

fn html(body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    ok(Cow::Owned(body), "text/html; charset=utf-8")
}

fn ok(body: Cow<'static, [u8]>, mime: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .expect("response is well-formed")
}

fn empty(status: StatusCode) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .body(Cow::Borrowed(&[][..]))
        .expect("response is well-formed")
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    empty(StatusCode::NOT_FOUND)
}

fn forbidden() -> Response<Cow<'static, [u8]>> {
    empty(StatusCode::FORBIDDEN)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(path: &str) -> Request<Vec<u8>> {
        Request::builder().uri(url(path)).body(Vec::new()).unwrap()
    }

    #[test]
    fn root_serves_the_shell() {
        let response = serve(&request("/"), Path::new("/tmp"), "<html>shell</html>");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_ref(), b"<html>shell</html>");
    }

    #[test]
    fn embedded_assets_are_served() {
        let response = serve(&request("/__mark__/app.js"), Path::new("/tmp"), "");
        assert_eq!(response.status(), StatusCode::OK);
        assert!(!response.body().is_empty());
    }

    /// The assets that are not stored as they are served. A body the size of the
    /// gzip file would mean the compressed bytes went out verbatim, which the
    /// webview would report only as a script that silently did nothing.
    #[test]
    fn packed_assets_are_served_inflated() {
        for (index, (name, _, packed)) in PACKED.iter().enumerate() {
            let response = serve(
                &request(&format!("/__mark__/{name}")),
                Path::new("/tmp"),
                "",
            );
            assert_eq!(response.status(), StatusCode::OK, "{name}");

            let body = response.body();
            assert!(
                body.len() > packed.len() * 2,
                "{name}: {} bytes",
                body.len()
            );

            // The name without its extensions is in every one of these bundles,
            // which is as much as a byte comparison can say about a script.
            let needle = name.split('.').next().expect("a name").as_bytes();
            assert!(
                body.windows(needle.len()).any(|w| w == needle),
                "{name} does not look inflated"
            );
            assert_eq!(unpacked(index), body.as_ref(), "{name} came from elsewhere");
        }
    }

    /// The stylesheet and the fonts it asks for are two lists that have to say
    /// the same thing, and only one of them is written by hand here: a KaTeX
    /// version that adds a face would ship a stylesheet pointing at a file that
    /// is not embedded, and the formula would silently fall back to a font that
    /// has no maths in it.
    #[test]
    fn every_katex_font_the_stylesheet_asks_for_is_embedded() {
        let css = include_str!("assets/katex/katex.min.css");
        let mut asked = 0;

        for (at, opening) in css.match_indices("url(") {
            let rest = &css[at + opening.len()..];
            let Some(url) = rest.split(')').next() else {
                continue;
            };
            if !url.ends_with(".woff2") {
                continue;
            }
            assert!(
                ASSETS.iter().any(|(name, _, _)| *name == url),
                "{url} is in the stylesheet but not in the binary"
            );
            asked += 1;
        }

        assert!(asked > 15, "only {asked} fonts were checked");
    }

    #[test]
    fn unknown_embedded_asset_is_404() {
        let response = serve(&request("/__mark__/nope.js"), Path::new("/tmp"), "");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn non_media_files_are_refused_however_they_are_addressed() {
        let direct = Request::builder()
            .uri(file_url(Path::new("/etc/passwd")))
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            serve(&direct, Path::new("/tmp"), "").status(),
            StatusCode::FORBIDDEN
        );

        let escape = serve(&request("/../../etc/passwd"), Path::new("/tmp/docs"), "");
        assert_eq!(escape.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn resolve_cleans_up_traversal() {
        assert_eq!(
            resolve(Path::new("/a/b/docs"), "../assets/logo.png"),
            Path::new("/a/b/assets/logo.png")
        );
        assert_eq!(
            resolve(Path::new("/a/b"), "./img/./x.png"),
            Path::new("/a/b/img/x.png")
        );
    }

    #[test]
    fn file_urls_round_trip_through_encoding() {
        for path in [
            "/tmp/a b/c#d/img.png",
            "/tmp/ação/ç?.png",
            "C:/Users/x/i.png",
        ] {
            let path = Path::new(path);
            assert_eq!(path_from_url(&file_url(path)).as_deref(), Some(path));
        }
    }

    /// The path decides which file opens and the fragment where in it, and a
    /// `#` that belongs to the path must not be taken for the start of one.
    #[test]
    fn a_fragment_travels_beside_the_path_not_inside_it() {
        let path = Path::new("/tmp/c#d/other.md");
        let link = format!("{}#usage", file_url(path));

        assert_eq!(path_from_url(&link).as_deref(), Some(path));
        assert_eq!(fragment_of(&link), Some("usage"));

        assert_eq!(fragment_of(&file_url(path)), None);
        assert_eq!(fragment_of(&format!("{}#", file_url(path))), None);
    }

    /// A diagram copied as a picture can use only a font it carries inside it.
    /// This is that font: the page's own Inter faces, both of them, with the
    /// address of each swapped for its bytes -- one left pointing at a file is
    /// a face the picture silently goes without.
    #[test]
    fn the_diagram_font_is_the_page_font_carried_inline() {
        let response = serve(&request("/__mark__/diagram-font.js"), Path::new("/tmp"), "");
        assert_eq!(response.status(), StatusCode::OK);

        let body = std::str::from_utf8(response.body()).expect("a script is text");
        assert!(
            body.starts_with("window.__markDiagramFont = \""),
            "not the script app.js waits for"
        );
        assert_eq!(body.matches("@font-face").count(), 2, "not both Inter faces");
        assert_eq!(body.matches("data:font/woff2;base64,").count(), 2);
        assert!(body.contains("unicode-range"), "the faces lost their ranges");
        assert!(
            !body.contains(".woff2"),
            "a face still points at a file an image cannot reach"
        );
    }

    #[test]
    fn ordinary_urls_are_not_mistaken_for_file_urls() {
        assert_eq!(path_from_url("https://example.com/a.png"), None);
        assert_eq!(path_from_url(&url("/__mark__/app.js")), None);
    }
}
