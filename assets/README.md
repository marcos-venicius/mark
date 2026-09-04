# The icon

`mark.svg` is the only file here written by hand; `mark.ico` and `mark.png` are
generated from it and committed anyway. The Windows runner that builds the
installer has no image tooling at all, and giving it some would mean a package
install on every run to produce a file that changes about never.

| File | Used by |
| --- | --- |
| `mark.svg` | the source, 256×256 |
| `mark.ico` | `build.rs`, compiled into `mark.exe` as a resource, and `SetupIconFile` in `windows/mark.iss` |
| `mark.png` | the desktop entry Linux still wants (`FUTURE.md`), and anywhere a single raster is easier |

A white M on the accent blue of the light palette (`--accent` in
`src/assets/style.css`). Flat: no gradient and no shadow, because neither
survives 16 px, and the filled square is what keeps the icon visible against a
light taskbar and a dark one alike.

Regenerating, after editing the SVG:

```sh
convert -background none assets/mark.svg -resize 256x256 -depth 8 assets/mark.png
for n in 256 128 64 48 32 24 16; do
  convert -background none assets/mark.svg -resize ${n}x${n} png32:/tmp/mark-$n.png
done
convert /tmp/mark-256.png /tmp/mark-128.png /tmp/mark-64.png /tmp/mark-48.png \
        /tmp/mark-32.png /tmp/mark-24.png /tmp/mark-16.png assets/mark.ico
```

Each size is rendered from the SVG rather than downsampled from the largest —
the 16 and 24 px entries are visibly cleaner that way, and those are the two
sizes Explorer and the taskbar actually reach for. `the_icon_carries_every_size_windows_asks_for`
in `src/main.rs` checks that all seven survived.

ImageMagick here renders the SVG with its own MSVG parser, not `rsvg`, so the
drawing stays inside what that parser handles: one `<rect>` and one `<path>`,
flat fills, no CSS.
