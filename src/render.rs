//! Markdown to HTML conversion.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use comrak::plugins::syntect::{SyntectAdapter, SyntectAdapterBuilder};
use comrak::{markdown_to_html_with_plugins, Options};
use syntect::highlighting::Theme;
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

/// A syntax theme per palette. All four come from the set bat ships, so a
/// reader who knows Catppuccin or Gruvbox from their terminal gets the colours
/// they already know rather than an approximation of them.
const LIGHT_THEME: EmbeddedThemeName = EmbeddedThemeName::InspiredGithub;
const DARK_THEME: EmbeddedThemeName = EmbeddedThemeName::OneHalfDark;
const CATPPUCCIN_THEME: EmbeddedThemeName = EmbeddedThemeName::CatppuccinMocha;
const GRUVBOX_THEME: EmbeddedThemeName = EmbeddedThemeName::GruvboxDark;

/// The ways a palette can be selected: the system asking for one with nothing
/// overriding it, and the reader picking one outright.
///
/// Every palette has to be scoped, the light one included. A theme only emits
/// rules for the scopes it actually colours, so leaving one palette unscoped
/// would let its colours show through wherever the others have nothing to say.
///
/// `BY_DEFAULT` has to test for the attribute rather than for a particular
/// value of it: `:not([data-theme="dark"])` was enough while dark was the only
/// other palette, but it matches every palette but that one, so with four it
/// would deliver two at once.
const BY_DEFAULT: &str = ":root:not([data-theme])";
const LIGHT_CHOSEN: &str = ":root[data-theme=\"light\"]";
const DARK_CHOSEN: &str = ":root[data-theme=\"dark\"]";
const CATPPUCCIN_CHOSEN: &str = ":root[data-theme=\"catppuccin-mocha\"]";
const GRUVBOX_CHOSEN: &str = ":root[data-theme=\"gruvbox-dark\"]";
const BLACKSITE_CHOSEN: &str = ":root[data-theme=\"blacksite\"]";

/// The palettes a printer has to be talked out of, which is every one that is
/// not already the light one.
const DARK_CHOSEN_ALL: &[&str] = &[
    DARK_CHOSEN,
    CATPPUCCIN_CHOSEN,
    GRUVBOX_CHOSEN,
    BLACKSITE_CHOSEN,
];

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
        // Maths, in the four ways it is usually written: `$x$`, `$$x$$`,
        // `` $`x`$ `` and a ```math fence. The dollar rules are stricter than
        // they look -- the opening `$` cannot be followed by a space, the
        // closing one cannot be preceded by one, and code spans are read before
        // any of this -- so a paragraph about costing $5 or $10 is still prose.
        // Neither of these renders anything on its own: they mark the maths with
        // a `data-math-style` attribute, and app.js hands the source to KaTeX.
        ext.math_dollars = true;
        ext.math_code = true;
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

    /// The stylesheet for the classes the highlighter emits, in every palette.
    ///
    /// Keeping the colours out of the markup is what makes this possible at all:
    /// switching theme is a stylesheet matter, and never means re-rendering the
    /// document.
    ///
    /// Light and dark are emitted twice each, once per way of arriving at them,
    /// because the two cannot be written as a single selector -- one is a media
    /// query. The palettes a reader has to ask for by name need only one copy:
    /// no system asks for Catppuccin. The explicit choices come last so they win
    /// the tie on specificity.
    ///
    /// Printing is the last way, and it only ever wants the light one: a printer
    /// drops the near-black background a dark theme was picked against, and its
    /// tokens are then pale colours on white paper. So the light theme is
    /// emitted once more under `@media print`, against every selector that would
    /// otherwise have delivered a dark palette. Same specificity as those, later
    /// in the file, so it wins on order -- which is what the `@media print` block
    /// in style.css does for the rest of the page.
    ///
    /// Blacksite is the exception to "a theme bat ships": it is a Helix theme
    /// with no TextMate counterpart, so `blacksite_theme` builds one from the
    /// same palette. It colours fewer scopes than a bat theme does, which makes
    /// its copy the smallest of the lot.
    ///
    /// Eight copies of a syntax theme come to about 180 KB, which is the largest
    /// thing in the shell by some way. It is built once, at startup, and costs
    /// the binary nothing: two-face carries every theme either way. Another
    /// palette from bat would add roughly 25 KB more.
    pub fn syntax_css() -> String {
        let themes = two_face::theme::extra();
        let light = theme_css(&themes, LIGHT_THEME);
        let dark = theme_css(&themes, DARK_THEME);
        let catppuccin = theme_css(&themes, CATPPUCCIN_THEME);
        let gruvbox = theme_css(&themes, GRUVBOX_THEME);
        let blacksite = css_for(&blacksite_theme());

        // One copy of the light theme covers all of print, rather than one per
        // selector, because `scope` takes the whole list at once.
        let mut printed = vec![BY_DEFAULT];
        printed.extend_from_slice(DARK_CHOSEN_ALL);

        format!(
            "@media (prefers-color-scheme: light) {{\n{}}}\n\
             @media (prefers-color-scheme: dark) {{\n{}}}\n\
             {}\n{}\n{}\n{}\n{}\n\
             @media print {{\n{}}}",
            scope(&light, &[BY_DEFAULT]),
            scope(&dark, &[BY_DEFAULT]),
            scope(&light, &[LIGHT_CHOSEN]),
            scope(&dark, &[DARK_CHOSEN]),
            scope(&catppuccin, &[CATPPUCCIN_CHOSEN]),
            scope(&gruvbox, &[GRUVBOX_CHOSEN]),
            scope(&blacksite, &[BLACKSITE_CHOSEN]),
            scope(&light, &printed),
        )
    }

    /// Render a document body. The surrounding page comes from assets/shell.html.
    pub fn render(&self, markdown: &str) -> String {
        let mut plugins = comrak::options::Plugins::default();
        plugins.render.codefence_syntax_highlighter = Some(&self.adapter);
        let html = markdown_to_html_with_plugins(markdown, &self.options, &plugins);
        rewrite_raw_html(&html, &self.rewrite)
    }
}

