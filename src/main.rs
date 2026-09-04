//! mark -- open a Markdown file in a window and render it.

// Windows builds for the GUI subsystem. A console application cannot hand its
// console back the way the fork in `detach` does, and it flashes a console
// window up when a document is opened from Explorer; a GUI one does neither.
// The attribute is ignored on every other target. What it costs is a process
// with no console at all, which is what `attach_console` is for.
#![windows_subsystem = "windows"]

mod protocol;
mod render;
mod watcher;

use std::ffi::OsString;
use std::io::Write;
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

const BANNER: &str = "mark -- a Markdown viewer";

/// The command line, as a terminal sees it. The shortcuts are not part of it:
/// they live in `SHORTCUTS`, because the window has to show the same list.
const INVOCATION: &str = "\
Usage:
  mark <file>       Open a Markdown file in a window
  mark --help       Show this message
  mark --version    Show the version

Options:
  -f, --foreground  Keep hold of the terminal instead of detaching from it
";

/// Every shortcut, written down once. `usage` lays them out for a terminal and
/// `help_html` for the window, so one added here reaches both -- and the window
/// is the only help most readers on Windows will ever see, where a document
/// opened from Explorer never passes a prompt.
///
/// The keys are read a token at a time, `or` joining two ways of doing the same
/// thing. Whatever is written here has to survive both a monospaced column and a
/// row of `<kbd>` boxes.
const SHORTCUTS: &[(&str, &str)] = &[
    ("Ctrl +/-/0", "Zoom in, out, reset"),
    ("Ctrl scroll", "Zoom"),
    ("/ or Ctrl F", "Find in page"),
    ("Enter or Shift Enter", "Next, previous match"),
    ("t", "Toggle the table of contents"),
    ("d", "Switch between light and dark"),
    ("Shift D", "Go back to following the system"),
    ("Alt Left/Right", "Go back and forward between documents"),
    ("Home or End", "Top, bottom"),
    ("Ctrl P", "Print, or save as PDF"),
    ("Ctrl R", "Reload from disk"),
    ("? or F1", "Show this help"),
    ("Ctrl Q or Esc", "Quit"),
];

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
    /// The reader asked for a paper copy, or for the PDF the print dialog can
    /// write instead.
    Print,
    Quit,
}

fn main() {
    if let Err(error) = run() {
        print_err(&format!("mark: {error:#}\n"));
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let Some(Invocation { path, foreground }) = parse_args()? else {
        return Ok(());
    };

    if !foreground {
        detach();
    }

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
            Event::UserEvent(UserEvent::Print) => app.print(),

            Event::UserEvent(UserEvent::Open(href)) => app.open(&href, &proxy),
            Event::UserEvent(UserEvent::Back) => app.step(-1, &proxy),
            Event::UserEvent(UserEvent::Forward) => app.step(1, &proxy),

            _ => {}
        }
    });
}

/// What the command line asked for, or `None` when the run was only a question.
struct Invocation {
    path: PathBuf,
    foreground: bool,
}

fn parse_args() -> Result<Option<Invocation>> {
    let mut file: Option<OsString> = None;
    let mut foreground = false;

    for argument in std::env::args_os().skip(1) {
        match argument.to_str() {
            Some("-h" | "--help") => {
                print_out(&usage());
                return Ok(None);
            }
            Some("-V" | "--version") => {
                print_out(&format!("mark {}\n", env!("CARGO_PKG_VERSION")));
                return Ok(None);
            }
            Some("-f" | "--foreground") => foreground = true,
            Some(flag) if flag.starts_with('-') && flag != "-" => {
                bail!("unknown option '{flag}' (try --help)");
            }
            _ if file.is_some() => bail!("expected exactly one file (try --help)"),
            _ => file = Some(argument),
        }
    }

    let Some(file) = file else {
        // Being called with no file is a mistake, not a request for help, so the
        // usage goes to stderr and the exit code says so.
        print_err(&usage());
        std::process::exit(2);
    };

    let path = absolute(Path::new(&file));
    if !path.is_file() {
        bail!("'{}' is not a file", path.display());
    }
    Ok(Some(Invocation { path, foreground }))
}

