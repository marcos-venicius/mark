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

## Detaching from the console on Windows

On Unix `mark` forks and hands the terminal back. A Windows console application
cannot do that; the equivalent is building for the GUI subsystem with
`#![windows_subsystem = "windows"]`, which also stops a console window flashing
up when the app is launched from Explorer.

The catch is that a GUI-subsystem process has no console at all, so `--help`,
`--version` and argument errors would go nowhere. The usual fix is calling
`AttachConsole(ATTACH_PARENT_PROCESS)` before printing. That is a small amount of
Win32 for someone with a Windows machine to write and actually test; it was left
out rather than shipped unverified.

## Smaller ideas

- Export the rendered document to HTML or PDF.
- A `.desktop` entry so `mark` shows up under "Open with" for `.md` files.
- Remember window size and the sidebar state between runs.
- Jump to the fragment when following a link like `other.md#section`; today the
  file opens at the top.
- A presentation mode that splits the document on `---`.
- Multiple documents in tabs.
