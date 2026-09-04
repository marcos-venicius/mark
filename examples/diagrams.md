# Diagrams

Back to the [examples](README.md).

A fence marked `mermaid` is drawn where it stands, by a renderer compiled into
the binary — nothing is fetched, and there is nothing to install.

Each diagram is drawn twice, once per palette, and the stylesheet shows one of
them: press <kbd>d</kbd> and they change with the page, with no redraw. Printing
always gets the light one, whichever way the window is set.

## Flowchart

```mermaid
flowchart LR
  A["mark file.md"] --> B{"Markdown?"}
  B -- yes --> C["render.rs"]
  B -- no --> D["the desktop"]
  C --> E["the window"]
  E --> F{"saved?"}
  F -- yes --> C
```

## Sequence

```mermaid
sequenceDiagram
  participant W as watcher.rs
  participant R as main.rs
  participant P as app.js
  P->>R: {"type":"ready"}
  R->>P: setContent(html, false)
  W-->>R: the file changed
  R->>P: setContent(html, true)
  Note over P: the scroll position is kept
```

## State

```mermaid
stateDiagram-v2
  [*] --> Reading
  Reading --> Finding: / or Ctrl F
  Finding --> Reading: Esc
  Reading --> Help: ? or F1
  Help --> Reading: Esc
  Reading --> [*]: Ctrl Q
```

## Class

```mermaid
classDiagram
  class App {
    +history: Vec~PathBuf~
    +cursor: usize
    +show(placement)
    +open(href)
  }
  class Renderer {
    +render(markdown) String
  }
  class FileWatcher
  App --> Renderer
  App --> FileWatcher
```

## Entities

```mermaid
erDiagram
  DOCUMENT ||--o{ FENCE : contains
  DOCUMENT ||--o{ HEADING : contains
  FENCE {
    string language
    string source
  }
  HEADING {
    int level
    string id
  }
```

## Pie

```mermaid
pie showData
  title What the 4.3 MB binary is made of
  "mermaid" : 3500
  "the program" : 600
  "fonts" : 190
```

## Gantt

```mermaid
gantt
  title One afternoon
  dateFormat YYYY-MM-DD
  section Renderer
  Embed the bundle    :done, a1, 2026-09-01, 2d
  Both palettes       :done, a2, after a1, 2d
  section Documents
  Examples            :active, a3, after a2, 1d
```

## When a diagram will not parse

The source stays where it was, with mermaid's own reason for refusing it above
the block, and the rest of the document renders as usual. There is one in
[links.md](links.md), at the foot.