/// Hand the terminal back to the shell and keep running.
///
/// This happens after the arguments are checked, so a bad path is still reported
/// where the person typing can see it, and before anything starts a thread or
/// touches GTK -- forking past either of those leaves the child holding locks
/// that nobody will ever release.
///
/// stderr stays attached when it is a terminal, so a window that fails to open
/// after the prompt came back still says why. When it is anything else it is
/// closed: a detached process holding a pipe open blocks whoever is reading it,
/// which would hang `mark file | cat` and every command substitution. Use
/// `--foreground` to keep the whole thing wired up.
#[cfg(unix)]
fn detach() {
    // SAFETY: single-threaded at this point, and the child does nothing between
    // the fork and exec-less continuation that is not async-signal-safe.
    unsafe {
        match libc::fork() {
            // Out of processes, or not permitted. Staying in the foreground is a
            // better outcome than refusing to open the file.
            -1 => return,
            0 => {}
            // The parent's only remaining job is to release the shell. _exit
            // skips the atexit handlers and buffer flushes the child now owns.
            _ => libc::_exit(0),
        }

        // Leave the terminal's session so closing it does not take us with it.
        libc::setsid();

        let devnull = libc::open(c"/dev/null".as_ptr(), libc::O_RDWR);
        if devnull >= 0 {
            libc::dup2(devnull, libc::STDIN_FILENO);
            libc::dup2(devnull, libc::STDOUT_FILENO);
            if libc::isatty(libc::STDERR_FILENO) != 1 {
                libc::dup2(devnull, libc::STDERR_FILENO);
            }
            if devnull > libc::STDERR_FILENO {
                libc::close(devnull);
            }
        }
    }
}

/// There is nothing to detach from: a GUI-subsystem process never held a console
/// in the first place, so the prompt was never taken away. See the attribute at
/// the top of this file, and `attach_console` for the other half of the bargain.
#[cfg(not(unix))]
fn detach() {}

/// Everything `mark` says for itself goes through these two, because on Windows
/// there may be no terminal to say it to until one is asked for.
///
/// The write is `print!`'s job everywhere else, but `print!` panics when there is
/// nowhere to write -- which on Windows is an ordinary situation, a document
/// opened from Explorer with nothing redirected. A viewer that aborts over an
/// unread `--version` would be a poor trade for a message nobody can see, so the
/// error is dropped instead.
fn print_out(text: &str) {
    attach_console();
    let _ = std::io::stdout().write_all(text.as_bytes());
}

fn print_err(text: &str) {
    attach_console();
    let _ = std::io::stderr().write_all(text.as_bytes());
}

