//! Markdown to HTML conversion.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use comrak::plugins::syntect::{SyntectAdapter, SyntectAdapterBuilder};
use comrak::{markdown_to_html_with_plugins, Options};
use syntect::html::ClassStyle;
use two_face::theme::EmbeddedThemeName;

use crate::protocol;

/// Directory of the document currently on screen. Shared with the protocol
/// handler, and swapped when the reader follows a link to another file.
pub type DocDir = Arc<Mutex<PathBuf>>;

/// Prefix for the CSS classes syntect emits, so highlighting classes can never
/// collide with the ones our own stylesheet uses.
const HL_PREFIX: &str = "hl-";
const HL_CLASS_STYLE: ClassStyle = ClassStyle::SpacedPrefixed { prefix: HL_PREFIX };

pub struct Renderer {
    options: Options<'static>,
    adapter: SyntectAdapter,
    rewrite: Arc<Rewrite>,
}

impl Renderer {
    pub fn new(doc_dir: DocDir) -> Self {
        let mut options = Options::default();

        let ext = &mut options.extension;
        ext.strikethrough = true;
        ext.table = true;
        ext.autolink = true;
        ext.tasklist = true;
        ext.footnotes = true;
        ext.description_lists = true;
        ext.superscript = true;
        ext.alerts = true;
        // Documents that came from a static site generator start with a YAML
        // block that is metadata, not prose. Without this it renders as a stray
        // heading and a wall of key/value lines.
        ext.front_matter_delimiter = Some("---".to_string());
        // An empty prefix still turns the extension on. The ids it generates are
        // what the sidebar links to.
        ext.header_id_prefix = Some(String::new());
        // Relative references have to become absolute here, at render time. If we
        // left them alone the webview would resolve them against the page URL and
        // silently flatten any leading `../`, so an image one directory up would
        // never be found.
        let rewrite = Arc::new(Rewrite { doc_dir });
        ext.image_url_rewriter = Some(rewrite.clone());
        ext.link_url_rewriter = Some(rewrite.clone());

        let render = &mut options.render;
        // Plenty of real documents lean on inline HTML for things Markdown has no
        // syntax for -- <details>, <kbd>, <sub>. We render it, and contain the
        // blast radius with a CSP plus the path jail in protocol.rs.
        render.r#unsafe = true;
        render.tasklist_classes = true;
        // Leave github_pre_lang off: it moves the info string onto <pre>, which
        // the highlighter drops in CSS-class mode. On <code> it survives, and
        // app.js turns it into the little language label on the block.

        // Passing no theme is what makes the adapter emit CSS classes instead of
        // inline colours; syntax_css() below produces the matching stylesheet.
        let adapter = SyntectAdapterBuilder::new()
            .css_with_class_prefix(HL_PREFIX)
            // The set bundled with syntect misses a lot of what people actually
            // write. This is the one bat ships, which knows TSX, TOML, Dockerfile
            // and friends.
            .syntax_set(two_face::syntax::extra_newlines())
            .build();

        Self {
            options,
            adapter,
            rewrite,
        }
    }

    /// The stylesheet for the classes the highlighter emits.
    ///
    /// Kept separate from the markup so that swapping the palette (a dark theme,
    /// say) never means re-rendering the document.
    pub fn syntax_css() -> String {
        let themes = two_face::theme::extra();
        let theme = themes.get(EmbeddedThemeName::InspiredGithub);
        syntect::html::css_for_theme_with_class_style(theme, HL_CLASS_STYLE)
            .expect("bundled theme is well-formed")
    }

    /// Render a document body. The surrounding page comes from assets/shell.html.
    pub fn render(&self, markdown: &str) -> String {
        let mut plugins = comrak::options::Plugins::default();
        plugins.render.codefence_syntax_highlighter = Some(&self.adapter);
        let html = markdown_to_html_with_plugins(markdown, &self.options, &plugins);
        rewrite_raw_html(&html, &self.rewrite)
    }
}

/// Turns a URL written in a document into one the `mark://` handler understands,
/// leaving anything that is already addressable alone.
struct Rewrite {
    doc_dir: DocDir,
}

impl Rewrite {
    fn url(&self, url: &str) -> String {
        let addressable = url.is_empty()
            || url.starts_with('#')
            || url.contains("://")
            || url.starts_with("data:")
            || url.starts_with("mailto:")
            || url.starts_with("tel:");
        if addressable {
            return url.to_string();
        }

        // Fragments travel with the path (`other.md#section`) and are not part of
        // the file name.
        let (path, fragment) = match url.split_once('#') {
            Some((path, fragment)) => (path, Some(fragment)),
            None => (url, None),
        };

        let base = self.doc_dir.lock().expect("doc dir lock is never poisoned");
        let resolved = protocol::file_url(&protocol::resolve(&base, path));
        match fragment {
            Some(fragment) => format!("{resolved}#{fragment}"),
            None => resolved,
        }
    }
}

