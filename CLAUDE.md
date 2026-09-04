# Working on mark

Notes to you, in a future session. `README.md` says what `mark` renders and, under
"How it works", why the awkward parts are the way they are. `FUTURE.md` says what was
deliberately left out and what each item would cost. This file does not repeat either;
it tells you where to look and how to work here.

`mark <file>` opens a window and renders that file. One Rust binary, no bundled browser,
no frontend build step, about 3.4 MB with the stylesheet, the page script and two fonts
compiled in. Nothing is written to disk at runtime.

## Ground rules

**Git belongs to the person you are working for.** Never run a git command that writes:
no `commit`, `push`, `merge`, `rebase`, `reset`, `tag`, `stash`, `branch -d`, no
`gh release` or `gh pr create` — unless they have asked for that specific action, in that
moment. Reading is free: `status`, `log`, `diff`, `show`. Permission for one action does
not carry to the next one.

Run `cargo test` and `cargo clippy` before calling anything finished. CI runs neither
(see "Build, test, run"), so local is the only place either happens.

Verify GUI changes in the real session — Wayland under COSMIC. `GDK_BACKEND=x11` hides
exactly the class of bug that `attach()` exists to avoid.

No new dependency without a stated reason. Every crate in the README carries a "Why"
column and the next one has to earn its line too.

## Architecture in one screen

```
mark <file>
  |
  |-- render.rs     Markdown -> HTML   (comrak + syntect)
  |-- protocol.rs   the mark:// scheme (embedded assets + local files)
  |-- watcher.rs    filesystem watch -> live reload
  '-- main.rs       window, webview, navigation history
```

A document reaches the screen like this: `parse_args` checks the arguments, `detach` hands
the terminal back, the window and webview come up, and `app.js` sends `{"type":"ready"}`.
Only then does `App::show` read the file, `Renderer::render` turn it into HTML, and Rust
inject it with `window.__mark.setContent(html, keepScroll)`. The page asks rather than
Rust pushing on a timer, which removes the race with the webview loading.

Shared state is one thing: `DocDir = Arc<Mutex<PathBuf>>` (`src/render.rs:15`), the
directory of the document on screen. The URL rewriter and the protocol handler both read
it; `App::navigated` (`src/main.rs:430`) swaps it when the reader follows a link.

The Rust/page boundary is one channel each way — `evaluate_script` down, and
`decode_message` (`src/main.rs:508`) over `{"type": ...}` JSON up. Page behaviour that
needs the filesystem becomes a variant of `enum UserEvent` (`src/main.rs:72`) and a case
in `decode_message`. Nothing else crosses while the window is open.

Before it opens there is one more path: `build_shell` (`src/main.rs:580`) fills the
placeholders in `shell.html` once — the asset URLs, the syntax palette, and the help
panel that `help_html` builds from `SHORTCUTS` (`src/main.rs:51`). Markup that never
changes belongs there rather than in a `setContent` call.

## Invariants

Each of these is load-bearing. The comment above it says the same thing at more length.

| Invariant | Where | If ignored |
| --- | --- | --- |
| Fork before any thread starts or anything touches GTK | `src/main.rs:211` | the child holds locks nothing will release |
| Relative URLs become absolute at render time, raw HTML included | `src/render.rs:66`, `:245` | the webview flattens `../` and the image is never found |
| Attach the webview through the GTK vbox, not a raw handle | `src/main.rs:485` | wry refuses a native Wayland session outright |
| Keep `Access` and `Modify(Metadata)` out of the watcher | `src/watcher.rs:57` | rendering opens the file, which is reported as a change, forever |
| Scope both palettes; `@media print` comes last | `src/render.rs:114` | one stray token in one language; a printout in pale colours |
| Fill in only the standard handles Windows left empty | `src/main.rs:308` | `mark --version > out.txt` prints to the console and leaves the file empty |

Two more are there because `render.unsafe = true` lets documents bring their own HTML: the
Content Security Policy in `src/assets/shell.html` (`default-src 'none'`,
`connect-src 'none'` — no scripts from the document, no outbound requests) and the
`SERVABLE` list in `src/protocol.rs:23`, which serves only file types a renderer has a
reason to load, so a document cannot point the window at `~/.ssh/id_rsa`. Widening either
is a security decision, not a convenience. `non_media_files_are_refused_however_they_are_addressed`
guards the second.