/// Borrow the console of whoever launched us, for as long as it takes to print.
///
/// A GUI-subsystem process starts without one, so `--help`, `--version` and a
/// bad argument would otherwise be written to handles that do not exist. The
/// standard slots have to be filled in by hand as well: they are inherited from
/// the parent, and a program with no console inherits nothing.
///
/// Only the paths that print and then exit call this. Staying attached for the
/// life of the window would tie the document to that terminal -- closing the
/// terminal would send the window a close event, which is the thing detaching
/// exists to prevent.
#[cfg(windows)]
fn attach_console() {
    use std::ptr;
    use windows_sys::core::w;
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Console::{
        AttachConsole, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE,
        STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };

    // SAFETY: plain Win32 calls. The only pointers handed over are the two wide
    // string literals, which are static, and a null where the call accepts one.

    // Fails when there is no console to attach to -- opened from Explorer, say.
    // Nothing can be done about that and nothing needs to be: the loop below
    // still has the redirected case to deal with.
    let _ = unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };

    // `mark --version > version.txt` inherits a real handle for stdout from the
    // shell, redirection being the shell's job and not the subsystem's.
    // Overwriting it would put the text on the console and leave the file empty,
    // so only the empty slots are filled in.
    for (slot, device) in [
        (STD_INPUT_HANDLE, w!("CONIN$")),
        (STD_OUTPUT_HANDLE, w!("CONOUT$")),
        (STD_ERROR_HANDLE, w!("CONOUT$")),
    ] {
        let inherited = unsafe { GetStdHandle(slot) };
        if !inherited.is_null() && inherited != INVALID_HANDLE_VALUE {
            continue;
        }

        // Both console devices are opened for reading and writing, which is what
        // they expect however the handle is used afterwards. Without a console
        // this fails, and the slot is left as it was: empty, and printing to it
        // goes nowhere rather than anywhere wrong.
        let opened = unsafe {
            CreateFileW(
                device,
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        if opened != INVALID_HANDLE_VALUE {
            // Only fails on a slot that is not one of the three, and those are
            // the three literals above.
            let _ = unsafe { SetStdHandle(slot, opened) };
        }
    }
}

/// Everywhere else the streams are already wired up -- inherited from the shell,
/// or pointed at /dev/null by `detach`.
#[cfg(not(windows))]
fn attach_console() {}

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

    /// Hand the rendered page to the platform's print dialog.
    ///
    /// There is no PDF writer here and there does not need to be: both dialogs
    /// already have one. GTK offers "Print to File", which writes PDF, and the
    /// WebView2 preview offers "Save as PDF". What the document looks like on
    /// the way out is the `@media print` block in the stylesheet.
    ///
    /// The error is dropped because there is nothing useful to do with it. The
    /// window has already been drawn, so a failure here means the desktop has no
    /// print system to offer, and saying so on a stderr that was closed at
    /// startup would not reach anyone.
    fn print(&self) {
        let _ = self.webview.print();
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
        "print" => Some(UserEvent::Print),
        "quit" => Some(UserEvent::Quit),
        "back" => Some(UserEvent::Back),
        "forward" => Some(UserEvent::Forward),
        "open" => Some(UserEvent::Open(message.get("href")?.as_str()?.to_string())),
        _ => None,
    }
}

/// The whole of `--help`, in a column wide enough for the longest set of keys.
fn usage() -> String {
    let width = SHORTCUTS
        .iter()
        .map(|(keys, _)| keys.len())
        .max()
        .unwrap_or(0);
    let mut text = format!("{BANNER}\n\n{INVOCATION}\nShortcuts (inside the window):\n");
    for (keys, what) in SHORTCUTS {
        text.push_str(&format!("  {keys:width$}  {what}\n"));
    }
    text
}

/// The same thing again for the panel inside the window, which is where the help
/// is actually read. The usage block is the terminal's text verbatim; only the
/// shortcuts are laid out differently, as keys rather than as a column.
fn help_html() -> String {
    let mut html = format!(
        "<h2 id=\"help-title\">mark {}</h2>\
         <p class=\"help-heading\">Shortcuts</p>\
         <div class=\"help-rows\">",
        env!("CARGO_PKG_VERSION"),
    );
    for (keys, what) in SHORTCUTS {
        html.push_str(&format!(
            "<div class=\"help-keys\">{}</div><div>{}</div>",
            keys_html(keys),
            escape(what),
        ));
    }
    // The command line comes second and may well be scrolled past: inside the
    // window the document is already open, and the keys are what is being
    // looked for.
    html.push_str(&format!(
        "</div>\
         <p class=\"help-heading\">Usage</p>\
         <pre class=\"help-usage\">{}</pre>",
        escape(INVOCATION.trim_end()),
    ));
    html
}

