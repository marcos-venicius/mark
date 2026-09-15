# Changelog

What changed, and why where the why is not obvious. `README.md` says what `mark`
does today and `FUTURE.md` what it deliberately does not; this file is only the
record of how it got here.

There is one release, `latest`, and it is not a version: it is rebuilt from `main`
on every push and the tag moves with it. So nothing here waits to be released --
whatever is on `main` is what the download gives you -- and entries are headed
with the date the work landed rather than with a number.

## 2026-09-15

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

### Changed

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
