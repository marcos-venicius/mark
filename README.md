# mark

A Markdown viewer with exactly one job. `mark <file>` opens a window, renders
that file, and stays out of the way.

No editor, no preview pane, no browser tab. It reads the file, highlights the
code, shows the images, and reloads when you save.

The binary is about 3.4 MB and carries everything it needs: the stylesheet, the
page script, and the two fonts. There is no bundled browser, no frontend build
step, and nothing written to disk at runtime.

## Requirements

Rust 1.85 or newer to build.

**Linux.** The window is a native WebKitGTK view, so the development headers are
needed to compile:

```sh
sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev
```

At runtime only `libwebkit2gtk-4.1-0` is required, and most desktops already
have it — it is what GNOME's own apps use.

**Windows.** Nothing to install. The window uses WebView2, which ships with
Windows 11 and is available as a bootstrapper for Windows 10.

## Install

```sh
./install.sh
```

That builds in release mode and copies the binary to `~/.local/bin/mark`. Set
`PREFIX` to install elsewhere.

Or do it by hand:

```sh
cargo build --release
cp target/release/mark ~/.local/bin/
```

## Usage

```
mark <file>       Open a Markdown file in a window
mark --help       Show usage
mark --version    Show the version
```

## What it renders

- **GitHub Flavored Markdown** — tables, task lists, strikethrough, autolinks,
  footnotes, description lists, superscript.
- **Syntax highlighting** with the language set `bat` uses, so TSX, TOML,
  Dockerfile and the rest are covered rather than just the classics. Each block
  is labelled with its language.
- **Images**, local or remote. Local paths are resolved relative to the document,
  including ones that point up a directory.
- **Alerts** — GitHub's `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`
  and `> [!CAUTION]` callouts.
- **Inline HTML**, for the things Markdown has no syntax for.
- **YAML front matter** is recognised and hidden instead of rendered as prose.
- **Live reload.** Save the file in your editor and the window updates without
  losing your place in the document.
- **A table of contents** in the sidebar, tracking the section you are reading.
  It appears for documents with at least three headings.
- **Links between documents.** Clicking a relative link to another `.md` opens it
  in the same window, with back and forward history. Links to the web open in
  your default browser; other files open in whatever application owns them.
- **Bundled typography** — Inter for text, JetBrains Mono for code, compiled into
  the binary so a document reads the same on a machine that has neither. See
  [src/assets/fonts/README.md](src/assets/fonts/README.md).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Ctrl</kbd> <kbd>+</kbd> / <kbd>-</kbd> | Zoom in, zoom out |
| <kbd>Ctrl</kbd> <kbd>0</kbd> | Reset zoom |
| <kbd>Ctrl</kbd> scroll | Zoom |
| <kbd>/</kbd> or <kbd>Ctrl</kbd> <kbd>F</kbd> | Find in page |
| <kbd>Enter</kbd> / <kbd>Shift</kbd> <kbd>Enter</kbd> | Next, previous match |
| <kbd>T</kbd> | Show or hide the table of contents |
| <kbd>Alt</kbd> <kbd>←</kbd> / <kbd>→</kbd> | Back, forward |
| <kbd>Home</kbd> / <kbd>End</kbd> | Top, bottom |
| <kbd>Ctrl</kbd> <kbd>R</kbd> | Reload from disk |
| <kbd>Ctrl</kbd> <kbd>Q</kbd> or <kbd>Esc</kbd> | Quit |

## How it works

`mark` is a single Rust binary. There is no bundled browser and no frontend build
step; the stylesheet and the page script are compiled into the executable.

```
mark <file>
  |
  |-- render.rs     Markdown -> HTML   (comrak + syntect)
  |-- protocol.rs   the mark:// scheme (embedded assets + local files)
  |-- watcher.rs    filesystem watch -> live reload
  '-- main.rs       window, webview, navigation history
```

Relative URLs are made absolute while the Markdown is rendered, before the markup
ever reaches the webview. That is not cosmetic: a webview resolves a relative URL
against the page address and flattens a leading `../` in the process, so an image
one directory up would otherwise never be found.

On Unix the webview is attached through the window's GTK container rather than
through a raw window handle. wry's generic path only accepts an X11 handle, so a
session running natively on Wayland is refused outright — worth knowing before
testing a change with `GDK_BACKEND=x11`, which hides the problem.

Saving a file has to be told apart from reading one. Rendering opens the document,
which the filesystem reports as an access; treating that as a change would make
the viewer refresh itself forever, so only writes, renames and deletions count.

The document is served to the webview over a custom `mark://` scheme rather than
`file://`, which is what makes relative image paths resolve correctly no matter
where the file lives.

Because documents may contain inline HTML, the page runs under a Content Security
Policy that permits local assets and remote images and nothing else — no scripts
from the document, no outbound requests. The protocol handler additionally only
serves file types a renderer has a reason to load, so a document cannot point the
window at `~/.ssh/id_rsa`.

Remote images are fetched when a document references them, exactly as a browser
would. If that matters for a given file, it is worth knowing before opening it.

## Dependencies

| Crate | Why |
| --- | --- |
| [`wry`](https://crates.io/crates/wry) | The webview: WebKitGTK on Linux, WebView2 on Windows |
| [`tao`](https://crates.io/crates/tao) | The window and the event loop |
| [`comrak`](https://crates.io/crates/comrak) | CommonMark and GFM parsing and HTML output |
| [`syntect`](https://crates.io/crates/syntect) | Syntax highlighting, and the stylesheet for it |
| [`two-face`](https://crates.io/crates/two-face) | The extended syntax and theme set `bat` ships |
| [`notify`](https://crates.io/crates/notify) | Filesystem watching for live reload |
| [`mime_guess`](https://crates.io/crates/mime_guess) | Content types for served files |
| [`percent-encoding`](https://crates.io/crates/percent-encoding) | Encoding file paths into URLs |
| [`serde_json`](https://crates.io/crates/serde_json) | Messages between the page and Rust |
| [`open`](https://crates.io/crates/open) | Handing links to the desktop |
| [`anyhow`](https://crates.io/crates/anyhow) | Error reporting |

Two fonts are bundled as well, both under the SIL Open Font Licence 1.1:
[Inter](https://github.com/rsms/inter) and
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono). Latin and Latin
Extended subsets only, about 190 KB in total.

The two system libraries are `webkit2gtk-4.1`, which is the renderer itself, and
`libsoup-3.0`, its HTTP stack. Both come from the distribution; neither is
bundled.

## Not supported yet

Dark theme, Mermaid diagrams and LaTeX formulas are not in this version. See
[FUTURE.md](FUTURE.md) for what each would involve.

## Development

```sh
cargo test          # rendering and protocol tests
cargo clippy        # lints
cargo run -- example.md
```
