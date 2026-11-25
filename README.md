# mark

<img width="1366" height="1052" alt="image" src="https://github.com/user-attachments/assets/a07debfc-3ae1-41e1-9038-e42cb7974a58" />

A Markdown viewer with exactly one job. `mark <file>` opens a window, renders
that file, and stays out of the way.

No editor, no preview pane, no browser tab. It reads the file, highlights the
code, shows the images, and reloads when you save.

The binary is about 4.7 MB and carries everything it needs: the stylesheet, the
page script, the two fonts, the diagram renderer and the formula renderer. There
is no bundled browser, no frontend build step, and nothing written to disk at
runtime.

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

That builds in release mode, copies the binary to `~/.local/bin/mark`, and
registers `mark` with the desktop: an icon in the hicolor theme, a `mark.desktop`
entry, and a MIME package claiming `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`
and `.mdx`. Right-click one of those in a file manager and `mark` is in **Open
With**; tick "always use" once and the double click works from then on. Set
`PREFIX` to install elsewhere — everything follows it, including the data
directories.

```sh
./uninstall.sh
```

removes all five files again and refreshes the same caches. Pass the same
`PREFIX` it was installed with.

Or just the binary, by hand, with no desktop entry:

```sh
cargo build --release
cp target/release/mark ~/.local/bin/
```