## Build, test, run

```sh
cargo build --release
cargo test          # 25 tests: 16 in render.rs, 7 in protocol.rs, 2 in main.rs
cargo clippy
cargo run -- README.md
./install.sh        # release build, then install into $PREFIX/bin (default ~/.local)
```

Things written down nowhere else:

- The README's `cargo run -- example.md` refers to a file that does not exist. Open
  `README.md` instead.
- `.github/workflows/windows.yml` is the only workflow. It builds the `.exe`, smoke-tests
  `--version` through `Start-Process` (a GUI-subsystem program is not waited for, and
  the redirected output is also the check that the inherited handle survived), reads
  the headers with `dumpbin` to catch a stray `VCRUNTIME` or `WebView2Loader` and to
  confirm the GUI subsystem, and rewrites the `latest` prerelease in place. It does not
  run `cargo test`, `clippy` or `fmt`, and there is no Linux CI at all.
- The Windows half of `main.rs` cannot be built here, but it can be type-checked:
  `rustup target add x86_64-pc-windows-msvc` and then `cargo check` on a scratch crate
  holding the same code. The full crate does not cross-check -- `onig_sys` compiles C.
- Tests live inline in `#[cfg(test)] mod tests`. There is no `tests/` directory, and
  `watcher.rs` has none. The two in `main.rs` guard the shortcut table: it is the one
  thing rendered twice, and the window's copy cannot be checked from a terminal.
- Building on Linux needs `libwebkit2gtk-4.1-dev` and `libsoup-3.0-dev`; Rust 1.85 or newer.

## Style

A comment here explains **why**, and usually what would go wrong if it were done the
obvious way — see `src/watcher.rs:22`, `src/render.rs:76`, `src/protocol.rs:19`. That is
the dominant convention in this repository. New code without that reasoning is unfinished.

Everything in the repository is English, in British spelling: colour, licence, behaviour.
Modules open with `//!`, public items carry `///`. Test names are readable sentences, such
as `print_overrides_the_dark_palette_and_comes_last`.

`app.js` is deliberately conservative: `var`, `function`, one IIFE, no `let`/`const`, no
arrow functions, classes or modules. There is no build step and there should not be one.

In `style.css` every colour is a custom property. The dark palette is written out twice on
purpose — a media query and a `[data-theme]` selector cannot be folded into one — and
`both_dark_palettes_declare_the_same_tokens` catches a change made to only one copy.

Errors: `anyhow` with `.context`/`bail!` along the CLI path; a deliberate `let _ =` only
where a comment says why there is nothing useful to do with the error; `.expect("a phrase")`
for invariants only.

Commit messages follow Conventional Commits (`feat:`, `feat(unix):`); the history is only
partly consistent and the intent is to standardise. Writing a message is not committing —
see Ground rules.

## Where to touch

| Task | Files |
| --- | --- |
| A new keyboard shortcut | `SHORTCUTS` in `src/main.rs` (the terminal text and the help panel both follow) -> `src/assets/app.js` keydown -> `UserEvent` and `decode_message` in `src/main.rs`, if it needs the filesystem -> the README table |
| A new servable file type | `SERVABLE` in `src/protocol.rs` — a security decision |
| A new comrak extension | `Renderer::new` in `src/render.rs`, styling in `src/assets/style.css`, plus a test |
| Colours or typography | `src/assets/style.css`, both copies of the dark palette |
| A different syntax theme | `LIGHT_THEME` / `DARK_THEME` in `src/render.rs` |
| A new embedded asset | the `ASSETS` table in `src/protocol.rs` (`include_bytes!`) |
| Anything in FUTURE.md | pick up the note that is already there; it says what is missing and what it costs |

## Out of scope, on purpose

Mermaid diagrams, LaTeX, a headless `--pdf`, a `.desktop` entry, tabs. None of these
were forgotten; each was measured and deferred, and `FUTURE.md` records the reasoning.
Proposing one means picking that note back up, not starting from scratch.
