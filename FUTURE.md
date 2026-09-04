# Future work

Things left out of the first version, with notes on what it would take to add
them. The first is queued -- it is what has been asked for next. The rest were
deliberately deferred.

## Opening a document by double-clicking it

Register `mark` with the desktop, so a `.md` file in a file manager opens here:
an "Open with" entry on Linux, and on Windows an application proper, with a file
association behind it. This is the note to pick up next.

The program itself is ready for it. It takes one file path, it detaches on Unix,
and it reports a bad path before the window would have opened, so a file manager
launching it behaves like any other application. What is missing is everything
around the binary.

**Linux.** A `mark.desktop` in `~/.local/share/applications` with `Exec=mark %f`,
`Terminal=false` and `MimeType=text/markdown;text/x-markdown;`, installed by
`install.sh` together with a run of `update-desktop-database` -- and removed
again by whatever undoes an install, which today is nothing at all: `install.sh`
has no counterpart. Two catches. `mark` opens more extensions than the shared MIME
database maps to `text/markdown` (`MARKDOWN_EXTENSIONS` in `src/main.rs` lists
`.mkd`, `.mdown`, `.mdx` and the rest), so those want a MIME package of their own
under `~/.local/share/mime`. And a desktop entry wants an icon, which this
project does not have in any form.

**Windows.** Three separate pieces, none of them the binary:

- An icon, compiled into the `.exe` as a resource. That means an `.ico` and a
  build dependency to embed it -- `embed-resource` or `winresource` -- since
  `cargo` will not do it on its own.
- Registry entries: a ProgId under `HKCU\Software\Classes\mark.Document` whose
  `shell\open\command` is `"...\mark.exe" "%1"`, and then the ProgId named back
  under each extension -- `HKCU\Software\Classes\.md\OpenWithProgids`, one empty
  value per extension `mark` opens. Under `HKCU` rather than `HKLM`, so none of
  it needs an administrator.
- Something to write them. Either an installer built in the release workflow
  (Inno Setup is the small option, and would also give the binary a fixed home
  under `%LOCALAPPDATA%\Programs`), or `mark --register` / `--unregister` in the
  binary itself. The second is far less machinery, at the price of a program that
  writes nothing at runtime on purpose writing to the registry when asked.

Worth knowing before any of it is started: Windows 10 and 11 do not let an
application make itself the default for an extension. The UserChoice key is
hash-protected, and writing it is what malware does. Registering puts `mark` in
the "Open with" list; the reader still has to pick it once, with "Always use this
app". A plan that promises a working double-click straight after installation is
promising something the operating system will not do.

Cost: nothing new at runtime on Linux, and an icon plus a build dependency on
Windows, with either an installer as a second artefact in the `latest`
prerelease or a pair of flags and the registry calls behind them -- `windows-sys`
is already a dependency there and would need `Win32_System_Registry`.

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
