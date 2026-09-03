//! The `mark://` custom protocol: serves the app shell, the embedded assets and
//! the local files (images, fonts, media) that a document references.

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};

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
];

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
        return match ASSETS.iter().find(|(n, _, _)| *n == name) {
            Some((_, mime, body)) => ok(Cow::Borrowed(*body), mime),
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

    #[test]
    fn ordinary_urls_are_not_mistaken_for_file_urls() {
        assert_eq!(path_from_url("https://example.com/a.png"), None);
        assert_eq!(path_from_url(&url("/__mark__/app.js")), None);
    }
}