/// One `<kbd>` per key. `or` is prose rather than a key, and stays as it is.
fn keys_html(keys: &str) -> String {
    keys.split(' ')
        .map(|token| {
            if token == "or" {
                token.to_string()
            } else {
                format!("<kbd>{}</kbd>", escape(token))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The page, with the syntax palette, the asset URLs and the help filled in.
fn build_shell() -> String {
    include_str!("assets/shell.html")
        .replace("/*{{SYNTAX_CSS}}*/", &Renderer::syntax_css())
        .replace("{{STYLE_URL}}", &protocol::url("/__mark__/style.css"))
        .replace("{{APP_URL}}", &protocol::url("/__mark__/app.js"))
        .replace("{{HELP}}", &help_html())
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The two renderings of the shortcut table drift apart the moment one of
    /// them is written by hand, and the window is the copy nobody can check from
    /// a terminal.
    #[test]
    fn every_shortcut_reaches_both_the_terminal_and_the_window() {
        let usage = usage();
        let shell = build_shell();

        for (keys, what) in SHORTCUTS {
            assert!(usage.contains(keys), "{keys} is missing from --help");
            assert!(usage.contains(what), "'{what}' is missing from --help");
            assert!(
                shell.contains(what),
                "'{what}' is missing from the help panel"
            );

            for key in keys.split(' ').filter(|token| *token != "or") {
                let boxed = format!("<kbd>{key}</kbd>");
                assert!(shell.contains(&boxed), "{key} is not a key in the panel");
            }
        }
    }

    /// A placeholder left behind is a hole in the page that only shows up on
    /// screen, since the shell is otherwise valid HTML either way.
    #[test]
    fn the_shell_has_nothing_left_to_fill_in() {
        let shell = build_shell();
        assert!(
            !shell.contains("{{"),
            "an unreplaced placeholder is still there"
        );
    }

    /// The extensions the Windows installer registers, read back out of the
    /// script. Nothing else in the build looks at that file from a machine that
    /// can run the tests.
    fn registered_extensions() -> Vec<String> {
        include_str!("../windows/mark.iss")
            .lines()
            .filter_map(|line| line.split("Software\\Classes\\.").nth(1))
            .filter_map(|rest| rest.split('\\').next())
            .map(|ext| ext.to_owned())
            .collect()
    }

    /// The installer claims a file type on behalf of a program that would then
    /// refuse to open it -- a document in the "Open with" menu that greets the
    /// reader with an error.
    #[test]
    fn every_registered_extension_is_one_mark_opens() {
        let registered = registered_extensions();
        assert!(!registered.is_empty(), "the .iss registers nothing at all");

        for ext in registered {
            assert!(
                MARKDOWN_EXTENSIONS.contains(&ext.as_str()),
                ".{ext} is registered but mark refuses to open it"
            );
        }
    }

    /// The other direction is deliberately not an equality: mark opens .txt, and
    /// putting a Markdown viewer in the "Open with" menu of every text file on
    /// the machine is not a thing it gets to do.
    #[test]
    fn plain_text_is_not_claimed() {
        assert!(
            !registered_extensions().iter().any(|ext| ext == "txt"),
            "the installer claims .txt"
        );
    }

    /// Windows picks the entry closest to the size it wants and scales whatever
    /// it finds, so a missing 16 is not an error anywhere -- it is a blurry
    /// icon in the taskbar, on a machine none of this is built on.
    #[test]
    fn the_icon_carries_every_size_windows_asks_for() {
        const ICON: &[u8] = include_bytes!("../assets/mark.ico");
        const WANTED: [u32; 7] = [256, 128, 64, 48, 32, 24, 16];

        assert_eq!(&ICON[0..4], &[0, 0, 1, 0], "not an .ico");

        let count = u16::from_le_bytes([ICON[4], ICON[5]]) as usize;
        let sizes: Vec<u32> = (0..count)
            .map(|n| {
                // Each directory entry is 16 bytes, and its width byte holds 0
                // for 256 -- the field is a single byte and 256 does not fit.
                let width = ICON[6 + n * 16];
                if width == 0 {
                    256
                } else {
                    u32::from(width)
                }
            })
            .collect();

        for wanted in WANTED {
            assert!(sizes.contains(&wanted), "the icon has no {wanted} px entry");
        }
    }
}
