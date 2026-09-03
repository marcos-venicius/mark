//! mark -- open a Markdown file in a window and render it.

mod protocol;
mod render;
mod watcher;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{bail, Context, Result};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Window, WindowBuilder};
use wry::{WebView, WebViewBuilder};

use render::Renderer;
use watcher::FileWatcher;

const USAGE: &str = "\
mark -- a Markdown viewer

Usage:
  mark <file>       Open a Markdown file in a window
  mark --help       Show this message
  mark --version    Show the version

Shortcuts (inside the window):
  Ctrl +/-/0        Zoom in, out, reset
  /                 Find in page
  t                 Toggle the table of contents
  Alt Left/Right    Go back and forward between documents
  Ctrl R            Reload from disk
  Ctrl Q            Quit
";

/// File types `mark` opens itself. Anything else is handed to the desktop.
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdx", "txt"];

/// Things that happen off the event loop and need the webview to react.
#[derive(Debug)]
enum UserEvent {
    /// The page finished loading and is ready to be filled in.
    Ready,
    /// The open file changed on disk.
    Changed,
    /// A link was activated.
    Open(String),
    Back,
    Forward,
    Reload,
    Quit,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("mark: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let Some(path) = parse_args()? else {
        return Ok(());
    };

    let doc_dir: render::DocDir = Arc::new(Mutex::new(parent_of(&path)));
    let renderer = Renderer::new(doc_dir.clone());
    let shell = build_shell();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title(title_for(&path))
        .with_inner_size(LogicalSize::new(1100.0, 820.0))
        .build(&event_loop)
        .context("could not open a window")?;

    let webview = build_webview(&window, doc_dir.clone(), shell, proxy.clone())?;

    let mut app = App {
        history: vec![path],
        cursor: 0,
        doc_dir,
        renderer,
        webview,
        window,
        watcher: None,
    };
    app.rewatch(&proxy);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control_flow = ControlFlow::Exit,

            Event::UserEvent(UserEvent::Quit) => *control_flow = ControlFlow::Exit,

            Event::UserEvent(UserEvent::Ready) => app.show(Placement::Top),
            Event::UserEvent(UserEvent::Changed) => app.show(Placement::Keep),
            Event::UserEvent(UserEvent::Reload) => app.show(Placement::Keep),

            Event::UserEvent(UserEvent::Open(href)) => app.open(&href, &proxy),
            Event::UserEvent(UserEvent::Back) => app.step(-1, &proxy),
            Event::UserEvent(UserEvent::Forward) => app.step(1, &proxy),

            _ => {}
        }
    });
}

/// Returns the file to open, or `None` when the run was only a question.
fn parse_args() -> Result<Option<PathBuf>> {
    let mut args = std::env::args_os().skip(1);
    let Some(first) = args.next() else {
        // Being called with no file is a mistake, not a request for help, so the
        // usage goes to stderr and the exit code says so.
        eprint!("{USAGE}");
        std::process::exit(2);
    };

    match first.to_str() {
        Some("-h" | "--help") => {
            print!("{USAGE}");
            return Ok(None);
        }
        Some("-V" | "--version") => {
            println!("mark {}", env!("CARGO_PKG_VERSION"));
            return Ok(None);
        }
        Some(flag) if flag.starts_with('-') && flag != "-" => {
            bail!("unknown option '{flag}' (try --help)");
        }
        _ => {}
    }

    if args.next().is_some() {
        bail!("expected exactly one file (try --help)");
    }

    let path = absolute(Path::new(&first));
    if !path.is_file() {
        bail!("'{}' is not a file", path.display());
    }
    Ok(Some(path))
}

/// Where the reader should end up after the page is replaced.
#[derive(Clone, Copy)]
enum Placement {
    /// Stay put -- used for reloads, so saving does not lose your place.
    Keep,
    Top,
}

struct App {
    history: Vec<PathBuf>,
    cursor: usize,
    doc_dir: render::DocDir,
    renderer: Renderer,
    webview: WebView,
    window: Window,
    watcher: Option<FileWatcher>,
}

impl App {
    fn current(&self) -> &Path {
        &self.history[self.cursor]
    }

    /// Read the current file, render it, and hand the result to the page.
    fn show(&self, placement: Placement) {
        let path = self.current();
        let body = match std::fs::read_to_string(path) {
            Ok(text) => self.renderer.render(&text),
            Err(error) => error_page(path, &error),
        };

        let keep_scroll = matches!(placement, Placement::Keep);
        let script = format!(
            "window.__mark.setContent({}, {})",
            serde_json::Value::from(body),
            serde_json::Value::from(keep_scroll),
        );
        let _ = self.webview.evaluate_script(&script);
    }

