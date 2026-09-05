# Code

Back to the [examples](README.md).

Blocks are highlighted with the language set `bat` ships, so the ones a README
actually contains are covered rather than only the classics. Each block is
labelled with its language in the left corner, and the right one holds a button
that copies the block — it keeps out of the way until the pointer is on the
block, and says so once it has copied.
Both palettes are built in: press <kbd>d</kbd> and the colours follow the page.

An unlabelled block is left as plain text, and `inline code` is never
highlighted at all.

## Rust

```rust
/// Answer one request. `doc_dir` is the directory of the document on screen.
pub fn serve(request: &Request<Vec<u8>>, doc_dir: &Path) -> Response<Cow<'static, [u8]>> {
    let path = request.uri().path();

    match path.strip_prefix(ASSET_PREFIX) {
        Some(name) => embedded(name),
        None => serve_file(&resolve(doc_dir, path.trim_start_matches('/'))),
    }
}
```

## TypeScript and JSX

```tsx
type Props = { file: string; onOpen: (path: string) => void };

export function Document({ file, onOpen }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void import("./render").then(() => setReady(true));
  }, [file]);

  return ready ? <article onClick={() => onOpen(file)} /> : <Spinner />;
}
```

## Python

```python
from pathlib import Path


def headings(document: Path) -> list[str]:
    """Every ATX heading in a Markdown file, in order."""
    return [
        line.lstrip("# ").strip()
        for line in document.read_text().splitlines()
        if line.startswith("#")
    ]
```

## Go

```go
func watch(path string, changed chan<- struct{}) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("watching %s: %w", path, err)
	}
	defer watcher.Close()

	for event := range watcher.Events {
		if event.Op&fsnotify.Write == fsnotify.Write {
			changed <- struct{}{}
		}
	}
	return nil
}
```

## Shell

```sh
#!/usr/bin/env bash
set -euo pipefail

PREFIX="${PREFIX:-$HOME/.local}"

cargo build --release
install -Dm755 target/release/mark "$PREFIX/bin/mark"
update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true
```

## SQL

```sql
select d.name, count(*) as diagrams
from documents d
  join fences f on f.document_id = d.id
where f.language = 'mermaid'
group by d.name
having count(*) > 1
order by diagrams desc;
```

## TOML

```toml
[profile.release]
lto = true
codegen-units = 1
strip = true
panic = "abort"
opt-level = "z"
```

## Dockerfile

```dockerfile
FROM rust:1.85-slim AS build
RUN apt-get update && apt-get install -y libwebkit2gtk-4.1-dev libsoup-3.0-dev
WORKDIR /src
COPY . .
RUN cargo build --release
```

## Diff

```diff
-const SERVABLE: &[&str] = &["png", "jpg", "svg"];
+const SERVABLE: &[&str] = &["png", "jpg", "svg", "webp"];
```

## No language

```
Plain text, and nothing pretending otherwise. Useful for output, trees and
anything a highlighter would only get wrong:

  examples/
  |-- README.md
  '-- code.md
```
