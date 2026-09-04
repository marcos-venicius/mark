# Links

Back to the [examples](README.md).

Every link is handled outside the page, so where one goes depends on what it
points at.

## Opens in this window

A relative link to another Markdown file replaces the document, keeps a history
you can walk with <kbd>Alt</kbd> <kbd>←</kbd> and <kbd>Alt</kbd> <kbd>→</kbd>,
and retitles the window:

- [Text](text.md)
- [Code](code.md)
- [Diagrams](diagrams.md)
- [Images](images.md)
- [The repository's own README](../README.md), which is a real document rather
  than an example

The extensions that open here are `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`,
`.mdx` and `.txt`.

## Opens somewhere else

- [The mermaid documentation](https://mermaid.js.org) goes to your browser.
- [The licence](../src/assets/mermaid/MIT-LICENCE.txt) is a `.txt`, so it opens
  in this window like any other document.
- [The Windows installer script](../windows/mark.iss) is not a document mark
  renders, so the desktop is asked to open it in whatever owns `.iss`.
- <a href="mailto:someone@example.com">An email address</a> goes to your mail
  client.

## Inside the page

- [The heading above](#opens-in-this-window) scrolls there.
- Every heading has an anchor of its own, which is also what the contents
  sidebar is built from.

A fragment on a link to *another* file is not followed yet: the file opens at
the top. That one is written down in `FUTURE.md`.

## A fence that will not parse

```mermaid
flowchart LR
  A --> ((((
```

Above it is mermaid's reason for refusing, and the source is left where it was
so nothing written is lost.
