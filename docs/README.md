# The landing page

`index.html`, `style.css` and `app.js`, served by GitHub Pages from `main` →
`/docs`. Nothing here reaches the binary, and nothing here is built: the three
files are the site, and the browser is the only thing that reads them.

To publish it: **Settings → Pages → Deploy from a branch → `main` → `/docs`**.
That is the only step, and it is the repository owner's to take.

Notes for whoever changes it next:

- The palettes are the app's own, copied token for token from
  `src/assets/style.css` -- light, dark, Catppuccin Mocha, Gruvbox Dark and Blacksite, with
  the dark one written out twice for the same reason it is there. Each carries a
  `--syn-*` set as well, which the app has no use for: there is no syntect here,
  so the code in the mock is highlighted by hand, once per palette. A colour
  changed in the app should be carried across by eye.
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
  change here does not rebuild the `.exe`. Nor does it reach a release: those are
  cut from version tags, and the page's download links follow the newest one.
- Four tests guard what this page repeats from elsewhere: the shortcut table,
  the file types the installers claim and the version in the hero tag, all three
  in `src/main.rs`, and the list of
  palettes in the corner, which `the_landing_page_offers_the_same_themes` in
  `src/render.rs` reads straight out of `index.html` and compares against the
  window's own menu. The five names in the pre-paint script in the `<head>` are a
  fourth copy, and the only one nothing checks -- it runs before `app.js`
  arrives, so it cannot read the list from there.
