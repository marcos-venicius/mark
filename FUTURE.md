# Future work

Things deliberately left out of the first version, with notes on what it would
take to add them.

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
- A `.desktop` entry so `mark` shows up under "Open with" for `.md` files.
- Remember window size and the sidebar state between runs.
- Jump to the fragment when following a link like `other.md#section`; today the
  file opens at the top.
- A presentation mode that splits the document on `---`.
- Multiple documents in tabs.
