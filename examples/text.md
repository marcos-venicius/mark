---
title: Everything Markdown, and a little HTML
hidden: this block is front matter, and mark does not render it
---

# Text

Back to the [examples](README.md).

This file has a YAML block at the top. It is metadata rather than prose, so it
is recognised and hidden instead of being rendered as a stray heading followed
by a wall of key/value lines. Open the file in an editor to see it.

## Emphasis and spans

*Italic*, **bold**, ***both***, ~~struck through~~, `inline code`, and a
superscript in E = mc^2^. There is no syntax for a subscript, which is one of
the things raw HTML is for: H<sub>2</sub>O.

A bare URL is turned into a link on its own: https://commonmark.org. So is an
address like support@example.com.

## Lists

- A bullet
- Another one
  - Nested a level
  - And a sibling
- Back out again

1. Numbered
2. Second
   1. And nested
3. Third

- [x] A task that is done
- [ ] One that is not
- [x] Task lists come from GitHub Flavored Markdown

Term
: The description list is the other GFM extension people forget exists.

Fence
: A fenced block of code, opened and closed with three backticks.

## Quotes

> A quotation, which can carry anything a document can.
>
> > Including another quotation.

## Alerts

> [!NOTE]
> Something worth knowing, in passing.

> [!TIP]
> A shortcut a reader would not have guessed.

> [!IMPORTANT]
> Something the reader has to do for the rest to work.

> [!WARNING]
> Something that will go wrong if it is ignored.

> [!CAUTION]
> Something that cannot be undone.

## Tables

| Column | Aligned right | Centred |
| --- | ---: | :---: |
| Cells can hold `code` | 1 | yes |
| ...and **emphasis** | 22 | no |
| ...and [links](code.md) | 333 | yes |

A table wider than the reading column scrolls on its own rather than stretching
the text around it:

| Crate | Version | Why it is here | Where it is used |
| --- | --- | --- | --- |
| comrak | 0.54 | CommonMark and GFM parsing, and the HTML output | `src/render.rs` |
| syntect | 5.3 | Syntax highlighting, and the stylesheet that colours it | `src/render.rs` |
| notify | 8 | Filesystem watching, which is what live reload is made of | `src/watcher.rs` |

## Raw HTML

Markdown has no syntax for some things, so a document may bring its own HTML.
It is rendered, under a policy that allows no scripts and no requests out.

<details>
<summary>A disclosure, closed until it is clicked</summary>

Anything can go in here, including more Markdown once a blank line separates it
from the tag.

</details>

Press <kbd>Ctrl</kbd> <kbd>F</kbd> to search this page. Footnotes[^1] collect at
the foot of the document, and the number links both ways.

## A rule, and then the end

---

[^1]: Like this one. The arrow at the end goes back to where you were reading.
