# Future work

Things left out of the first version, with notes on what it would take to add
them. All of these were deliberately deferred; nothing here is queued.

Opening a document by double-clicking it used to be the first note, and it is
done on both systems: an icon, a per-user installer and the registry entries on
Windows, and a desktop entry, a MIME package and an icon in the hicolor theme
on Linux, installed by `install.sh` and taken away again by `uninstall.sh`.

Mermaid diagrams were the second note and have shipped as well. Two things came
out of that one. The bundle is 3.5 MB rather than the 1 MB this file guessed --
1 MB is what it comes to in gzip, which is how it is stored, and `protocol.rs`
inflates it the first time a document turns out to have a fence. And the colours
mermaid uses are written into the SVG, so a diagram is a picture of the palette
it was drawn in: each one is drawn twice and the stylesheet shows one, which is
also the only way to print a dark page without waiting for a redraw.

One thing that came out of the double click is worth keeping written down.
Neither system lets an application make itself the default for a file type. On
Windows the `UserChoice` key is hash-protected, and on Linux the choice lives in
the reader's own `mimeapps.list`. Both installers put `mark` in the "Open with"
menu; the reader picks it once. Anything promising a working double click
straight after installation is promising what the desktop will not do.

## LaTeX formulas

Render `$...$` and `$$...$$` as maths.

comrak already has the parsing side: setting `extension.math_dollars` (and
`math_code`) in `src/render.rs` emits the maths nodes. What is missing is KaTeX —
its script plus its font files, around 2 MB embedded, served over `mark://` and
run from `app.js` after each render. The route is the one mermaid took: a packed
asset in `src/protocol.rs`, fetched by the page only when a document turns out to
need it. Unlike mermaid it needs no second pass for the dark palette -- KaTeX
draws in `currentColor`.

## Smaller ideas

- Export the rendered document to HTML. PDF is covered by Ctrl P, which
  hands the page to the print dialog; what is missing is a headless
  `mark --pdf out.pdf` for scripts, which needs the platform print APIs
  directly rather than a dialog.
- Remember window size and the sidebar state between runs.
- Jump to the fragment when following a link like `other.md#section`; today the
  file opens at the top.
- A presentation mode that splits the document on `---`.
- Multiple documents in tabs.