fn theme_css(themes: &two_face::theme::EmbeddedLazyThemeSet, name: EmbeddedThemeName) -> String {
    css_for(themes.get(name))
}

fn css_for(theme: &Theme) -> String {
    syntect::html::css_for_theme_with_class_style(theme, HL_CLASS_STYLE)
        .expect("a theme with no colours is still valid CSS")
}

/// Blacksite, the near-black green-phosphor theme from the reader's Helix,
/// as a syntect theme.
///
/// Helix names what tree-sitter found; syntect colours TextMate scopes. The
/// two vocabularies mostly line up word for word -- `keyword`, `string`,
/// `comment` -- and where they do not, each line below is the TextMate scope
/// that carries what the Helix key meant. Built in code rather than loaded
/// from a `.tmTheme` because loading one needs syntect's plist feature, a
/// dependency for one file, and a typo in a scope here fails a test instead
/// of an XML parse at startup.
///
/// The colours are the `[palette]` of `blacksite.toml` and are repeated in the
/// `blacksite` block of style.css; change one, change the other.
fn blacksite_theme() -> Theme {
    use std::str::FromStr;
    use syntect::highlighting::{
        Color, FontStyle, ScopeSelectors, StyleModifier, ThemeItem, ThemeSettings,
    };

    fn hex(rgb: u32) -> Color {
        let [_, r, g, b] = rgb.to_be_bytes();
        Color { r, g, b, a: 0xff }
    }

    const FG: u32 = 0xb4c4b9;
    const DIM: u32 = 0x4f6257;
    const OP: u32 = 0x8aa293;
    const MEMBER: u32 = 0x9fb3a6;
    const GREEN: u32 = 0x39d98a;
    const CYAN: u32 = 0x5cc8cf;
    const BLUE: u32 = 0x6f9fc4;
    const AMBER: u32 = 0xc9b06a;
    const ORANGE: u32 = 0xd9844a;
    const RED: u32 = 0xe5535b;
    const VIOLET: u32 = 0xa07fc9;

    let none = FontStyle::empty();
    // Later items win over earlier ones on a tie, so the specific scopes come
    // after the general ones they refine.
    let rules: &[(&str, u32, FontStyle)] = &[
        ("comment, punctuation.definition.comment", DIM, FontStyle::ITALIC),
        ("keyword, storage", GREEN, none),
        ("keyword.operator, punctuation", OP, none),
        ("string, punctuation.definition.string", AMBER, none),
        ("string.regexp, string.other.link", ORANGE, none),
        ("constant, variable.language", ORANGE, none),
        ("constant.character.escape", VIOLET, none),
        ("entity.name.function, support.function, meta.function-call.identifier", CYAN, none),
        ("entity.name.function.macro, support.macro, meta.preprocessor", VIOLET, none),
        (
            "entity.name.type, entity.name.class, entity.name.struct, entity.name.enum, \
             entity.name.trait, entity.name.namespace, entity.name.module, \
             support.type, support.class, entity.other.inherited-class",
            BLUE,
            none,
        ),
        ("variable, variable.parameter", FG, none),
        ("variable.other.member, variable.other.property, meta.property-name, support.type.property-name", MEMBER, none),
        ("entity.other.attribute-name, meta.attribute, meta.annotation, entity.name.label", VIOLET, none),
        ("entity.name.tag", GREEN, none),
        ("markup.heading, markup.heading entity.name", GREEN, FontStyle::BOLD),
        ("markup.bold", FG, FontStyle::BOLD),
        ("markup.italic", FG, FontStyle::ITALIC),
        ("markup.underline.link", CYAN, FontStyle::UNDERLINE),
        ("markup.raw", AMBER, none),
        ("markup.list punctuation.definition", GREEN, none),
        ("markup.quote", DIM, FontStyle::ITALIC),
        ("markup.inserted", GREEN, none),
        ("markup.deleted, invalid", RED, none),
        ("markup.changed", AMBER, none),
    ];

    Theme {
        name: Some("Blacksite".to_owned()),
        author: None,
        settings: ThemeSettings {
            foreground: Some(hex(FG)),
            ..ThemeSettings::default()
        },
        scopes: rules
            .iter()
            .map(|&(scope, colour, font_style)| ThemeItem {
                scope: ScopeSelectors::from_str(scope).expect("a valid scope selector"),
                style: StyleModifier {
                    foreground: Some(hex(colour)),
                    background: None,
                    font_style: (!font_style.is_empty()).then_some(font_style),
                },
            })
            .collect(),
    }
}

