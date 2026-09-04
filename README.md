# mark

<img width="1356" height="894" alt="image" src="https://github.com/user-attachments/assets/e713691a-8363-4ff6-bbb6-66c837bd3330" />

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

**Linux.**

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

**Windows.** Download `mark-setup-x64.exe` from the
[`latest` prerelease](https://github.com/marcos-venicius/mark/releases/tag/latest),
which is rebuilt from `main` on every push. It installs for the current user
only — `%LOCALAPPDATA%\Programs\mark`, no administrator prompt, an entry in the
Start Menu, and an uninstaller in "Installed apps" that takes the registry keys
with it.

Installing puts `mark` in the **Open with** menu of `.md`, `.markdown`,
`.mdown`, `.mkd`, `.mkdn` and `.mdx`. It does not make `mark` the default for
any of them, and no installer can: the value Windows reads to decide that is
hash-protected, precisely so that programs cannot claim a file type behind the
reader's back. Choose `mark` once with "Always use this app" and the double
click works from then on.

The installer does not touch `PATH`. To keep using `mark file.md` from a
terminal, add `%LOCALAPPDATA%\Programs\mark` to it, or carry on with the plain
`mark-windows-x64.exe` from the same prerelease — a single file that needs no
installation and nothing but Windows itself.

## Usage

```
mark <file>       Open a Markdown file in a window
mark --help       Show usage
mark --version    Show the version

-f, --foreground  Keep hold of the terminal instead of detaching from it
```

On Unix `mark` hands the terminal straight back — the prompt returns in about
30 ms and the window keeps running on its own, so closing the terminal does not
take it with it. Bad arguments are still reported before that happens, with a
non-zero exit code. `--foreground` turns it off, which is what you want when
running `mark` under a supervisor or capturing its output.

On Windows there is nothing to hand back: the binary is a GUI program, so it
never takes the console over, and nothing flashes up when a `.md` file is opened
from Explorer. `--help`, `--version` and argument errors still print — the
process borrows the console it was launched from for as long as it takes to
write them, and a redirection such as `mark --version > version.txt` is honoured
as usual. What a GUI program cannot do is make the shell wait for it: the prompt
comes back before the text does, and `%ERRORLEVEL%` is not the program's, so a
script that needs the exit code wants `start /wait mark --version`.
`--foreground` is accepted and does nothing there.

The same help is inside the window: <kbd>?</kbd> or <kbd>F1</kbd> opens a panel
with the version, the command line and every shortcut, and there is a small `?`
in the corner for anyone who has not read this far. On Windows that panel is the
practical way to see it — a document opened from Explorer never passes a prompt.

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
- **Light and dark**, following the system by default and switching with it while
  the window is open. Pressing <kbd>D</kbd> picks one outright and is remembered
  between runs; <kbd>Shift</kbd> <kbd>D</kbd> goes back to following the system.
  Both the interface and the syntax highlighting change.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Ctrl</kbd> <kbd>+</kbd> / <kbd>-</kbd> | Zoom in, zoom out |
| <kbd>Ctrl</kbd> <kbd>0</kbd> | Reset zoom |
| <kbd>Ctrl</kbd> scroll | Zoom |
| <kbd>/</kbd> or <kbd>Ctrl</kbd> <kbd>F</kbd> | Find in page |
| <kbd>Enter</kbd> / <kbd>Shift</kbd> <kbd>Enter</kbd> | Next, previous match |
| <kbd>T</kbd> | Show or hide the table of contents |
| <kbd>D</kbd> | Switch between light and dark |
| <kbd>Shift</kbd> <kbd>D</kbd> | Go back to following the system |
| <kbd>Alt</kbd> <kbd>←</kbd> / <kbd>→</kbd> | Back, forward |
| <kbd>Home</kbd> / <kbd>End</kbd> | Top, bottom |
| <kbd>Ctrl</kbd> <kbd>P</kbd> | Print, or save as PDF |
| <kbd>Ctrl</kbd> <kbd>R</kbd> | Reload from disk |
| <kbd>?</kbd> or <kbd>F1</kbd> | Show the help panel |
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

Both palettes are written out in full, and both are scoped. Leaving the light one
unscoped would be the obvious shortcut, but a syntax theme only emits rules for
the scopes it actually colours — so wherever the dark theme has nothing to say,
the light colour would show through. That surfaces as a single stray token in one
language, which is exactly the sort of thing nobody notices for months.

The fork that detaches from the terminal happens before anything starts a thread
or touches GTK. Forking past either leaves the child holding locks that nothing
will ever release, so the order is not incidental.

The shortcut list is written down once, as a table in `main.rs`. `--help` lays it
out as a column of text and the help panel as rows of keys, so a shortcut added
in one place cannot be missing from the other — which matters most on Windows,
where the panel is the only copy a reader is likely to see.

Windows has no fork, and a console application cannot give its console back. The
equivalent is being a GUI program from the start, which is what the binary is —
at the price of having no console at all, not even for `--version`. So the few
things `mark` prints attach to the console of whoever launched it and fill in the
standard handles by hand, leaving alone any the shell had already provided, which
is what keeps redirection working. Nothing stays attached: a window tied to the
terminal it came from would close with it.

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

And one build dependency, on Windows only, linked into nothing:

| Crate | Why |
| --- | --- |
| [`winresource`](https://crates.io/crates/winresource) | Compiles the icon into `mark.exe`, which cargo will not do on its own |

Two fonts are bundled as well, both under the SIL Open Font Licence 1.1:
[Inter](https://github.com/rsms/inter) and
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono). Latin and Latin
Extended subsets only, about 190 KB in total.

The two system libraries are `webkit2gtk-4.1`, which is the renderer itself, and
`libsoup-3.0`, its HTTP stack. Both come from the distribution; neither is
bundled.

## Not supported yet

Mermaid diagrams and LaTeX formulas are not in this version. See
[FUTURE.md](FUTURE.md) for what each would involve.

## Development

```sh
cargo test          # rendering and protocol tests
cargo clippy        # lints
cargo run -- example.md
```