**Windows.** Download `mark-setup-x64.exe` from the
[latest release](https://github.com/marcos-venicius/mark/releases/latest). Releases
are numbered with [Semantic Versioning](https://semver.org), and
[CHANGELOG.md](CHANGELOG.md) says what is in each one. It installs for the current user
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
`mark-windows-x64.exe` from the same release — a single file that needs no
installation and nothing but Windows itself.

## Usage

```
mark <file>       Open a Markdown file in a window
mark              Open an empty window and choose a file there
mark --help       Show usage
mark --version    Show the version

-f, --foreground  Keep hold of the terminal instead of detaching from it
```

With no file, the window opens on the empty state: a message, a button that
opens the desktop's own file chooser, whatever was last closed offered back, and
the version underneath.
A Markdown file dropped anywhere on the window opens too, whether there is a
document in it already or not. <kbd>Esc</kbd> closes the document and comes back
here rather than quitting, so a stray press costs one click; <kbd>Ctrl</kbd>
<kbd>Q</kbd> is what closes the window.

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
  is labelled with its language in one corner, and carries a copy button in the
  other, which says so when it has copied.
- **Images**, local or remote. Local paths are resolved relative to the document,
  including ones that point up a directory.
- **Alerts** — GitHub's `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`
  and `> [!CAUTION]` callouts.
- **Mermaid diagrams.** A ```` ```mermaid ```` fence is drawn where it stands,
  by a renderer compiled into the binary, so it works with no network. A fence
  that will not parse keeps its source and says why. Click a diagram, or press
  <kbd>Enter</kbd> on it, and it opens over the window: drag to move it, the
  wheel or <kbd>+</kbd> <kbd>-</kbd> to zoom, <kbd>0</kbd> to fit it again,
  <kbd>Esc</kbd> to put it back. <kbd>Ctrl</kbd> <kbd>C</kbd> there, or the
  copy button in its corner, puts it on the clipboard as a PNG — in the palette
  on screen, with the page colour behind it.
- **Maths.** `$x$` and `$$x$$`, `` $`x`$ `` and a ```` ```math ```` fence, typeset
  by a KaTeX compiled into the binary alongside the diagram renderer. A formula
  that will not parse is written out where it stands.
- **The source, a key away.** <kbd>Ctrl</kbd> <kbd>U</kbd> swaps the page for
  the file as it was written, with line numbers, wrapped like an editor's soft
  wrap, and kept at the place you were reading; the same key brings the page
  back, and so does <kbd>Esc</kbd>. Select any part of it and copy, and the
  clipboard gets the Markdown and never the numbers. <kbd>Ctrl</kbd>
  <kbd>Shift</kbd> <kbd>C</kbd>, or the copy button in the bar, copies the whole
  file from either view. Printing always prints the page.
- **Inline HTML**, for the things Markdown has no syntax for.
- **YAML front matter** is recognised and hidden instead of rendered as prose.
- **Live reload.** Save the file in your editor and the window updates without
  losing your place in the document.
- **A table of contents** in the sidebar, tracking the section you are reading.
  It appears for documents with at least three headings; <kbd>T</kbd> shows or
  hides it, and that answer is remembered between runs.
- **Links between documents.** Clicking a relative link to another `.md` opens it
  in the same window, at the heading it names if it names one
  (`other.md#section`), with back and forward history. Links to the web open in
  your default browser; other files open in whatever application owns them.
- **A bar across the top** — back and forward, reload, the file's folder and its full path, the table of contents,
  find in page, the source view, copying the source, print, the theme menu, and the help panel, with the name of the
  open file in the middle. Every button is also a key, and its tooltip says which
  one, so the shortcuts are there to be picked up rather than looked up.
- **Bundled typography** — Inter for text, JetBrains Mono for code, compiled into
  the binary so a document reads the same on a machine that has neither. See
  [src/assets/fonts/README.md](src/assets/fonts/README.md).
- **Eight themes** — light, dark, Catppuccin Mocha, Gruvbox Dark, Blacksite and
  Sereno light and dark, or the system, which it follows by default and switches
  with while the window is open.
  The button in the bar opens the list; <kbd>D</kbd> walks it and the choice is
  remembered between runs, and <kbd>Shift</kbd> <kbd>D</kbd> goes back to
  following the system. The interface and the syntax highlighting change
  together.
- **It comes back the way you left it.** The window's size, whether it was
  maximised, the sidebar and the wide measure (<kbd>Z</kbd>) are remembered
  between runs, alongside the theme — in the webview's own storage, not in a
  file of `mark`'s.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Ctrl</kbd> <kbd>+</kbd> / <kbd>-</kbd> | Zoom in, zoom out |
| <kbd>Ctrl</kbd> <kbd>0</kbd> | Reset zoom |
| <kbd>Ctrl</kbd> scroll | Zoom |
| <kbd>/</kbd> or <kbd>Ctrl</kbd> <kbd>F</kbd> | Find in page |
| <kbd>Enter</kbd> / <kbd>Shift</kbd> <kbd>Enter</kbd> | Next, previous match |
| <kbd>T</kbd> | Show or hide the table of contents |
| <kbd>Z</kbd> | Widen the document to the window, and back |
| <kbd>D</kbd> | Cycle through the themes |
| <kbd>Shift</kbd> <kbd>D</kbd> | Go back to following the system |
| <kbd>Alt</kbd> <kbd>←</kbd> / <kbd>→</kbd> | Back, forward |
| <kbd>Home</kbd> / <kbd>End</kbd> | Top, bottom |
| <kbd>Ctrl</kbd> <kbd>O</kbd> | Open a file |
| <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>O</kbd> | Show the file in its folder |
| <kbd>Ctrl</kbd> <kbd>P</kbd> | Print, or save as PDF |
| <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>P</kbd> | Copy the file's full path |
| <kbd>Ctrl</kbd> <kbd>R</kbd> | Reload from disk |
| <kbd>Ctrl</kbd> <kbd>U</kbd> | Show the Markdown source, or the page again |
| <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>C</kbd> | Copy the whole Markdown source |
| <kbd>?</kbd> or <kbd>F1</kbd> | Show the help panel |
| <kbd>Esc</kbd> | Dismiss, or close the document |
| <kbd>Ctrl</kbd> <kbd>Q</kbd> | Quit |

## How it works

`mark` is a single Rust binary. There is no bundled browser and no frontend build
step; the stylesheet and the page script are compiled into the executable.

```
mark <file>
  |
  |-- render.rs     Markdown -> HTML   (comrak + syntect)
  |-- protocol.rs   the mark:// scheme (embedded assets + local files)
  |-- watcher.rs    filesystem watch -> live reload
  |-- clipboard.rs  a copied diagram, held on the clipboard (GTK)
  |-- base64.rs     the pictures that cross into and out of the page as text
  '-- main.rs       window, webview, navigation history
```

Relative URLs are made absolute while the Markdown is rendered, before the markup
ever reaches the webview. That is not cosmetic: a webview resolves a relative URL
against the page address and flattens a leading `../` in the process, so an image
one directory up would otherwise never be found.

Every palette is written out in full, and every one is scoped. Leaving the light
one unscoped would be the obvious shortcut, but a syntax theme only emits rules
for the scopes it actually colours — so wherever the others have nothing to say,
the light colour would show through. That surfaces as a single stray token in one
language, which is exactly the sort of thing nobody notices for months.

Light and dark are written twice each, once for the system asking and once for
the reader picking, because a media query cannot be folded into an attribute
selector. Catppuccin, Gruvbox, Blacksite and the two Sereno need one copy
apiece: no desktop asks for them by name. Blacksite and Sereno are Helix themes
with no counterpart in bat, so their syntax colours are small themes built in
code from the same palettes.

On paper there is one palette, the light one, whichever was on screen. The
page's colours are set again for print, which works because every palette sets
the same tokens. The syntax colours are kept off paper instead: every theme but
the light one is screen-only, because syntax themes colour different scopes and
an override cannot reach the ones the light theme never names.

The fork that detaches from the terminal happens before anything starts a thread
or touches GTK. Forking past either leaves the child holding locks that nothing
will ever release, so the order is not incidental.

The shortcut list is written down once, as a table in `main.rs`. `--help` lays it
out as a column of text and the help panel as rows of keys, so a shortcut added
in one place cannot be missing from the other — which matters most on Windows,
where the panel is the only copy a reader is likely to see.

The bar across the top can do nothing the keys cannot: each button sends the
message its shortcut sends, and no part of it has a route into Rust of its own.
What it knows that the page does not — which file is open, and whether the
history has anywhere left to go — travels down with the document itself rather
than in a message of its own, so the two can never arrive out of order.

The window starts hidden. Its size is kept in the page's storage beside the
theme, and only the page can read that back — so the window is built, the page
loads, and its first message brings the size along; only then is the window
sized and shown. Resizing a window already on screen would be a jump the reader
watches, and on Wayland the compositor has placed it by then, going by the size
it had. A page that never answers is covered too: a timer shows the window
anyway after five seconds.

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

Neither the diagram renderer nor the formula renderer is asked for until a
document turns out to need it: both are stored in gzip and inflated once, so a
document with no fence and no formula in it pays for neither.

A diagram is drawn twice, once light and once dark, and the stylesheet shows one
of them. mermaid writes its colours into the SVG it produces, so a diagram is a
picture of the theme it was drawn in; the alternative to keeping both is
redrawing every diagram when the reader presses <kbd>D</kbd> — and having nothing
to put on paper when a dark page is printed, since the print dialog cannot wait
for a redraw. Twice and not once per theme: Catppuccin, Gruvbox, Blacksite and
Sereno Dark are dark pages, and the dark drawing reads correctly on all four, as
the light one does on Sereno Light. A formula needs none of that: KaTeX lays it
out as HTML and leaves the colour to the text around it, so one drawing is right
in both palettes and on paper.

Copying a diagram as a picture draws it as an SVG image onto a canvas, and an
image reaches nothing outside itself — not the page's fonts, and not a
`mark://` address. Left alone, its labels come out in whatever the system has
instead of Inter and no longer fit the boxes mermaid measured for them. So the
page's own Inter is written into the drawing first, as data URLs. The page
cannot fetch the font files to encode them, because the policy below refuses
every request, so `mark` hands them over already encoded, in a script it
generates the first time a diagram is copied.

On Linux the picture does not reach the clipboard through the page. Under
Wayland the clipboard holds a promise from the program that copied, not a copy,
so a diagram copied from a window that has since closed would paste as nothing.
`mark` puts the picture there itself, through GTK, which also says when another
program takes the clipboard over. Closing the window while the picture is still
there hides the window and keeps the process running, serving the picture,
until something else is copied — the model `wl-copy` uses. With
`--foreground`, that is also how long the terminal waits. Windows keeps what is
put on its clipboard after the program has gone, so there the page copies the
picture itself.

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
| [`flate2`](https://crates.io/crates/flate2) | Inflating the diagram and formula renderers, which are stored compressed |
| [`serde_json`](https://crates.io/crates/serde_json) | Messages between the page and Rust |
| [`open`](https://crates.io/crates/open) | Handing links to the desktop |
| [`gtk`](https://crates.io/crates/gtk) | The file chooser, on Linux -- already compiled by `tao` |
| [`anyhow`](https://crates.io/crates/anyhow) | Error reporting |

And one build dependency, on Windows only, linked into nothing:

| Crate | Why |
| --- | --- |
| [`winresource`](https://crates.io/crates/winresource) | Compiles the icon into `mark.exe`, which cargo will not do on its own |

mermaid is bundled too, under the MIT licence: the 3.5 MB UMD build, stored in
gzip and inflated the first time a document turns out to have a diagram in it.
See [src/assets/mermaid/README.md](src/assets/mermaid/README.md).

KaTeX is bundled the same way, also under the MIT licence: the UMD build in gzip,
its stylesheet, and the twenty `woff2` faces it draws with — about 360 KB in all.
See [src/assets/katex/README.md](src/assets/katex/README.md).

Two fonts are bundled as well, both under the SIL Open Font Licence 1.1:
[Inter](https://github.com/rsms/inter) and
[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono). Latin and Latin
Extended subsets only, about 190 KB in total.

The two system libraries are `webkit2gtk-4.1`, which is the renderer itself, and
`libsoup-3.0`, its HTTP stack. Both come from the distribution; neither is
bundled.

## Development

```sh
cargo test          # rendering and protocol tests
cargo clippy        # lints
cargo run -- examples/README.md
```

[`examples/`](examples/README.md) holds six documents that between them use everything
on this page — the Markdown, the highlighting, the diagrams, the formulas, the
images and each kind of link. They link to one another, so opening the first is also a way
to try the history keys.