/// Restrict every rule in a generated stylesheet to one or more scopes.
///
/// syntect emits a flat list of class selectors and one comment at the top, so
/// this never has to deal with nesting or at-rules.
///
/// Taking a list rather than a single prefix is what keeps `@media print` to one
/// copy of the light theme instead of one per palette it has to override.
fn scope(css: &str, prefixes: &[&str]) -> String {
    let mut out = String::with_capacity(css.len() * 2);

    for rule in without_comments(css).split_inclusive('}') {
        let Some((selectors, declarations)) = rule.split_once('{') else {
            continue; // whitespace trailing the last rule
        };

        let selectors = selectors.trim();
        if selectors.is_empty() {
            continue;
        }

        let mut first = true;
        for prefix in prefixes {
            for selector in selectors.split(',') {
                out.push_str(if first { "" } else { ", " });
                first = false;
                out.push_str(prefix);
                out.push(' ');
                out.push_str(selector.trim());
            }
        }
        out.push_str(" {");
        out.push_str(declarations);
        out.push('\n');
    }

    out
}

fn without_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;

    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        match rest[start..].find("*/") {
            Some(end) => rest = &rest[start + end + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
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

    /// What app.js has to find to draw a diagram: the fence's language on the
    /// `<code>`, and the source it wrote surviving the trip through the
    /// highlighter, which sees `mermaid` as a language it does not know.
    #[test]
    fn mermaid_fences_keep_their_language_and_their_source() {
        let html = renderer().render("```mermaid\nflowchart LR\n  A --> B\n```\n");
        assert!(html.contains("class=\"language-mermaid\""), "{html}");
        assert!(
            html.contains("flowchart LR") && html.contains("A --&gt; B"),
            "{html}"
        );
    }

    /// What app.js looks for. comrak renders every kind of maths as the same
    /// attribute on a different tag, and the source arrives escaped, which is
    /// why the page reads it back with `textContent`.
    #[test]
    fn maths_is_marked_up_for_the_page() {
        let html = renderer().render("Let $x^2$ be, and $$e = mc^2$$ as well.\n");
        assert!(
            html.contains(r#"<span data-math-style="inline">x^2</span>"#),
            "{html}"
        );
        assert!(
            html.contains(r#"<span data-math-style="display">e = mc^2</span>"#),
            "{html}"
        );

        let coded = renderer().render("Inline $`a < b`$ code.\n");
        assert!(
            coded.contains(r#"<code data-math-style="inline">a &lt; b</code>"#),
            "{coded}"
        );
    }

    /// The maths fence takes the path the mermaid one does not: comrak renders
    /// it itself, so the highlighter never sees it and the source survives for
    /// KaTeX to parse.
    #[test]
    fn a_maths_fence_keeps_its_source_for_the_page() {
        let html = renderer().render("```math\n\\frac{a}{b} < c\n```\n");
        assert!(html.contains(r#"class="language-math""#), "{html}");
        assert!(html.contains(r#"data-math-style="display""#), "{html}");
        assert!(html.contains(r"\frac{a}{b} &lt; c"), "{html}");
        assert!(!html.contains("class=\"hl-"), "{html}");
    }

    /// The rule readers will meet first, and the reason turning `math_dollars`
    /// on does not rewrite every document that mentions a price: an opening `$`
    /// followed by a space, or a closing one preceded by it, is a dollar sign.
    #[test]
    fn not_every_dollar_sign_is_maths() {
        for prose in [
            "It costs $5 or $10, depending.\n",
            "Neither is this $ 4 $.\n",
            "A shell `$HOME` and a bare $ sign.\n",
        ] {
            let html = renderer().render(prose);
            assert!(!html.contains("data-math-style"), "{html}");
        }
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

    /// The examples are the only documents in the repository that mark is asked
    /// to open, and every path in them is written by hand: a renamed file or a
    /// moved asset shows up as a dead link in a window, which nothing else here
    /// would catch.
    #[test]
    fn the_examples_point_at_files_that_are_really_there() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("examples");
        let renderer = Renderer::new(Arc::new(Mutex::new(dir.clone())));
        let mut checked = 0;

        for entry in std::fs::read_dir(&dir).expect("the examples are there") {
            let file = entry.expect("a directory entry").path();
            if file.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }

            let markdown = std::fs::read_to_string(&file).expect("an example is readable");
            let html = renderer.render(&markdown);

            for url in local_urls(&html) {
                let target = protocol::path_from_url(&url).expect("a rewritten url");
                // images.md points at one file that is not there on purpose, to
                // show what a broken image looks like.
                if target
                    .file_name()
                    .is_some_and(|name| name == "does-not-exist.png")
                {
                    continue;
                }
                assert!(
                    target.exists(),
                    "{} points at {}",
                    file.display(),
                    target.display()
                );
                checked += 1;
            }
        }

        assert!(checked > 10, "only {checked} paths were checked");
    }

    /// A fragment names a heading by the id comrak gives it, which is the
    /// heading's text run through rules nobody writing a link has in front of
    /// them. One that misses opens the file at the top and says nothing, which
    /// looks exactly like the feature not being there at all.
    #[test]
    fn every_fragment_the_examples_link_to_is_a_heading_there() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("examples");
        let renderer = Renderer::new(Arc::new(Mutex::new(dir.clone())));
        let mut checked = 0;

        for entry in std::fs::read_dir(&dir).expect("the examples are there") {
            let file = entry.expect("a directory entry").path();
            if file.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }

            let html = renderer.render(&std::fs::read_to_string(&file).expect("readable"));

            for url in local_urls(&html) {
                let Some(fragment) = protocol::fragment_of(&url) else {
                    continue;
                };
                let fragment = percent_encoding::percent_decode_str(fragment).decode_utf8_lossy();
                let target = protocol::path_from_url(&url).expect("a rewritten url");
                let text = std::fs::read_to_string(&target).expect("the target is readable");

                assert!(
                    renderer.render(&text).contains(&format!("id=\"{fragment}\"")),
                    "{} links to #{fragment} in {}, which has no such heading",
                    file.display(),
                    target.display()
                );
                checked += 1;
            }
        }

        assert!(checked > 0, "no example links to a heading in another file");
    }

    /// Every `href` and `src` in some rendered HTML that our own handler serves.
    fn local_urls(html: &str) -> Vec<String> {
        let mut urls = Vec::new();
        let mut rest = html;

        while let Some(at) = rest.find("=\"").map(|at| at + 2) {
            let Some(end) = rest[at..].find('"') else {
                break;
            };
            let value = &rest[at..at + end];
            if protocol::path_from_url(value).is_some() {
                urls.push(value.to_owned());
            }
            rest = &rest[at + end..];
        }
        urls
    }

    #[test]
    fn syntax_css_covers_the_prefixed_classes() {
        assert!(Renderer::syntax_css().contains(".hl-"));
    }

    #[test]
    fn syntax_css_carries_every_palette() {
        let css = Renderer::syntax_css();
        for scope in [
            "@media (prefers-color-scheme: light)",
            "@media (prefers-color-scheme: dark)",
            LIGHT_CHOSEN,
            DARK_CHOSEN,
            CATPPUCCIN_CHOSEN,
            GRUVBOX_CHOSEN,
            BLACKSITE_CHOSEN,
        ] {
            assert!(css.contains(scope), "missing {scope}");
        }
    }

    /// Four themes that happen to colour the same scopes would pass every other
    /// test here while being the same colours four times over. Each palette has
    /// to bring rules the one before it did not.
    #[test]
    fn every_palette_is_a_different_set_of_colours() {
        let themes = two_face::theme::extra();
        let mut all = [LIGHT_THEME, DARK_THEME, CATPPUCCIN_THEME, GRUVBOX_THEME]
            .map(|name| theme_css(&themes, name))
            .to_vec();
        all.push(css_for(&blacksite_theme()));

        for (index, one) in all.iter().enumerate() {
            for other in &all[index + 1..] {
                assert_ne!(one, other, "two palettes are the same theme");
            }
        }
    }

    /// Print has to end up with the light theme however the reader got there,
    /// and it only does so by coming last: the selectors it overrides have the
    /// same specificity, so order is the whole mechanism.
    #[test]
    fn print_overrides_the_dark_palette_and_comes_last() {
        let css = Renderer::syntax_css();
        let print = css.find("@media print").expect("no print block");

        // The rules it has to beat are the ones written before it.
        for scope in DARK_CHOSEN_ALL {
            assert!(css.find(scope).expect("no {scope} rules") < print);
        }
        for scope in [&[BY_DEFAULT], DARK_CHOSEN_ALL].concat() {
            assert!(css[print..].contains(scope), "print misses {scope}");
        }

        // The colours under it have to be the light theme's. Anything one of the
        // dark themes alone emits would mean the wrong palette was scoped.
        let mut printed = vec![BY_DEFAULT];
        printed.extend_from_slice(DARK_CHOSEN_ALL);
        let light = scope(&theme_css(&two_face::theme::extra(), LIGHT_THEME), &printed);
        assert!(
            css[print..].contains(light.trim_end()),
            "print is not the light theme"
        );
    }

    /// An unscoped rule would show through in the other palette wherever that
    /// one happens to have no rule of its own -- the kind of thing that only
    /// turns up on one keyword in one language.
    #[test]
    fn every_syntax_rule_is_scoped() {
        let css = Renderer::syntax_css();
        let unscoped: Vec<&str> = css
            .split('}')
            .filter_map(|rule| rule.split_once('{'))
            .map(|(selectors, _)| selectors.trim())
            .filter(|selectors| selectors.starts_with(".hl-"))
            .collect();
        assert!(unscoped.is_empty(), "unscoped rules: {unscoped:?}");
    }

    /// The stylesheet spells the dark palette out twice, once per selector the
    /// syntax colours are also scoped to. Nothing in CSS keeps the two copies in
    /// step, so check it here.
    #[test]
    fn both_dark_palettes_declare_the_same_tokens() {
        let css = include_str!("assets/style.css");
        let by_default = declarations(css, BY_DEFAULT);
        let chosen = declarations(css, DARK_CHOSEN);

        assert!(by_default.len() > 10, "{by_default:?}");
        assert_eq!(by_default, chosen);
    }

    /// The light palette is the unconditional `:root`, so a token a later
    /// palette forgets is not a missing colour -- it is the light one showing
    /// through, which reads as a single wrong element rather than as a mistake.
    /// Only the names are compared; the values are the whole point of a palette.
    #[test]
    fn every_palette_declares_the_same_tokens() {
        let css = include_str!("assets/style.css");
        let light = tokens(css, ":root {");

        assert!(light.len() > 10, "{light:?}");

        for selector in [
            BY_DEFAULT,
            DARK_CHOSEN,
            CATPPUCCIN_CHOSEN,
            GRUVBOX_CHOSEN,
            BLACKSITE_CHOSEN,
        ] {
            assert_eq!(tokens(css, selector), light, "{selector} is missing tokens");
        }
    }

    /// A diagram is drawn once per lightness and the stylesheet picks one, which
    /// only works if every way of arriving at a dark page says the same thing.
    /// They are written out by hand, exactly as the palettes above them are.
    #[test]
    fn every_dark_palette_swaps_the_diagram_the_same_way() {
        let css = include_str!("assets/style.css");

        for selector in DARK_CHOSEN_ALL {
            for rule in [
                format!("{selector} .diagram-light {{ display: none; }}"),
                format!("{selector} .diagram-dark {{ display: block; }}"),
            ] {
                assert!(css.contains(&rule), "the stylesheet is missing {rule}");
            }
        }
    }

    /// The menu is the only way to reach a palette with a pointer, and the
    /// stylesheet is the only thing that gives one colours. A palette in one and
    /// not the other is either an entry that changes nothing or colours nobody
    /// can ask for.
    ///
    /// The first two entries are the two that have no block of their own, and
    /// the menu has to open with them in that order: following the system is the
    /// absence of a palette, and light is the unconditional `:root` every other
    /// palette overrides. Everything after them is a block, and every block is
    /// there.
    #[test]
    fn the_theme_menu_offers_every_palette_the_stylesheet_declares() {
        let offered = menu_themes(include_str!("assets/shell.html"));
        let declared = declared_themes(include_str!("assets/style.css"));

        assert_eq!(offered[..2], ["system", "light"], "{offered:?}");

        let mut named = offered[2..].to_vec();
        named.sort();
        assert_eq!(named, declared, "the menu and the palettes have drifted");
    }

    /// The order is load-bearing twice over: it is the order D walks, and
    /// `openThemeMenu` uses the position in `THEMES` to decide which entry to
    /// focus. Written out in both files, so the two can drift into a menu that
    /// opens on the wrong row and a key that walks it in a different order from
    /// the one the reader is looking at.
    #[test]
    fn the_menu_and_the_page_script_agree_on_the_order() {
        let js = include_str!("assets/app.js");
        let list = &js[js.find("var THEMES = [").expect("no THEMES")..];
        let list = &list[..list.find(']').expect("the list closes")];

        let declared: Vec<String> = list
            .match_indices('"')
            .step_by(2)
            .filter_map(|(at, _)| list[at + 1..].split('"').next())
            .map(str::to_owned)
            .collect();

        assert_eq!(declared, menu_themes(include_str!("assets/shell.html")));
    }

    /// The landing page rebuilds the window's bar and offers the same palettes
    /// from its own corner, and it is the copy nobody working on the viewer ever
    /// has open. A palette added here and forgotten there is a page quietly
    /// describing an older program -- the same thing
    /// the_landing_page_lists_every_shortcut guards for the keys.
    #[test]
    fn the_landing_page_offers_the_same_themes() {
        assert_eq!(
            menu_themes(include_str!("../docs/index.html")),
            menu_themes(include_str!("assets/shell.html")),
            "the page and the window offer different palettes"
        );
    }

    /// The palettes the menu in shell.html offers, in the order it offers them.
    fn menu_themes(shell: &str) -> Vec<String> {
        let menu = &shell[shell.find("id=\"theme-menu\"").expect("no theme menu")..];
        let menu = &menu[..menu.find("</div>").expect("the menu closes")];

        menu.match_indices("value=\"")
            .filter_map(|(at, tag)| menu[at + tag.len()..].split('"').next())
            .map(str::to_owned)
            .collect()
    }

    /// The palettes the stylesheet declares, which is every one but the light
    /// palette -- that one is the unconditional `:root` and has no name.
    fn declared_themes(css: &str) -> Vec<String> {
        css.match_indices(":root[data-theme=\"")
            .filter_map(|(at, tag)| css[at + tag.len()..].split('"').next())
            .map(str::to_owned)
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect()
    }

    /// The names of the custom properties a rule sets, sorted.
    fn tokens(css: &str, selector: &str) -> Vec<String> {
        declarations(css, selector)
            .iter()
            .filter_map(|line| line.split(':').next())
            .filter(|name| name.starts_with("--"))
            .map(str::to_owned)
            .collect()
    }

    /// The two drawings of a diagram are told apart by a class name that app.js
    /// writes and the stylesheet reads, and nothing else connects them: rename
    /// it in one file and both palettes end up on the page at once.
    #[test]
    fn the_page_and_the_stylesheet_agree_on_the_diagram_classes() {
        let css = include_str!("assets/style.css");
        let js = include_str!("assets/app.js");

        for class in ["diagram-light", "diagram-dark"] {
            assert!(css.contains(&format!(".{class}")), "style.css lost {class}");
            assert!(js.contains(&format!("\"{class}\"")), "app.js lost {class}");
        }
    }

    /// The copy button is built in one file and dressed in the other, and only
    /// the class names connect them: rename one and the button turns into an
    /// unstyled word sitting on top of the code.
    #[test]
    fn the_page_and_the_stylesheet_agree_on_the_copy_button_classes() {
        let css = include_str!("assets/style.css");
        let js = include_str!("assets/app.js");

        for class in ["code-wrap", "copy", "said", "offscreen"] {
            assert!(css.contains(&format!(".{class}")), "style.css lost {class}");
            assert!(js.contains(&format!("\"{class}\"")), "app.js lost {class}");
        }
    }

    /// The declarations of the first rule using `selector`, sorted.
    fn declarations(css: &str, selector: &str) -> Vec<String> {
        let at = css.find(selector).expect("selector is in the stylesheet");
        let open = at + css[at..].find('{').expect("the block opens");
        let close = open + css[open..].find('}').expect("the block closes");

        let mut lines: Vec<String> = css[open + 1..close]
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect();
        lines.sort();
        lines
    }

    #[test]
    fn scoping_prefixes_every_selector_in_a_list() {
        let scoped = scope(".hl-a, .hl-b .hl-c {\n color: red;\n}\n", &[":root[x]"]);
        assert_eq!(
            scoped.trim(),
            ":root[x] .hl-a, :root[x] .hl-b .hl-c {\n color: red;\n}"
        );
    }

    /// What `@media print` leans on: one copy of the light theme covering every
    /// palette it has to talk a printer out of, rather than one copy each.
    #[test]
    fn scoping_takes_more_than_one_prefix_at_a_time() {
        let scoped = scope(".hl-a {\n color: red;\n}\n", &[".x", ".y"]);
        assert_eq!(scoped.trim(), ".x .hl-a, .y .hl-a {\n color: red;\n}");
    }

    #[test]
    fn scoping_drops_the_generated_comment() {
        let scoped = scope(
            "/*\n * theme \"X\"\n */\n\n.hl-a {\n color: red;\n}\n",
            &[".s"],
        );
        assert!(!scoped.contains("theme"), "{scoped}");
        assert!(scoped.starts_with(".s .hl-a {"), "{scoped}");
    }
}