    /// Follow a link. Markdown opens here; everything else goes to the desktop.
    fn open(&mut self, href: &str, proxy: &EventLoopProxy<UserEvent>) {
        let Some(path) = protocol::path_from_url(href) else {
            let _ = open::that_detached(href);
            return;
        };

        if !is_markdown(&path) {
            let _ = open::that_detached(&path);
            return;
        }
        if !path.is_file() {
            return;
        }

        // A new destination truncates whatever was ahead, the way a browser does.
        self.history.truncate(self.cursor + 1);
        if self.current() != path {
            self.history.push(path);
            self.cursor += 1;
        }
        self.navigated(proxy);
    }

    fn step(&mut self, delta: isize, proxy: &EventLoopProxy<UserEvent>) {
        let Some(target) = self.cursor.checked_add_signed(delta) else {
            return;
        };
        if target >= self.history.len() {
            return;
        }
        self.cursor = target;
        self.navigated(proxy);
    }

    fn navigated(&mut self, proxy: &EventLoopProxy<UserEvent>) {
        *self.doc_dir.lock().expect("doc dir lock") = parent_of(self.current());
        self.window.set_title(&title_for(self.current()));
        self.rewatch(proxy);
        self.show(Placement::Top);
    }

    /// Point the live-reload watcher at whichever file is now open.
    fn rewatch(&mut self, proxy: &EventLoopProxy<UserEvent>) {
        let proxy = proxy.clone();
        self.watcher = watcher::watch(self.current(), move || {
            let _ = proxy.send_event(UserEvent::Changed);
        })
        .ok();
    }
}

fn build_webview(
    window: &Window,
    doc_dir: render::DocDir,
    shell: String,
    proxy: EventLoopProxy<UserEvent>,
) -> Result<WebView> {
    let origin = protocol::url("");

    let builder = WebViewBuilder::new()
        .with_custom_protocol("mark".to_string(), move |_id, request| {
            let dir = doc_dir.lock().expect("doc dir lock").clone();
            protocol::serve(&request, &dir, &shell)
        })
        .with_ipc_handler(move |request| {
            if let Some(event) = decode_message(request.body()) {
                let _ = proxy.send_event(event);
            }
        })
        // Every link is handled in Rust, so the webview itself should never leave
        // the page it was given. Anchors stay on the same origin and are allowed.
        .with_navigation_handler(move |url| url.starts_with(&origin))
        .with_url(protocol::url("/"));

    attach(builder, window).context("could not create the webview")
}

/// Put the webview into the window.
///
/// On Unix the generic builder only accepts an X11 window handle, so a session
/// running natively on Wayland is rejected outright. Going through the window's
/// own GTK container works on both.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn attach(builder: WebViewBuilder<'_>, window: &Window) -> wry::Result<WebView> {
    use tao::platform::unix::WindowExtUnix;
    use wry::WebViewBuilderExtUnix;

    // tao gives every window a vertical box to hold its content; packing into it
    // lets the webview follow the window as it resizes.
    match window.default_vbox() {
        Some(vbox) => builder.build_gtk(vbox),
        None => builder.build_gtk(window.gtk_window()),
    }
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
fn attach(builder: WebViewBuilder<'_>, window: &Window) -> wry::Result<WebView> {
    builder.build(window)
}

fn decode_message(body: &str) -> Option<UserEvent> {
    let message: serde_json::Value = serde_json::from_str(body).ok()?;
    match message.get("type")?.as_str()? {
        "ready" => Some(UserEvent::Ready),
        "reload" => Some(UserEvent::Reload),
        "quit" => Some(UserEvent::Quit),
        "back" => Some(UserEvent::Back),
        "forward" => Some(UserEvent::Forward),
        "open" => Some(UserEvent::Open(message.get("href")?.as_str()?.to_string())),
        _ => None,
    }
}

/// The page, with the syntax palette and asset URLs filled in.
fn build_shell() -> String {
    include_str!("assets/shell.html")
        .replace("/*{{SYNTAX_CSS}}*/", &Renderer::syntax_css())
        .replace("{{STYLE_URL}}", &protocol::url("/__mark__/style.css"))
        .replace("{{APP_URL}}", &protocol::url("/__mark__/app.js"))
}

/// Shown in place of the document when the file cannot be read -- during a save,
/// for instance, or after it is deleted.
fn error_page(path: &Path, error: &std::io::Error) -> String {
    format!(
        "<div class=\"error\"><h1>Cannot read this file</h1><p><code>{}</code></p><p>{}</p></div>",
        escape(&path.display().to_string()),
        escape(&error.to_string()),
    )
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;")
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MARKDOWN_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn title_for(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    format!("{name} \u{2014} mark")
}

fn parent_of(path: &Path) -> PathBuf {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Make a path absolute without requiring it to exist yet.
fn absolute(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    match std::env::current_dir() {
        Ok(cwd) => protocol::resolve(&cwd, &path.to_string_lossy()),
        Err(_) => path.to_path_buf(),
    }
}
