# Bundled mermaid

Compiled into the `mark` binary and served over `mark://` as
`/__mark__/mermaid.min.js`, so a document with a ```` ```mermaid ```` fence draws
its diagram on a machine with no network and no Node.

| What | Value |
| --- | --- |
| Version | 11.17.2, pinned |
| Upstream | <https://github.com/mermaid-js/mermaid> |
| Licence | MIT — `MIT-LICENCE.txt` |

Stored compressed. The bundle is 3.5 MB as it comes and 976 KB in gzip, and
embedding it raw would more than double the executable; `protocol.rs` inflates it
once, the first time a document actually asks for it.

To move to another version, fetch the UMD build and compress it again:

```sh
curl -sL https://cdn.jsdelivr.net/npm/mermaid@<version>/dist/mermaid.min.js \
  | gzip -9 > mermaid.min.js.gz
curl -sL https://cdn.jsdelivr.net/npm/mermaid@<version>/LICENSE -o MIT-LICENCE.txt
```

It has to be `dist/mermaid.min.js`, which is the self-contained UMD bundle. The
`.mjs` builds pull their diagram types in with dynamic `import()`, which would
mean embedding and serving every chunk as well. Two properties of that file are
what let it run under the page's Content Security Policy unchanged: it contains
no `eval` or `new Function`, so no `'unsafe-eval'` is needed, and it fetches
nothing, so `connect-src 'none'` stands. Check both before bumping the version.
