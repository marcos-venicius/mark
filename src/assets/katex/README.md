# Bundled KaTeX

Compiled into the `mark` binary and served over `mark://` as
`/__mark__/katex.min.js`, `/__mark__/katex.min.css` and
`/__mark__/fonts/KaTeX_*.woff2`, so a document with a `$...$` in it draws its
formulas on a machine with no network and no Node.

| What | Value |
| --- | --- |
| Version | 0.18.5, pinned |
| Upstream | <https://github.com/KaTeX/KaTeX> |
| Licence | MIT — `MIT-LICENCE.txt` |

The script is stored compressed, the way mermaid is: 272 KB as it comes and
76 KB in gzip, inflated by `protocol.rs` the first time a document actually
turns out to have maths in it. The stylesheet and the fonts are stored as they
are -- a `woff2` is already compressed, and gzip over one buys nothing.

Only the `woff2` fonts are here. Every `@font-face` in `katex.min.css` lists
`woff2`, then `woff`, then `ttf`, and a browser stops at the first format it
understands, so the other forty files -- 816 KB of them -- would never be asked
for.

To move to another version, fetch the same four things again:

```sh
curl -sL https://cdn.jsdelivr.net/npm/katex@<version>/dist/katex.min.js \
  | gzip -9 > katex.min.js.gz
curl -sL https://cdn.jsdelivr.net/npm/katex@<version>/dist/katex.min.css -o katex.min.css
curl -sL https://cdn.jsdelivr.net/npm/katex@<version>/LICENSE -o MIT-LICENCE.txt
grep -o 'url(fonts/[^)]*\.woff2)' katex.min.css | sed 's|url(fonts/||;s|)||' | sort -u |
  while read -r f; do
    curl -sL "https://cdn.jsdelivr.net/npm/katex@<version>/dist/fonts/$f" -o "fonts/$f"
  done
```

It has to be `dist/katex.min.js`, the self-contained UMD bundle that defines
`window.katex`. Three things about that file are what let it run under the page's
Content Security Policy unchanged, and all three are worth checking before
bumping the version: it contains no `eval` or `new Function`, so no
`'unsafe-eval'` is needed; it fetches nothing, so `connect-src 'none'` stands
(the `fetch(` in the minified source is the parser's own token method, not the
network one); and the font list above has to be re-fetched rather than assumed,
because a version that adds a face would otherwise ship a stylesheet asking for
a file that is not there. `every_katex_font_the_stylesheet_asks_for_is_embedded`
in `protocol.rs` is what catches that last one.