impl comrak::options::URLRewriter for Rewrite {
    fn to_html(&self, url: &str) -> String {
        self.url(url)
    }
}

/// Attributes carrying a URL that we rewrite in raw HTML.
const URL_ATTRIBUTES: [&str; 3] = ["src=\"", "href=\"", "poster=\""];

/// Apply the same rewrite to raw HTML the document brought with it.
///
/// comrak's rewriters only see Markdown links and images; an `<img>` written by
/// hand passes through untouched. It cannot stay relative: the webview resolves
/// it against the page URL and flattens any leading `../` before our protocol
/// handler is ever asked for it.
///
/// Only real attributes match here -- anything inside a code block or a text run
/// has had its quotes escaped by the time we see it.
fn rewrite_raw_html(html: &str, rewrite: &Rewrite) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;

    loop {
        let Some((at, attribute)) = URL_ATTRIBUTES
            .iter()
            .filter_map(|attribute| rest.find(attribute).map(|at| (at, *attribute)))
            .min_by_key(|(at, _)| *at)
        else {
            out.push_str(rest);
            return out;
        };

        let value = at + attribute.len();
        out.push_str(&rest[..value]);

        let Some(end) = rest[value..].find('"') else {
            out.push_str(&rest[value..]);
            return out;
        };

        out.push_str(&rewrite.url(&rest[value..value + end]));
        rest = &rest[value + end..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// The value of the first `name="..."` in some rendered HTML.
    fn attribute(html: &str, name: &str) -> String {
        let needle = format!("{name}=\"");
        let start = html.find(&needle).expect("attribute is present") + needle.len();
        let rest = &html[start..];
        rest[..rest.find('"').expect("attribute is closed")].to_string()
    }

    fn renderer() -> Renderer {
        Renderer::new(Arc::new(Mutex::new(PathBuf::from("/docs"))))
    }

    #[test]
    fn headings_get_ids_for_the_sidebar() {
        let html = renderer().render("## Hello World\n");
        assert!(html.contains(r#"<h2 id="hello-world""#), "{html}");
    }

    #[test]
    fn code_is_highlighted_with_prefixed_classes() {
        let html = renderer().render("```rust\nfn main() {}\n```\n");
        assert!(html.contains("class=\"hl-"), "{html}");
    }

    #[test]
    fn gfm_tables_render() {
        let html = renderer().render("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
        assert!(html.contains("<table>") && html.contains("<th>"), "{html}");
    }

    #[test]
    fn front_matter_is_not_shown() {
        let html = renderer().render("---\ntitle: Secret\n---\n\n# Body\n");
        assert!(!html.contains("Secret"), "{html}");
    }

    #[test]
    fn relative_image_paths_become_absolute_urls() {
        let html = renderer().render("![](../img/logo.png)\n");
        let url = attribute(&html, "src");
        assert_eq!(
            protocol::path_from_url(&url).as_deref(),
            Some(Path::new("/img/logo.png")),
            "{html}"
        );
    }

    #[test]
    fn remote_and_anchor_urls_are_left_alone() {
        let html = renderer().render("[a](https://example.com) [b](#top)\n");
        assert!(html.contains("href=\"https://example.com\""), "{html}");
        assert!(html.contains("href=\"#top\""), "{html}");
    }

    #[test]
    fn links_to_other_documents_keep_their_fragment() {
        let html = renderer().render("[a](other.md#usage)\n");
        let url = attribute(&html, "href");
        assert!(url.ends_with("#usage"), "{html}");
        assert_eq!(
            protocol::path_from_url(&url).as_deref(),
            Some(Path::new("/docs/other.md")),
            "{html}"
        );
    }

    #[test]
    fn raw_html_urls_are_rewritten_too() {
        let html = renderer().render("<img src=\"../img/logo.png\">\n");
        let url = attribute(&html, "src");
        assert_eq!(
            protocol::path_from_url(&url).as_deref(),
            Some(Path::new("/img/logo.png")),
            "{html}"
        );
    }

    #[test]
    fn rewriting_raw_html_leaves_everything_else_intact() {
        let html = renderer().render("<a href=\"https://example.com\">x</a>\n");
        assert!(html.contains("href=\"https://example.com\""), "{html}");
    }

    #[test]
    fn syntax_css_covers_the_prefixed_classes() {
        assert!(Renderer::syntax_css().contains(".hl-"));
    }
}
