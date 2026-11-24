# Changelog

What changed, and why where the why is not obvious. `README.md` says what `mark`
does today and `FUTURE.md` what it deliberately does not; this file is only the
record of how it got here.

Versions follow [Semantic Versioning](https://semver.org). Each one is a tag --
`v1.0.0` -- whose release on GitHub carries the Windows downloads and is marked
as the latest. What counts as a break is whatever a reader or a script has come
to rely on:

- **Major** -- something that worked stops working, or works differently: a
  command-line option removed or given a new meaning, a file type no longer
  claimed, a shortcut taken away or moved to another key.
- **Minor** -- something new, with nothing old changed: a feature, a shortcut, a
  theme, a file type.
- **Patch** -- a fix, and nothing a reader has to learn.

Work lands under an `## Unreleased` heading at the top of this file, and a
release renames that heading to its number and date. The section under a
version is also the text of its release on GitHub, cut out of this file by the
workflow rather than written twice.

Before 1.0.0 there were no numbers: a single release, `latest`, was rebuilt from
`main` on every push, and the entries from then are headed by the date the work
landed.

## Unreleased

A sixth theme, Blacksite: near-black with green phosphor, the palette of the
Helix theme of the same name. bat ships no syntax theme for it, so the code
colours are built from that same palette, mapping each Helix scope onto the
TextMate one that carries it.

Two more, Sereno Light and Sereno Dark: a pair of Helix themes for a lit room
and a dim one, warm off-white and soft charcoal, whose syntax colours share one
perceived lightness. Their code colours are built the same way as Blacksite's.
Sereno Light is the first light palette besides the default one; it shows the
light drawing of a diagram, and like every theme it prints as the default light
palette.

Printing from a dark theme no longer lets its code colours onto the paper. The
page itself was always printed in the light palette, but a code block kept some
of the screen theme's colours -- the braces, commas and operators of a Rust
block came out in the pale grey meant for a dark page, nearly invisible on
white. That was true of every theme but the light one, the default dark
included. Code now prints in the light theme's colours and nothing else.

## 1.1.0 — 2026-09-15

Diagrams can be taken out of the document: opened over the window, moved
about, zoomed, and copied as pictures.

### Added

- **A diagram viewer.** Clicking a mermaid diagram, or pressing <kbd>Enter</kbd>
  on one, opens it over the window: drag to move it, the wheel or <kbd>+</kbd>
  <kbd>-</kbd> to zoom around the pointer, <kbd>0</kbd> to fit it again, and
  <kbd>Esc</kbd> to put it back where it was. <kbd>D</kbd> still changes the
  theme while it is open. Reloading the document closes it.
- **Copy a diagram as a PNG**, from the viewer with <kbd>Ctrl</kbd>
  <kbd>C</kbd> or its button, or from the copy button in the diagram's corner.
  The picture is the palette on screen at twice the drawing's size, filled with
  the page colour so that a dark diagram still reads pasted somewhere white, and
  set in Inter like the page: the face travels inside the picture. On Linux the
  picture stays pasteable after the window closes: `mark` goes on running out
  of sight, holding it, until something else is copied.

## 1.0.0 — 2026-09-15

The first numbered version: everything in the entries below this one, and what
follows here.

Two of the smaller ideas in `FUTURE.md`: a link that names a heading in another
file lands on it, and the window comes back the way it was left.

### Added

- **Links land on the heading they name.** `other.md#section` opens the file at
  that section rather than at its top, once any diagrams and formulas above it
  have been drawn. A fragment that names no heading opens at the top, as before;
  back and forward still land at the top of the file.
- **The window remembers how it was left**: its size, whether it was maximised,
  the sidebar (<kbd>T</kbd>) and the wide measure (<kbd>Z</kbd>), beside the
  theme it already kept. All of it is in the webview's own storage; `mark` still
  writes no file of its own.
- **The version is on show**: under the buttons of the empty window, as well as
  in the title of the help panel where it already was, and at the top of the
  landing page.

### Changed

- **Releases are numbered.** Each version is a tag, and its release -- marked as
  the latest -- carries the Windows downloads, with this file's section for it
  as the notes. `main` is no longer published on every push; it is still built,
  as a check. The download links follow the newest version on their own.
- **The window appears once the page has loaded** rather than as soon as it
  exists, so that it opens at the remembered size instead of jumping to it. It
  no longer flashes white before a dark theme, either.
- **<kbd>Z</kbd> is remembered.** It used to reset with every window, on the
  grounds that the measure was a fact about one document; it turns out to be how
  a reader likes to read.
- Jumping to a heading inside the page finds headings with accents in them, and
  no longer mistakes a heading for part of the window that shares its id --
  a section called "Page" or "Help".
- <kbd>T</kbd> does nothing on a document with no headings, where there is no
  sidebar to show.

## 2026-09-09

Esc stops being a way out of the program and becomes one thing only: dismiss.
Around that, the window learns to sit there with no document in it, which is a
state it could not previously be in.

### Added

- **An empty state.** With no document open the window says so, and offers a
  button that opens the desktop's own file chooser. When something was just
  closed, a second button beside it offers that file back by name — the way out
  of an Esc nobody meant to press.
- **A file chooser**, on <kbd>Ctrl</kbd> <kbd>O</kbd> and on a new folder button
  at the left of the top bar. GTK's native dialog on Linux, `GetOpenFileNameW` on
  Windows. No new dependency for either: `gtk` was already compiled by `tao`, and
  `windows-sys` was already in `Cargo.toml`.
- **Drag and drop.** A Markdown file dropped anywhere on the window opens, over
  an empty window or over a document already being read. The window outlines
  itself while a file is above it, and ignores anything that is not Markdown.
- **`mark` with no argument** opens the empty window. This is also what the
  desktop entry passes: `Exec=mark %f` has nothing to substitute when `mark` is
  launched from a menu rather than from a file manager, so that launch used to do
  nothing anyone could see.

### Changed

- **<kbd>Esc</kbd> no longer quits.** It works down the things stacked on the
  document — the help panel, the theme menu, the find bar — and then closes the
  document itself. Pressing it once more does nothing. <kbd>Ctrl</kbd>
  <kbd>Q</kbd> is now the only way to close the window.
- **Closing keeps the history.** The entry the reader was on does not move, so
  reopening is exact even when the document was closed from the middle of a
  history — nothing ahead of it is thrown away, and Back and Forward still point
  where they did.
- The live-reload watcher is dropped when the document closes and pointed at the
  file again when it reopens.
- Printing, and the find bar on <kbd>/</kbd>, are refused with no document open.
  Their buttons in the bar were already disabled; the keys now agree with them.
- **The Windows download is a release rather than a prerelease.** It is the only
  release there is and it is what the README and the landing page send people to,
  so GitHub marking it "Latest" is the honest label. It is still the tip of `main`
  rebuilt on every push, and its notes now say so and link here.

### Removed

- `mark` with no arguments no longer prints the usage to stderr and exits with
  status 2. A file that *is* named and is not there is still an error, because an
  empty window would say nothing at all about the typo. Anything scripting that
  exit code gets a window instead.

### Also

- The shortcut table, and the three places that repeat it: the help panel and
  `--help` follow `SHORTCUTS` on their own; `README.md` and `docs/index.html`
  were updated by hand.
- Three new tests, 49 to 52: every `{"type": ...}` message the page sends is
  understood in Rust, every id in the empty state is wired up or styled, and
  <kbd>Ctrl</kbd> <kbd>Q</kbd> is the only key that quits.
