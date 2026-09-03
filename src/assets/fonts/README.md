# Bundled fonts

Compiled into the `mark` binary and served over `mark://` so a document renders
the same on a machine that has neither installed. Latin and Latin Extended
subsets only, variable weight.

| Font | Used for | Upstream | Licence |
| --- | --- | --- | --- |
| Inter | Body text and headings | <https://github.com/rsms/inter> | SIL Open Font Licence 1.1 — `Inter-OFL.txt` |
| JetBrains Mono | Code | <https://github.com/JetBrains/JetBrainsMono> | SIL Open Font Licence 1.1 — `JetBrainsMono-OFL.txt` |

The files came from the Google Fonts CDN. `src/assets/style.css` declares the
`@font-face` rules; the URLs there are relative, so they resolve against the
stylesheet's own `mark://` address on every platform.
