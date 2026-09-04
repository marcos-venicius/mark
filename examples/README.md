# Examples

Five documents, each one exercising a part of `mark`. Open the first and follow
the links; <kbd>Alt</kbd> <kbd>←</kbd> comes back.

```sh
cargo run -- examples/README.md
```

- [Text](text.md) — headings, lists, tables, alerts, footnotes and the raw HTML
  a document is allowed to bring with it.
- [Code](code.md) — syntax highlighting, one block per language.
- [Diagrams](diagrams.md) — ```` ```mermaid ```` fences, in both palettes.
- [Images](images.md) — local files, including ones a directory up.
- [Links](links.md) — where each kind of link goes, and what does not open here.

## While you are in the window

| Key | What it does here |
| --- | --- |
| <kbd>t</kbd> | Hides the contents sidebar. It appears from three headings up, so this page has none |
| <kbd>d</kbd> | Light and dark, diagrams included |
| <kbd>Ctrl</kbd> <kbd>P</kbd> | The printed version is always the light one |
| <kbd>?</kbd> | Everything else |

Editing any of these files while it is open reloads the window without losing
your place in it.
