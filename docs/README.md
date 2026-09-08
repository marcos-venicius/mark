# The landing page

`index.html`, `style.css` and `app.js`, served by GitHub Pages from `main` →
`/docs`. Nothing here reaches the binary, and nothing here is built: the three
files are the site, and the browser is the only thing that reads them.

To publish it: **Settings → Pages → Deploy from a branch → `main` → `/docs`**.
That is the only step, and it is the repository owner's to take.

Notes for whoever changes it next:

- The palette is the app's own, copied token for token from
  `src/assets/style.css`, dark palette written out twice for the same reason it
  is there. A colour changed in the app should be carried across by eye.
- The two `woff2` faces are the `latin` subsets from `src/assets/fonts/`. The
  `latin-ext` ones are not here: `@font-face` carries a `unicode-range`, so a
  glyph outside it falls back to the stack rather than going missing.
- The window on the page is a mock, not a screenshot -- a `<div>` reconstruction
  using the bar out of `src/assets/shell.html`, so it follows the reader's theme
  and stays sharp. It is also the thing most likely to drift: a button added to
  the real bar should appear in it.
- `.nojekyll` stops Pages running the files through Jekyll, which would
  otherwise be free to decide what an underscore means.
- Nothing is fetched from anywhere else. No CDN, no analytics, no web font
  service -- the same rule the window keeps with its Content Security Policy.
- `docs/**` is in the `paths-ignore` of `.github/workflows/windows.yml`, so a
  change here does not rebuild the `.exe` or move the `latest` tag.
- Two tests in `src/main.rs` guard what this page repeats from elsewhere: the
  shortcut table and the file types the installers claim.
