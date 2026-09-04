# Images

Back to the [examples](README.md).

Local paths are resolved against the document, not against the window, so a
path that climbs out of this directory works the way it does in an editor. The
icon below lives in `assets/`, one level up:

![The mark icon](../assets/mark.png)

An SVG is served the same way, and scales rather than blurring:

![The same icon, as vector](../assets/mark.svg)

Markdown has no syntax for the size of an image, so this one is written as raw
HTML, which a document is allowed to bring with it:

<img src="../assets/mark.png" width="64" alt="The icon again, smaller">

A path that does not exist is not an error the window recovers from silently —
it is a broken image, exactly as it would be in a browser:

![There is no file here](does-not-exist.png)

Images from the web are fetched when a document references them, as a browser
would. Nothing else in a document reaches the network: no scripts, no styles,
no requests of any other kind. If that matters for a file, it is worth knowing
before opening it.
