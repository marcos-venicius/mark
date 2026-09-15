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

LaTeX formulas were the third note and have shipped as well. KaTeX went the way
mermaid did -- packed into the binary and fetched by the page only once a
document turns out to have a formula -- and cost less than this file feared: 76 KB
of script in gzip, its stylesheet, and the twenty `woff2` faces it draws with,
about 360 KB in all rather than 2 MB, because the `woff` and `ttf` copies of every
face are never asked for. It needs no second drawing per palette, as guessed. The
one thing that did not turn up in the guess is that Markdown reads a line before
KaTeX does: a line holding nothing but `=` or `-` underlines the line above it,
so an equation with one in it belongs in a ```math fence.

Following a link like `other.md#section` to its heading was one of the smaller
ideas, and has shipped. The fragment was never lost in the page: `http::Uri`,
which reads the link on the Rust side, has nowhere to keep one and dropped it.
It is read off the text beside the path now and handed down with the document,
and the page jumps once the diagrams and formulas above the heading have been
drawn. Back and forward still remember a file and nothing more, and land at
its top.

Remembering the window between runs was another, and has shipped as well: its
size and whether it was maximised, the sidebar and the wide measure, beside the
theme that was already kept. All of it is in the page's `localStorage`, which
the webview keeps by itself, so `mark` still writes no file of its own. The size
is the awkward one, because the window exists before the page does and only the
page can read the store. So the window is built hidden and shown when the
page's `ready` brings the size back, with a timer underneath in case it never
does. It is written on every resize rather than on the way out, since a script
sent to a page while the process exits may never run. Zoom is not kept.

## Smaller ideas

- Export the rendered document to HTML. PDF is covered by Ctrl P, which
  hands the page to the print dialog; what is missing is a headless
  `mark --pdf out.pdf` for scripts, which needs the platform print APIs
  directly rather than a dialog.
- A presentation mode that splits the document on `---`.
- Multiple documents in tabs.
