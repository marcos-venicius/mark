# Future work

Things left out of the first version, with notes on what it would take to add
them. All of these were deliberately deferred; nothing here is queued.

Opening a document by double-clicking it used to be the first note, and it is
done on both systems: an icon, a per-user installer and the registry entries on
Windows, and a desktop entry, a MIME package and an icon in the hicolor theme
on Linux, installed by `install.sh` and taken away again by `uninstall.sh`.

One thing that came out of it is worth keeping written down. Neither system lets
an application make itself the default for a file type. On Windows the
`UserChoice` key is hash-protected, and on Linux the choice lives in the
reader's own `mimeapps.list`. Both installers put `mark` in the "Open with"
menu; the reader picks it once. Anything promising a working double click
straight after installation is promising what the desktop will not do.

## Mermaid diagrams

Render ```mermaid fences as diagrams.

The fence already survives to the DOM with `class="language-mermaid"`, so the
work is embedding `mermaid.min.js` as an asset in `src/protocol.rs` and calling
it after each `setContent`. Cost: roughly 1 MB on the binary, and the page stops
being pure markup.

## LaTeX formulas

Render `$...$` and `$$...$$` as maths.

comrak already has the parsing side: setting `extension.math_dollars` (and
`math_code`) in `src/render.rs` emits the maths nodes. What is missing is KaTeX —
its script plus its font files, around 2 MB embedded, served over `mark://` and
run from `app.js` after each render.

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
