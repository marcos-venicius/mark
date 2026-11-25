// The page half of mark: fills in the document Rust sends, keeps the sidebar in
// sync, and forwards anything that needs the filesystem back over IPC.
(function () {
  "use strict";

  var page = document.getElementById("page");
  var content = document.getElementById("content");
  var source = document.getElementById("source");
  var toc = document.getElementById("toc");
  var tocList = document.getElementById("toc-list");
  var find = document.getElementById("find");
  var findInput = document.getElementById("find-input");
  var help = document.getElementById("help");
  var helpCard = document.getElementById("help-card");
  var helpClose = document.getElementById("help-close");
  var themeButton = document.getElementById("bar-theme");
  var themeMenu = document.getElementById("theme-menu");
  var themeItems = themeMenu.getElementsByTagName("button");
  var barName = document.getElementById("bar-name");
  var barBack = document.getElementById("bar-back");
  var barForward = document.getElementById("bar-forward");
  var barToc = document.getElementById("bar-toc");
  // What the button says when it has something to show, as shell.html wrote it,
  // so the key in it is written down in one place.
  var TOC_TITLE = barToc.title;
  var barFind = document.getElementById("bar-find");
  var barWide = document.getElementById("bar-wide");
  var barReload = document.getElementById("bar-reload");
  var barFolder = document.getElementById("bar-folder");
  var barPath = document.getElementById("bar-path");
  var barPrint = document.getElementById("bar-print");
  var barSource = document.getElementById("bar-source");
  var barCopy = document.getElementById("bar-copy");
  var empty = document.getElementById("empty");
  var emptyReopen = document.getElementById("empty-reopen");
  var viewer = document.getElementById("viewer");
  var viewerStage = document.getElementById("viewer-stage");
  var viewerCanvas = document.getElementById("viewer-canvas");
  var viewerFit = document.getElementById("viewer-fit");
  var viewerCopy = document.getElementById("viewer-copy");

  var BASE_FONT_SIZE = 16.5;
  var ZOOM_STEPS = [0.75, 0.85, 0.92, 1, 1.1, 1.25, 1.4, 1.6, 1.85];
  var zoom = 3;

  // The reader's answer about the sidebar, and null until they give one. With
  // no answer the sidebar follows the document: one or two headings is not
  // something you need a map for, so it stays away. Pressing the key is an
  // answer, and it outranks that either way -- in this window and in every one
  // after it, since the answer is kept. applyStoredLayout reads it back.
  var tocChoice = null;
  var spy = null;

  // Every ```mermaid fence is drawn twice. The colours mermaid uses end up inside
  // the SVG it produces, so a theme cannot be a stylesheet matter the way it is
  // for the syntax colours unless both drawings are on the page and the
  // stylesheet picks one -- which is also what keeps a printout from being a
  // dark diagram on white paper.
  //
  // Twice, not once per palette: Catppuccin, Gruvbox, Blacksite and Sereno
  // Dark are dark pages, and the dark drawing reads correctly on all four, as
  // the light one does on Sereno Light. A drawing of their own would be a
  // third and a fourth render of every fence on the page, for a difference
  // nobody would name without the two side by side.
  var DIAGRAM_PALETTES = [
    { theme: "default", className: "diagram-light" },
    { theme: "dark", className: "diagram-dark" },
  ];
  var mermaidLoading = null;
  var diagrams = 0;
  var katexLoading = null;

  // Which document is on screen. A save part way through drawing a diagram or
  // typesetting a formula replaces the page under it, and the work that
  // finishes afterwards must not write into a DOM that has already been thrown
  // away.
  var generation = 0;

  // The file as Rust read it for the page on screen, and null when there is no
  // file or it could not be read: there is no source to show behind an error.
  // sourceShown is the reader's Ctrl U, which outlives the document it was
  // pressed on, so that walking a set of linked files keeps showing them the
  // same way. It is not kept between runs, unlike the measure: a document that
  // opens on its own source looks like one that failed to render.
  var sourceText = null;
  var sourceLines = [];
  var sourceShown = false;
  // The rows are built when they are first wanted rather than with every
  // document: most documents are never looked at this way.
  var sourceBuilt = -1;

  // What the page keeps between runs, all of it in localStorage: the webview
  // keeps that store on disk by itself, and mark writes no file of its own.
  // Every key is read back somewhere as well as written, and
  // every_remembered_setting_is_read_back holds the two ends together.
  var THEME_KEY = "mark.theme";
  var TOC_KEY = "mark.toc";
  var WIDE_KEY = "mark.wide";
  var WINDOW_KEY = "mark.window";

  // The size Rust last asked the page to keep, waiting for the resizing to
  // settle. See rememberWindow.
  var windowPending = null;
  var windowTimer = null;

  // Every palette a reader can pick, in the order D walks them. "system" is the
  // absence of the attribute rather than a value of it, which is what lets the
  // media queries in style.css go on following the desktop while the window is
  // open, for nothing. Every other name is a :root[data-theme=...] block there
  // and a scope render.rs gives syntax colours to; the order is this one because
  // the menu is written out in it too.
  var THEMES = ["system", "light", "dark", "catppuccin-mocha", "gruvbox-dark", "blacksite", "sereno-light", "sereno-dark"];

  function send(message) {
    window.ipc.postMessage(JSON.stringify(message));
  }

  // Storage can be missing or refuse -- a profile that is read-only, a quota
  // that is full -- and nothing kept in it is worth failing over. A read that
  // fails is nothing remembered; a write that fails is a choice that lasts
  // until the window closes.
  function stored(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  // null takes the key away rather than storing the word, so that "nothing
  // chosen" reads back as nothing.
  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      // Not being able to remember a choice is no reason to refuse it.
    }
  }

  // ------------------------------------------------------------------ theme

  // What the reader chose, which is not the same as what is on screen: with
  // "system" the answer is still "system", and the desktop decides the rest.
  // The menu ticks the choice, because that is the thing pressing an entry sets.
  function currentTheme() {
    return document.documentElement.dataset.theme || "system";
  }

  function setTheme(name) {
    if (name === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = name;
    store(THEME_KEY, name === "system" ? null : name);
    markTheme();
  }

  // The tick itself is drawn by the stylesheet off aria-checked, so this is the
  // only place the menu and the attribute have to be kept in step.
  function markTheme() {
    var chosen = currentTheme();
    var index;
    for (index = 0; index < themeItems.length; index += 1) {
      themeItems[index].setAttribute("aria-checked", String(themeItems[index].value === chosen));
    }
  }

  // D walks the whole list rather than flipping between two of it, so no palette
  // is reachable only with a pointer.
  function cycleTheme() {
    var at = THEMES.indexOf(currentTheme());
    setTheme(THEMES[(at + 1) % THEMES.length]);
  }

  // With nothing stored the stylesheet follows the system on its own, through a
  // media query, and keeps following it if the system changes while the window
  // is open. A stored choice stamps the root element, which outranks that.
  //
  // The list is the validation. Anything else in storage -- a name from a
  // version that offered a palette this one does not, or a key someone else
  // wrote -- leaves the system in charge rather than stamping the root with a
  // value no stylesheet answers to. Index 0 is "system", which is stored as
  // nothing at all, so a stored "system" is discarded by the same test.
  function applyStoredTheme() {
    var name = stored(THEME_KEY);
    if (THEMES.indexOf(name) > 0) document.documentElement.dataset.theme = name;
    markTheme();
  }

  function openThemeMenu() {
    themeMenu.hidden = false;
    themeButton.setAttribute("aria-expanded", "true");
    // The entry in use, so the arrows start from where the reader already is.
    themeItems[Math.max(0, THEMES.indexOf(currentTheme()))].focus();
  }

  function closeThemeMenu() {
    if (themeMenu.hidden) return;
    themeMenu.hidden = true;
    themeButton.setAttribute("aria-expanded", "false");
    page.focus();
  }

  function toggleThemeMenu() {
    if (themeMenu.hidden) openThemeMenu();
    else closeThemeMenu();
  }

  // Delegated, so shell.html stays the only place the palettes are written down.
  // The entries have no children, so the target is the button or it is the
  // padding around one.
  themeMenu.addEventListener("click", function (event) {
    if (event.target.tagName !== "BUTTON") return;
    setTheme(event.target.value);
    closeThemeMenu();
  });

  // Enter and space press a button on their own; only the arrows need saying.
  themeMenu.addEventListener("keydown", function (event) {
    var step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;

    event.preventDefault();
    var at = Array.prototype.indexOf.call(themeItems, document.activeElement);
    var next = (at + step + themeItems.length) % themeItems.length;
    themeItems[next].focus();
  });

  // Anywhere else on the page closes it. The button's own click is excluded or
  // this would undo the press that opened the menu, which bubbles here after it.
  document.addEventListener("click", function (event) {
    if (themeMenu.hidden) return;
    if (themeMenu.contains(event.target) || themeButton.contains(event.target)) return;
    closeThemeMenu();
  });

  // ------------------------------------------------------------- rendering

  // Called from Rust every time the document is loaded or re-read from disk. The
  // state is what the bar shows and the page cannot work out for itself: which
  // file this is and whether the history has anywhere to go. It travels with the
  // document rather than in a message of its own, so there is no order between
  // the two to get right. The fragment is the heading a link named along with
  // the file -- `section` in other.md#section -- or null.
  window.__mark = {
    setContent: function (html, keepScroll, state, fragment, text) {
      // A diagram open in the viewer belongs to the document about to be
      // replaced. It goes back first, while there is still a place for it.
      closeViewer();
      var offset = keepScroll ? page.scrollTop : 0;
      var mine = (generation += 1);
      setSource(text);
      applyState(state);
      content.innerHTML = html;
      labelCodeBlocks();
      addCopyButtons();
      wrapTables();
      buildToc();
      // Diagrams and formulas both change the height of everything below them,
      // so the scroll is restored after they have settled rather than before. A
      // document with neither in it resolves immediately and lands in the same
      // frame it always did.
      Promise.all([drawDiagrams(mine), typesetMath(mine)]).then(function () {
        if (mine !== generation) return;
        // Images and fonts settle a frame later; restoring after that keeps a
        // save from nudging the reader off the paragraph they were on. The
        // fragment waits for the same frame for the same reason: every diagram
        // and formula above the heading has moved it by then. One that names
        // no heading leaves the document at the top, where it would have been.
        requestAnimationFrame(function () {
          if (fragment && jumpTo(fragment, "auto")) return;
          page.scrollTop = offset;
        });
      });
    },

    // Called from Rust on every resize, with the window measured the way it
    // will be restored: Rust can measure the window and cannot keep anything,
    // and the page can keep things and cannot tell a maximised window from a
    // large one.
    //
    // Written once the resizing has settled rather than on every call: a drag
    // sends dozens, and maximising sends two -- the first with the new size and
    // the old state, because GTK reports the size before it reports why. Only
    // the last one is the truth.
    // Rust's answer to a copy-picture message: whether the picture is on the
    // clipboard now. The button that was pressed is the one that says so.
    pictureCopied: function (copied) {
      if (pictureButton) say(pictureButton, copied ? "Copied" : "Failed");
      pictureButton = null;
    },

    rememberWindow: function (geometry) {
      windowPending = geometry;
      clearTimeout(windowTimer);
      windowTimer = setTimeout(keepWindow, 300);
    },

    // Drawn from Rust rather than from the page: wry takes the webview's own
    // drag events over wherever the drop handler is installed, so the page is
    // never told a file is above it unless Rust says so.
    setDragging: function (over) {
      var root = document.documentElement;
      if (over) root.setAttribute("data-dragging", "");
      else root.removeAttribute("data-dragging");
    },
  };

  function labelCodeBlocks() {
    content.querySelectorAll("pre > code[class*='language-']").forEach(function (code) {
      var match = /language-([\w+#.-]+)/.exec(code.className);
      if (match) code.parentNode.setAttribute("data-lang", match[1]);
    });
  }

  // Wide tables scroll on their own rather than stretching the reading column.
  function wrapTables() {
    content.querySelectorAll("table").forEach(function (table) {
      var wrap = document.createElement("div");
      wrap.className = "table-wrap";
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  // ------------------------------------------------------------------- copy

  var COPY_LABEL = "Copy";

  // A button on every code block, which is the one thing a reader wants to do
  // with code that reading it does not give them.
  //
  // It goes in a wrapper rather than in the <pre> itself, for the reason the
  // table above has one: a <pre> is its own horizontal scroller, and anything
  // positioned inside it scrolls away with the code. The fences that are going
  // to be drawn -- mermaid and maths -- are left alone: their source is on
  // screen only when the drawing failed, and by then the note above it is the
  // thing to read.
  function addCopyButtons() {
    content.querySelectorAll("pre > code").forEach(function (code) {
      if (code.classList.contains("language-mermaid")) return;
      if (code.hasAttribute("data-math-style")) return;

      var pre = code.parentNode;
      var wrap = document.createElement("div");
      var button = document.createElement("button");

      wrap.className = "code-wrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      button.type = "button";
      button.className = "copy";
      button.title = "Copy this block";
      button.textContent = COPY_LABEL;
      button.addEventListener("click", function () {
        copyBlock(code, button);
      });
      wrap.appendChild(button);
    });
  }

  function copyBlock(code, button) {
    // The fence's own text: the highlighter wrapped it in spans, and textContent
    // hands back exactly what was written. What it also hands back is the
    // newline the block ends with, which is one more than anyone pasting wants.
    var text = code.textContent.replace(/\n+$/, "");

    writeClipboard(text).then(
      function () {
        say(button, "Copied");
      },
      function () {
        say(button, "Failed");
      }
    );
  }

  // The asynchronous clipboard first, because it leaves whatever the reader has
  // selected alone. Both webviews put this page in a secure context, so it is
  // there -- mark:// on WebKit, http://mark.localhost on WebView2 -- but the
  // permission behind it can still be refused, and the older way costs nothing
  // to keep for that case.
  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "offscreen";
    document.body.appendChild(area);
    area.select();

    var copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }

    document.body.removeChild(area);
    page.focus();
    return copied ? Promise.resolve() : Promise.reject(new Error("the clipboard refused"));
  }

  // The button says what happened and then goes back to being a button. The
  // timer is kept on the button itself so that a second copy restarts its own
  // countdown rather than a shared one somebody else started. What it goes back
  // to is whatever it said before, kept the first time: the viewer's button
  // says "Copy PNG", not the code blocks' word.
  function say(button, message) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = message;
    button.classList.add("said");
    clearTimeout(button.sayTimer);
    button.sayTimer = setTimeout(function () {
      button.textContent = button.dataset.label;
      button.classList.remove("said");
    }, 1400);
  }

  // --------------------------------------------------------------- diagrams

  // Nothing here runs for a document without a ```mermaid fence, which is nearly
  // all of them: the renderer is not even asked for.
  function drawDiagrams(mine) {
    var blocks = [];
    content.querySelectorAll("pre > code.language-mermaid").forEach(function (code) {
      blocks.push(code);
    });
    if (blocks.length === 0) return Promise.resolve();

    return loadMermaid()
      .then(function () {
        // mermaid measures the text to size the boxes it draws around it, so
        // measuring before Inter has arrived sizes them for the fallback font.
        return document.fonts.ready;
      })
      .then(function () {
        var chain = Promise.resolve();
        blocks.forEach(function (code) {
          chain = chain.then(function () {
            if (mine !== generation) return null;
            return drawOne(code, mine);
          });
        });
        return chain;
      })
      .catch(function (error) {
        // Only the renderer failing to load reaches here; a diagram that will
        // not parse is caught in drawOne, one block at a time.
        if (mine !== generation) return;
        blocks.forEach(function (code) {
          keepSource(code.parentNode, error);
        });
      });
  }

  function drawOne(code, mine) {
    var pre = code.parentNode;
    // The fence's own text, whatever the highlighter made of it on the way here.
    var source = code.textContent;
    var figure = document.createElement("figure");
    var chain = Promise.resolve();

    figure.className = "diagram";
    // A click opens it in the viewer, and so does Enter once it has the focus:
    // nothing that does something should be reachable only with a pointer.
    figure.tabIndex = 0;
    figure.setAttribute("role", "button");
    figure.setAttribute("aria-label", "Open the diagram");
    figure.title = "Open to move, zoom and copy";

    DIAGRAM_PALETTES.forEach(function (palette) {
      chain = chain
        .then(function () {
          diagrams += 1;
          // strict is what stops a `click` written in a document from naming a
          // function to run, and the bindFunctions the render hands back -- the
          // other half of that -- is deliberately never called.
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            // Without this, a fence that will not parse leaves mermaid's own
            // error drawing floating in the page, beside the source we keep and
            // the message we write ourselves. It is one of the settings a
            // document cannot reach with a directive.
            suppressErrorRendering: true,
            theme: palette.theme,
            // Read off the page rather than written out again: the font stack
            // lives in style.css and has no business being in two files.
            fontFamily: getComputedStyle(document.body).fontFamily,
          });
          return mermaid.render("mark-diagram-" + diagrams, source);
        })
        .then(function (result) {
          var half = document.createElement("div");
          half.className = palette.className;
          half.innerHTML = result.svg;
          figure.appendChild(half);
        });
    });

    return chain
      .then(function () {
        if (mine !== generation) return;
        addDiagramCopy(figure);
        pre.parentNode.insertBefore(figure, pre);
        pre.hidden = true;
      })
      .catch(function (error) {
        if (mine !== generation) return;
        keepSource(pre, error);
      });
  }

  // A diagram that will not parse leaves its source where it was, with the
  // reason above it. Swallowing the fence would lose the diagram and the text it
  // was written as.
  function keepSource(pre, error) {
    var note = document.createElement("p");
    note.className = "diagram-error";
    note.textContent = "Diagram: " + ((error && error.message) || String(error));
    pre.parentNode.insertBefore(note, pre);
    pre.hidden = false;
  }

  // Fetched when a document turns out to need it, and once per window. The URL
  // is relative on purpose: it resolves against the page's own mark:// address,
  // which differs between platforms, and app.js is served as a static asset with
  // no placeholder to fill the origin into.
  function loadMermaid() {
    if (mermaidLoading) return mermaidLoading;

    var script = document.createElement("script");
    script.src = "/__mark__/mermaid.min.js";

    mermaidLoading = arrival(script).catch(function () {
      throw new Error("the diagram renderer could not be loaded");
    });
    return mermaidLoading;
  }

  // A tag that fetches something, as a promise of it having arrived. Adding it
  // to the page is part of the same step, so that nothing can be waited on
  // before it has actually been asked for. Both renderers below are loaded
  // through this.
  function arrival(element) {
    return new Promise(function (resolve, reject) {
      element.onload = resolve;
      element.onerror = reject;
      document.head.appendChild(element);
    });
  }

  // ----------------------------------------------------------------- viewer

  // A diagram opened over the whole window, to be moved about and zoomed. The
  // figure itself is moved in, and a placeholder of its height keeps its place
  // in the document -- a copy would put every id in the drawing on the page
  // twice, and mermaid finds its own styles and arrowheads by id. Moving it
  // also keeps both drawings together, so d goes on switching between them.
  //
  // The zoom is a width rather than a scale(), so the drawing is laid out again
  // at every size and stays sharp. Only the pan is a transform.
  var VIEWER_MARGIN = 32;
  var VIEWER_FIT_LARGEST = 2;
  var VIEWER_SMALLEST = 0.1;
  var VIEWER_LARGEST = 8;
  var VIEWER_STEP = 1.25;

  // The figure on show, the placeholder holding its place, and where it is: the
  // zoom, and the offset of its corner from the stage's. null when closed.
  var viewing = null;
  var drag = null;

  function openViewer(figure) {
    if (viewing) return;
    var placeholder = document.createElement("div");
    placeholder.style.height = figure.offsetHeight + "px";
    figure.parentNode.replaceChild(placeholder, figure);
    viewerCanvas.appendChild(figure);
    viewing = { figure: figure, placeholder: placeholder, scale: 1, x: 0, y: 0 };
    viewer.hidden = false;
    fitViewer();
    viewerStage.focus();
  }

  // The figure goes back where it came from. setContent closes the viewer
  // before replacing the document, so the placeholder is still there; were it
  // not, there would be nowhere to put the figure, and it goes with the viewer.
  function closeViewer() {
    if (!viewing) return;
    var shown = viewing;
    viewing = null;
    drag = null;
    viewer.hidden = true;
    viewerCanvas.removeAttribute("style");
    viewerStage.classList.remove("dragging");
    if (shown.placeholder.parentNode) {
      shown.placeholder.parentNode.replaceChild(shown.figure, shown.placeholder);
    } else {
      viewerCanvas.removeChild(shown.figure);
    }
    page.focus();
  }

  // The one of the two drawings the stylesheet is showing.
  function shownSvg(figure) {
    var halves = figure.querySelectorAll(".diagram-light, .diagram-dark");
    var index;
    for (index = 0; index < halves.length; index += 1) {
      if (getComputedStyle(halves[index]).display !== "none") return halves[index].querySelector("svg");
    }
    return figure.querySelector("svg");
  }

  // The size the drawing was made at, which is what 100% means. Read off the
  // viewBox rather than the box on screen: in the document the column may have
  // shrunk it, and in the viewer the zoom has changed it.
  function naturalSize(svg) {
    var box = svg.viewBox && svg.viewBox.baseVal;
    if (box && box.width > 0 && box.height > 0) return { width: box.width, height: box.height };
    var rect = svg.getBoundingClientRect();
    return { width: rect.width || 1, height: rect.height || 1 };
  }

  function clampZoom(scale) {
    return Math.max(VIEWER_SMALLEST, Math.min(VIEWER_LARGEST, scale));
  }

  // The whole drawing in view, centred, and at no more than twice its size: a
  // small diagram blown up to fill a large window is more pixels than it is
  // worth, and + is right there for anyone who wants them.
  function fitViewer() {
    if (!viewing) return;
    var size = naturalSize(shownSvg(viewing.figure));
    var stage = viewerStage.getBoundingClientRect();
    viewing.scale = clampZoom(
      Math.min(
        (stage.width - 2 * VIEWER_MARGIN) / size.width,
        (stage.height - 2 * VIEWER_MARGIN) / size.height,
        VIEWER_FIT_LARGEST
      )
    );
    viewing.x = (stage.width - size.width * viewing.scale) / 2;
    viewing.y = (stage.height - size.height * viewing.scale) / 2;
    placeViewer();
  }

  function placeViewer() {
    var size = naturalSize(shownSvg(viewing.figure));
    viewerCanvas.style.width = size.width * viewing.scale + "px";
    viewerCanvas.style.transform = "translate(" + viewing.x + "px, " + viewing.y + "px)";
    viewerFit.textContent = Math.round(viewing.scale * 100) + "%";
  }

  // By a factor, holding still whatever is under the point given, in the
  // stage's own coordinates: the pointer for the wheel, the middle for keys.
  function zoomViewer(factor, x, y) {
    if (!viewing) return;
    var scale = clampZoom(viewing.scale * factor);
    var ratio = scale / viewing.scale;
    viewing.x = x - (x - viewing.x) * ratio;
    viewing.y = y - (y - viewing.y) * ratio;
    viewing.scale = scale;
    placeViewer();
  }

  function zoomViewerAtMiddle(factor) {
    var stage = viewerStage.getBoundingClientRect();
    zoomViewer(factor, stage.width / 2, stage.height / 2);
  }

  viewerStage.addEventListener("pointerdown", function (event) {
    if (event.button !== 0 || !viewing) return;
    drag = { pointer: event.pointerId, x: event.clientX - viewing.x, y: event.clientY - viewing.y };
    viewerStage.setPointerCapture(event.pointerId);
    viewerStage.classList.add("dragging");
  });

  viewerStage.addEventListener("pointermove", function (event) {
    if (!drag || !viewing || event.pointerId !== drag.pointer) return;
    viewing.x = event.clientX - drag.x;
    viewing.y = event.clientY - drag.y;
    placeViewer();
  });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag = null;
    viewerStage.classList.remove("dragging");
  }

  viewerStage.addEventListener("pointerup", endDrag);
  viewerStage.addEventListener("pointercancel", endDrag);

  // Every turn of the wheel is a zoom in here, Ctrl or not: there is nothing to
  // scroll. Exponential in the distance travelled, so that a touchpad's many
  // small steps and a wheel's few large ones come to the same zoom for the same
  // travel. A wheel that counts in lines is taken at a line's height.
  viewerStage.addEventListener(
    "wheel",
    function (event) {
      event.preventDefault();
      if (!viewing) return;
      var stage = viewerStage.getBoundingClientRect();
      var travel = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      travel = Math.max(-240, Math.min(240, travel));
      zoomViewer(Math.exp(-travel * 0.002), event.clientX - stage.left, event.clientY - stage.top);
    },
    { passive: false }
  );

  // A diagram opens on a click. The copy button in its corner is the one part
  // of it that does something else, and a link someone wrote into a label is
  // followed rather than opened.
  content.addEventListener("click", function (event) {
    if (event.target.closest("a, button")) return;
    var figure = event.target.closest(".diagram");
    if (figure) openViewer(figure);
  });

  press("viewer-in", function () {
    zoomViewerAtMiddle(VIEWER_STEP);
  });
  press("viewer-out", function () {
    zoomViewerAtMiddle(1 / VIEWER_STEP);
  });
  press("viewer-fit", fitViewer);
  press("viewer-copy", function () {
    if (viewing) copyDiagram(viewing.figure, viewerCopy);
  });
  press("viewer-close", closeViewer);

  // The viewer is modal, the way the help panel is: behind it a t or a / would
  // act on a document nobody can see. d and D still reach the theme, because
  // the drawing on show changes with it -- and so does the picture Ctrl C
  // copies, which is whichever drawing that is.
  function viewerKey(event, mod, key) {
    if (mod && (key === "c" || key === "C")) {
      event.preventDefault();
      return copyDiagram(viewing.figure, viewerCopy);
    }
    if (mod || event.altKey) return;
    if (key === "+" || key === "=") {
      event.preventDefault();
      return zoomViewerAtMiddle(VIEWER_STEP);
    }
    if (key === "-") {
      event.preventDefault();
      return zoomViewerAtMiddle(1 / VIEWER_STEP);
    }
    if (key === "0") {
      event.preventDefault();
      return fitViewer();
    }
    if (key === "d") {
      event.preventDefault();
      return cycleTheme();
    }
    if (key === "D") {
      event.preventDefault();
      return setTheme("system");
    }
  }

  // ---------------------------------------------------------------- picture

  var SVG_NS = "http://www.w3.org/2000/svg";

  // Twice the drawing's own size, so that the picture stays sharp pasted into
  // something that shows it larger -- but no side past 8192 pixels, which is
  // about where a canvas stops agreeing to be made at all.
  var PICTURE_SCALE = 2;
  var PICTURE_LARGEST_SIDE = 8192;
  var diagramFontLoading = null;

  // The button waiting to hear from Rust whether its picture made it onto the
  // clipboard. See pictureCopied.
  var pictureButton = null;

  // A copy button in the diagram's corner, beside the one every code block has.
  function addDiagramCopy(figure) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.title = "Copy this diagram as a PNG picture";
    button.textContent = COPY_LABEL;
    button.addEventListener("click", function () {
      copyDiagram(figure, button);
    });
    figure.appendChild(button);
  }

  // The picture goes to the clipboard as a promise, handed over inside the
  // click, rather than drawn first and handed over after. WebKit lets a page
  // write to the clipboard only while it is still answering a click, and the
  // drawing outlasts that; a ClipboardItem holding a promise keeps the click's
  // permission for as long as the picture takes to arrive.
  function copyDiagram(figure, button) {
    // Where the clipboard forgets what a program put on it once that program
    // has gone -- Wayland -- mark holds the picture itself, and the page only
    // draws it; clipboard.rs says why. Rust decides which, per platform, and
    // writes the answer on the root element before the page loads.
    if (document.documentElement.dataset.copyPictures === "mark") {
      pictureButton = button;
      diagramPicture(figure)
        .then(blobBase64)
        .then(
          function (png) {
            send({ type: "copy-picture", png: png });
          },
          function () {
            pictureButton = null;
            say(button, "Failed");
          }
        );
      return;
    }

    if (typeof ClipboardItem === "undefined" || !navigator.clipboard || !navigator.clipboard.write) {
      say(button, "Failed");
      return;
    }
    navigator.clipboard.write([new ClipboardItem({ "image/png": diagramPicture(figure) })]).then(
      function () {
        say(button, "Copied");
      },
      function () {
        say(button, "Failed");
      }
    );
  }

  // The drawing on show, as a PNG: at its own size and twice over, filled with
  // the page colour it was drawn against, so that a dark diagram pasted into a
  // white document still reads. It is drawn as an SVG image, which cannot reach
  // the page's fonts, so the page's Inter is written into a copy of it first;
  // protocol.rs says why that arrives as a script.
  function diagramPicture(figure) {
    var svg = shownSvg(figure);
    var size = naturalSize(svg);
    var scale = Math.min(PICTURE_SCALE, PICTURE_LARGEST_SIDE / size.width, PICTURE_LARGEST_SIDE / size.height);
    var background = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff";

    return loadDiagramFont().then(function (faces) {
      var copy = svg.cloneNode(true);
      copy.setAttribute("width", size.width);
      copy.setAttribute("height", size.height);
      copy.style.maxWidth = "";
      var style = document.createElementNS(SVG_NS, "style");
      style.textContent = faces;
      copy.insertBefore(style, copy.firstChild);
      return rasterise(copy, Math.round(size.width * scale), Math.round(size.height * scale), background);
    });
  }

  function rasterise(svg, width, height, background) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var context = canvas.getContext("2d");
        context.fillStyle = background;
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        // An engine that counts the drawing's HTML labels as foreign content
        // refuses to hand the pixels back, and says so by throwing here.
        try {
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error("the picture could not be encoded"));
          }, "image/png");
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = function () {
        reject(new Error("the diagram could not be drawn as a picture"));
      };
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    });
  }

  // A blob as the base64 Rust decodes: FileReader's data URL, less its prefix.
  function blobBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result).split(",")[1] || "");
      };
      reader.onerror = function () {
        reject(reader.error);
      };
      reader.readAsDataURL(blob);
    });
  }

  // Fetched the first time a diagram is copied, and once per window. A face
  // that will not load is not worth refusing the copy over: the picture comes
  // out in whatever the system has instead, and the next copy tries again.
  function loadDiagramFont() {
    if (diagramFontLoading) return diagramFontLoading;
    var script = document.createElement("script");
    script.src = "/__mark__/diagram-font.js";
    diagramFontLoading = arrival(script).then(
      function () {
        return window.__markDiagramFont || "";
      },
      function () {
        diagramFontLoading = null;
        return "";
      }
    );
    return diagramFontLoading;
  }

  // ------------------------------------------------------------------ maths

  // Nothing here runs for a document without maths in it, which is nearly all of
  // them. Unlike a diagram a formula is the same drawing in both palettes --
  // KaTeX lays it out in HTML and leaves the colour to currentColor -- so there
  // is no second pass here, and pressing d costs nothing.
  function typesetMath(mine) {
    var nodes = [];
    content.querySelectorAll("[data-math-style]").forEach(function (node) {
      nodes.push(node);
    });
    if (nodes.length === 0) return Promise.resolve();

    return loadKatex()
      .then(function () {
        if (mine !== generation) return null;
        nodes.forEach(typesetOne);
        // The faces KaTeX draws with are fetched only once a formula is on the
        // page, and every line below one moves again when they land.
        return document.fonts.ready;
      })
      .catch(function (error) {
        // Only the renderer failing to load reaches here; a formula whose TeX
        // will not parse is KaTeX's own business, and it writes that one out in
        // red where it stands. Either way the source someone wrote is still on
        // the page, so all this adds is the reason -- once, at the top, because
        // what failed is the renderer and not any one formula.
        if (mine !== generation) return;
        noteMathFailure(error);
      });
  }

  function typesetOne(node) {
    // The two dollar forms mark the node holding the source itself; the ```math
    // fence marks the <code> inside a <pre>, and that one keeps the shape a
    // diagram has -- the source stays in the page, hidden, with the drawing in
    // front of it.
    var pre = null;
    var target = node;

    if (node.tagName === "CODE" && node.parentNode.tagName === "PRE") pre = node.parentNode;

    if (pre) {
      target = document.createElement("div");
      target.className = "math-block";
      pre.parentNode.insertBefore(target, pre);
    }

    try {
      katex.render(node.textContent, target, {
        displayMode: node.getAttribute("data-math-style") === "display",
        // A document is not trusted with the commands that reach outside the
        // formula: \href, \url and \includegraphics. This is KaTeX's half of
        // the decision securityLevel: "strict" is for mermaid.
        trust: false,
        // A formula that will not parse is written out where it stands rather
        // than thrown, which is the same answer keepSource gives a fence mermaid
        // refused. KaTeX puts this straight into a style attribute, so naming
        // the custom property here keeps the colour itself in the stylesheet
        // with every other one, and keeps it right in both palettes.
        throwOnError: false,
        errorColor: "var(--caution)",
      });
      if (pre) pre.hidden = true;
    } catch (error) {
      // Only what KaTeX will not swallow itself lands here. The source is left
      // exactly where it was.
      if (pre) target.parentNode.removeChild(target);
      noteMathFailure(error);
    }
  }

  function noteMathFailure(error) {
    if (content.querySelector(".math-error")) return;
    var note = document.createElement("p");
    note.className = "math-error";
    note.textContent = "Maths: " + ((error && error.message) || String(error));
    content.insertBefore(note, content.firstChild);
  }

  // Both halves before anything is typeset: KaTeX lays a formula out as HTML and
  // the stylesheet is what gives that HTML its sizes, so a formula drawn before
  // the <link> lands is a heap of overlapping letters. The URLs are relative for
  // the reason the diagram renderer's is.
  function loadKatex() {
    if (katexLoading) return katexLoading;

    var script = document.createElement("script");
    script.src = "/__mark__/katex.min.js";

    var style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "/__mark__/katex.min.css";

    katexLoading = Promise.all([arrival(script), arrival(style)]).catch(function () {
      throw new Error("the formula renderer could not be loaded");
    });
    return katexLoading;
  }

  // ---------------------------------------------------------------- sidebar

  function buildToc() {
    spy = null;
    tocList.textContent = "";

    var headings = content.querySelectorAll("h1[id], h2[id], h3[id], h4[id]");
    // A document with no heading at all has nothing to list, whoever asks.
    if (headings.length === 0) {
      toc.hidden = true;
      syncBar();
      return;
    }

    headings.forEach(function (heading) {
      var link = document.createElement("a");
      link.href = "#" + heading.id;
      link.className = "level-" + heading.tagName.slice(1);
      link.textContent = headingText(heading);
      tocList.appendChild(link);
    });

    toc.hidden = tocChoice === null ? headings.length < 3 : !tocChoice;
    syncBar();
    watchHeadings(headings);
  }

  // The heading's own text, without the anchor link comrak tucks inside it.
  function headingText(heading) {
    var clone = heading.cloneNode(true);
    clone.querySelectorAll("a.anchor").forEach(function (a) {
      a.remove();
    });
    return clone.textContent.trim();
  }

  // Highlight the entry for the section the reader is in: the reading line sits
  // a quarter of the way down the view, and the section is the last heading to
  // have crossed it. This is measured on demand rather than watched with an
  // IntersectionObserver, because the end of the page is not a heading crossing
  // a line -- there is no event there to hear, and that is where a short final
  // section leaves the reader.
  function watchHeadings(headings) {
    spy = function () {
      // Neither end of the scroll can be read off the line, so each answers for
      // itself. At the top the document opens on its own title -- which is also
      // the whole of a document that fits the window and never scrolls at all.
      if (page.scrollTop <= 2) return markActive(headings[0].id);

      // At the bottom a short final section runs out of page before its heading
      // can reach the line, so that entry would never light up however far the
      // reader scrolled. Once the page has been scrolled as far as it goes, the
      // section they are in is simply the last one on screen.
      var view = page.getBoundingClientRect();
      var line = scrolledToEnd() ? view.bottom : view.top + view.height * 0.25;

      var chosen = headings[0].id;
      headings.forEach(function (heading) {
        if (headingTop(heading) < line) chosen = heading.id;
      });
      markActive(chosen);
    };
    spy();
  }

  // True only when there is something to scroll and all of it has been
  // scrolled. A document that fits the window is not at its end for this
  // purpose: nothing in it is out of reach, so the reading line still holds.
  function scrolledToEnd() {
    var slack = page.scrollHeight - page.clientHeight;
    return slack > 2 && page.scrollTop >= slack - 2;
  }

  function markActive(id) {
    tocList.querySelectorAll("a").forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("href") === "#" + id);
    });
  }

  function toggleToc() {
    // A document with no heading has no sidebar to show, and a press here would
    // be an answer about one nobody can see -- kept, and waiting to surprise
    // the reader in the next document that has headings.
    if (tocList.childElementCount === 0) return;
    // What the key answers is whatever is on screen now, which for a short
    // document is the rule above rather than an earlier press.
    tocChoice = toc.hidden;
    toc.hidden = !tocChoice || tocList.childElementCount === 0;
    store(TOC_KEY, tocChoice ? "shown" : "hidden");
    syncBar();
  }

  // ------------------------------------------------------------------ width

  // The reading column is a measure rather than a limit, and the stylesheet
  // lifts it for whatever carries data-wide. The answer is kept between runs,
  // like the theme: a reader who widens the page is more often saying how they
  // like to read on this screen than something about one document, and the
  // rarer case costs one more press of Z.
  function toggleWide() {
    var root = document.documentElement;
    if (root.hasAttribute("data-wide")) root.removeAttribute("data-wide");
    else root.setAttribute("data-wide", "");
    store(WIDE_KEY, root.hasAttribute("data-wide") ? "1" : null);
    syncBar();
    // Every line has just been rewrapped, so every heading is somewhere else.
    updateSpy();
  }

  // ----------------------------------------------------------------- source

  // What Rust sent along with the page. Split once, here, because the rows,
  // the copy handler and the place-keeping all count in lines. A file that ends
  // in a newline -- nearly every one -- has no line after it, whatever split
  // says; the copy button still copies the text exactly as it is on disk.
  function setSource(text) {
    sourceText = typeof text === "string" ? text : null;
    sourceLines = sourceText === null ? [] : sourceText.split(/\r\n|\n|\r/);
    if (sourceLines.length > 1 && sourceLines[sourceLines.length - 1] === "") sourceLines.pop();
  }

  // Which of the two is on screen, and what the bar offers. The page stays in
  // the DOM, hidden, while the source is shown: the sidebar is still built from
  // its headings and Ctrl U has to come back to it without asking Rust.
  function syncSource() {
    var available = sourceText !== null && empty.hidden;
    var on = available && sourceShown;
    if (on && sourceBuilt !== generation) buildSource();
    source.hidden = !on;
    content.hidden = !empty.hidden || on;
    barSource.disabled = !available;
    barCopy.disabled = !available;
    syncBar();
  }

  function buildSource() {
    var rows = document.createDocumentFragment();
    sourceLines.forEach(function (text) {
      var row = document.createElement("div");
      row.className = "line";
      // Text, never markup: this is the document's own HTML as written, and it
      // is shown, not run.
      if (text) row.textContent = text;
      rows.appendChild(row);
    });
    source.textContent = "";
    source.appendChild(rows);
    // The gutter is as wide as the largest number in it and no wider.
    source.style.setProperty("--digits", String(String(sourceLines.length).length));
    sourceBuilt = generation;
  }

  function toggleSource() {
    if (sourceText === null || !empty.hidden) return;
    // Where the reader is, as a line of the file, measured on whichever of the
    // two is still on screen -- and then found again on the other.
    var place = source.hidden ? pagePlace() : sourcePlace();
    sourceShown = source.hidden;
    syncSource();
    goToPlace(place);
    // Every heading has just moved, or stopped being drawn at all.
    updateSpy();
  }

  // The lines one block came from, out of the data-sourcepos render.rs asks
  // comrak for: "12:1-15:40" is lines 12 to 15. Null for a block without one.
  function sourceRange(element) {
    var at = element.getAttribute("data-sourcepos");
    if (!at) return null;
    var dash = at.indexOf("-");
    var start = parseInt(at, 10);
    var end = parseInt(at.slice(dash + 1), 10);
    if (isNaN(start) || isNaN(end)) return null;
    return { start: start, end: end };
  }

  // The row a heading or any other element of the page was written on.
  function rowFor(element) {
    var holder = element.closest("[data-sourcepos]");
    var range = holder && sourceRange(holder);
    return range ? source.children[range.start - 1] || null : null;
  }

  // Where the sidebar measures a heading: on the page, or at its line.
  function headingTop(heading) {
    if (source.hidden) return heading.getBoundingClientRect().top;
    var row = rowFor(heading);
    return row ? row.getBoundingClientRect().top : Infinity;
  }

  // Every block of the page that can say which lines it came from, in the
  // order they are drawn. Only measurable while the page is on screen.
  //
  // Not every block carries a position. The highlighter writes its own <pre>
  // and drops it, raw HTML is passed through as written, and diagrams replace
  // the fence they came from -- which together are much of a technical
  // document. A block like that has what lies between its neighbours, blank
  // lines trimmed off the ends, and a run of several shares it out by height:
  // a long block is a long stretch of the file far more often than not.
  function pageBlocks() {
    var tops = [];
    var i;
    for (i = 0; i < content.children.length; i += 1) {
      var child = content.children[i];
      tops.push({ el: child, range: sourceRange(child) || rangeWithin(child) });
    }

    i = 0;
    while (i < tops.length) {
      if (tops[i].range) {
        i += 1;
        continue;
      }
      var first = i;
      while (i < tops.length && !tops[i].range) i += 1;
      var from = first > 0 ? tops[first - 1].range.end + 1 : 1;
      var to = i < tops.length ? tops[i].range.start - 1 : sourceLines.length;
      while (from < to && !sourceLines[from - 1].trim()) from += 1;
      while (to > from && !sourceLines[to - 1].trim()) to -= 1;
      shareOut(tops.slice(first, i), from, Math.max(from, to));
    }

    var blocks = [];
    tops.forEach(function (top) {
      blocks.push({ el: top.el, range: top.range });
      top.el.querySelectorAll("[data-sourcepos]").forEach(function (inner) {
        blocks.push({ el: inner, range: sourceRange(inner) });
      });
    });
    // Something drawn nowhere -- inside a closed <details>, say -- has no
    // place on screen to measure.
    return blocks.filter(function (block) {
      return block.el.getClientRects().length > 0;
    });
  }

  // A wrapper app.js put around a block -- the scroller around a table -- has
  // no position of its own, and the lines of what is inside it are its lines.
  function rangeWithin(element) {
    var range = null;
    element.querySelectorAll("[data-sourcepos]").forEach(function (inner) {
      var own = sourceRange(inner);
      if (!own) return;
      if (!range) range = { start: own.start, end: own.end };
      range.start = Math.min(range.start, own.start);
      range.end = Math.max(range.end, own.end);
    });
    return range;
  }

  function shareOut(run, from, to) {
    var total = 0;
    run.forEach(function (top) {
      total += Math.max(top.el.offsetHeight, 1);
    });
    var span = to - from + 1;
    var at = from;
    run.forEach(function (top) {
      var lines = Math.max(1, Math.round((span * Math.max(top.el.offsetHeight, 1)) / total));
      var end = Math.min(to, at + lines - 1);
      top.range = { start: at, end: end };
      at = Math.min(to, end + 1);
    });
  }

  // The line at the top of the view, with the fraction of it already scrolled
  // past: 12.4 is four tenths of the way through line 12. On the page, a block
  // is taken to spread its lines evenly over its height, which is wrong for a
  // table and close enough for everything else.
  function pagePlace() {
    if (page.scrollTop <= 2) return 1;
    var top = page.getBoundingClientRect().top;
    var chosen = null;
    var box = null;
    // The last block to start above the top of the view is the one the reader
    // is in: a list item rather than its list, the paragraph rather than the
    // quote around it.
    pageBlocks().forEach(function (block) {
      var rect = block.el.getBoundingClientRect();
      if (rect.top <= top + 1) {
        chosen = block;
        box = rect;
      }
    });
    if (!chosen) return 1;
    var fraction = box.height > 0 ? clamp((top - box.top) / box.height, 0, 1) : 0;
    return chosen.range.start + fraction * (chosen.range.end - chosen.range.start + 1);
  }

  function sourcePlace() {
    var rows = source.children;
    if (page.scrollTop <= 2 || rows.length === 0) return 1;
    var top = page.getBoundingClientRect().top;
    // The rows are in order down the page, so the first one still showing is
    // found by halving rather than by measuring all ten thousand of them.
    var low = 0;
    var high = rows.length - 1;
    while (low < high) {
      var middle = (low + high) >> 1;
      if (rows[middle].getBoundingClientRect().bottom > top) high = middle;
      else low = middle + 1;
    }
    var box = rows[low].getBoundingClientRect();
    var fraction = box.height > 0 ? clamp((top - box.top) / box.height, 0, 1) : 0;
    return low + 1 + fraction;
  }

  function goToPlace(place) {
    if (place <= 1) return scrollInstantly(0);
    var top = page.getBoundingClientRect().top;
    var whole = Math.floor(place);
    var y;

    if (!source.hidden) {
      var row = source.children[clamp(whole - 1, 0, source.children.length - 1)];
      if (!row) return scrollInstantly(0);
      var box = row.getBoundingClientRect();
      y = box.top + (place - whole) * box.height;
    } else {
      var chosen = null;
      pageBlocks().forEach(function (block) {
        if (block.range.start <= whole) chosen = block;
      });
      if (!chosen) return scrollInstantly(0);
      var rect = chosen.el.getBoundingClientRect();
      var span = chosen.range.end - chosen.range.start + 1;
      y = rect.top + clamp((place - chosen.range.start) / span, 0, 1) * rect.height;
    }
    scrollInstantly(page.scrollTop + y - top);
  }

  // The page scrolls smoothly, which is right for a key that moves the reader
  // and wrong for one that swaps what they are reading: the view would glide
  // in from the top of the file to the place it was already meant to be.
  function scrollInstantly(y) {
    page.style.scrollBehavior = "auto";
    page.scrollTop = y;
    page.style.scrollBehavior = "";
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  // What a copy out of the source puts on the clipboard, worked out from the
  // lines rather than from the selection's own text. The rows are blocks, and
  // what the webview makes of a selection across blocks is its own business:
  // WebKit folds an empty one away to nothing, and a blank line of the file
  // would go missing from every paste. Anything selected outside the source --
  // the sidebar, under Ctrl A -- is left out, since it was never in the file.
  document.addEventListener("copy", function (event) {
    if (source.hidden || document.activeElement === findInput) return;
    var selection = window.getSelection();
    if (selection.rangeCount === 0 || selection.isCollapsed) return;
    var range = selection.getRangeAt(0);
    if (!range.intersectsNode(source)) return;

    var from = sourcePoint(range.startContainer, range.startOffset);
    var to = sourcePoint(range.endContainer, range.endOffset);
    var text;
    if (from.line === to.line) {
      text = sourceLines[from.line].slice(from.at, to.at);
    } else {
      text = [sourceLines[from.line].slice(from.at)]
        .concat(sourceLines.slice(from.line + 1, to.line))
        .concat([sourceLines[to.line].slice(0, to.at)])
        .join("\n");
    }
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  });

  // One end of a selection as a line of the file and a character in it. An
  // end can sit in a row's text, on a row, on the source itself between two
  // rows, or outside it altogether, which clamps it to the first or last line.
  function sourcePoint(node, offset) {
    var last = sourceLines.length - 1;
    var start = { line: 0, at: 0 };
    var end = { line: last, at: sourceLines[last].length };
    var whole = document.createRange();
    whole.selectNodeContents(source);
    var where = whole.comparePoint(node, offset);
    if (where < 0) return start;
    if (where > 0) return end;

    if (node === source) {
      return offset >= source.children.length ? end : { line: offset, at: 0 };
    }
    var row = node.nodeType === Node.ELEMENT_NODE ? node.closest(".line") : node.parentNode.closest(".line");
    if (!row) return start;
    var line = Array.prototype.indexOf.call(source.children, row);
    if (node === row) {
      return { line: line, at: offset === 0 ? 0 : sourceLines[line].length };
    }
    return { line: line, at: Math.min(offset, sourceLines[line].length) };
  }

  // The whole file, exactly as it is on disk, with whichever of the two on
  // screen. The button answers with a check, or in the caution colour if the
  // clipboard refused: it has no words to change the way the code blocks' do.
  function copySource() {
    if (sourceText === null || !empty.hidden) return;
    writeClipboard(sourceText).then(
      function () {
        flash(barCopy, "said");
      },
      function () {
        flash(barCopy, "refused");
      }
    );
  }

  function flash(button, state) {
    button.classList.remove("said", "refused");
    button.classList.add(state);
    clearTimeout(button.flashTimer);
    button.flashTimer = setTimeout(function () {
      button.classList.remove(state);
    }, 1400);
  }

  // ------------------------------------------------------------------ links

  document.addEventListener("click", function (event) {
    var link = event.target.closest("a");
    if (!link) return;
    event.preventDefault();

    var href = link.getAttribute("href") || "";
    if (href.charAt(0) === "#") {
      jumpTo(href.slice(1));
      return;
    }
    // link.href is the fully resolved URL; Rust decides whether it opens here
    // or in the desktop's default application.
    send({ type: "open", href: link.href });
  });

  // True when there was somewhere to go. The id arrives as the link wrote it,
  // and link.href percent-encodes whatever the document left bare, so a heading
  // with an accent in it arrives as %C3%A7 and friends; comrak's ids hold the
  // characters themselves, so the decoded form is tried as well.
  function jumpTo(id, behavior) {
    var target = findAnchor(id);
    if (!target) {
      try {
        target = findAnchor(decodeURIComponent(id));
      } catch (e) {
        target = null;
      }
    }
    if (!target) return false;
    // With the source on screen the page is not drawn, and scrolling to the
    // heading would scroll nothing: its line is what the reader is after.
    if (!source.hidden) {
      var row = rowFor(target);
      if (row) row.scrollIntoView({ behavior: behavior || "smooth", block: "start" });
    } else {
      target.scrollIntoView({ behavior: behavior || "smooth", block: "start" });
    }
    // A document that fits the window does not scroll at all, so nothing else
    // would ever tell the sidebar which entry the reader picked. Where the page
    // does scroll, the spy settles the highlight a moment later anyway.
    markActive(target.id || id);
    return true;
  }

  // Inside the document only. The page around it has ids of its own -- page,
  // toc, help -- and a heading that happened to share one would lose to them.
  function findAnchor(id) {
    if (!id) return null;
    var quoted = CSS.escape(id);
    return content.querySelector("#" + quoted + ", [name=\"" + quoted + "\"]");
  }

  // -------------------------------------------------------------- find bar

  function openFind() {
    // The bar's own button is disabled with no document open, and the key that
    // does the same thing should not be the way round it: there is nothing on
    // an empty page to find.
    if (!empty.hidden) return;
    find.hidden = false;
    syncBar();
    findInput.select();
    findInput.focus();
  }

  function closeFind() {
    find.hidden = true;
    find.classList.remove("no-match");
    syncBar();
    window.getSelection().removeAllRanges();
    page.focus();
  }

  function search(forward) {
    var query = findInput.value;
    if (!query) return;
    // window.find is non-standard but present in both WebKit and WebView2, and
    // it gives us the browser's own highlighting for free.
    var hit = window.find(query, false, !forward, true, false, false, false);
    find.classList.toggle("no-match", !hit);
  }

  findInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      search(!event.shiftKey);
    }
  });
  findInput.addEventListener("input", function () {
    find.classList.remove("no-match");
  });
  document.getElementById("find-next").addEventListener("click", function () {
    search(true);
  });
  document.getElementById("find-prev").addEventListener("click", function () {
    search(false);
  });
  document.getElementById("find-close").addEventListener("click", closeFind);

  // ------------------------------------------------------------ help panel

  // Rust filled the panel in before the page loaded, so there is nothing to
  // build here -- only the same hidden/shown dance the find bar does.
  function openHelp() {
    help.hidden = false;
    // The card, not the close button: a focus ring drawn on a button nobody
    // pressed looks like a stray box in the corner.
    helpCard.focus();
  }

  function closeHelp() {
    help.hidden = true;
    page.focus();
  }

  function toggleHelp() {
    if (help.hidden) openHelp();
    else closeHelp();
  }

  document.getElementById("help-open").addEventListener("click", toggleHelp);
  helpClose.addEventListener("click", closeHelp);

  // A click on the dimmed area around the card, which is the panel itself.
  help.addEventListener("click", function (event) {
    if (event.target === help) closeHelp();
  });

  // ---------------------------------------------------------------- top bar

  // Nothing here is an action of its own: each button sends the message its
  // shortcut already sends, so that the shortcut is not the only way in.

  // What Rust knows and the page does not: which file is on screen, and whether
  // the history has anywhere left to go in either direction.
  function applyState(state) {
    if (!state) return;
    barName.textContent = state.name;
    // The whole path behind the name, because the name on its own often is not
    // an answer -- half the documents anyone opens are called README.md.
    barName.title = state.path;
    barBack.disabled = !state.back;
    barForward.disabled = !state.forward;
    showEmpty(state.empty, state.reopen);
  }

  // The window with no document in it. Everything left in the bar acts on a
  // document, so with none there is nothing for any of it to act on; the two
  // arrows are already answered by state.back and state.forward.
  //
  // The sidebar needs no handling here: buildToc runs on the empty body a moment
  // later, finds no heading and puts itself away, and the reader's own answer
  // about it survives to be honoured again when the document comes back.
  function showEmpty(on, reopen) {
    empty.hidden = !on;
    barReload.disabled = on;
    barFolder.disabled = on;
    barPath.disabled = on;
    barToc.disabled = on;
    barFind.disabled = on;
    barWide.disabled = on;
    barPrint.disabled = on;

    // Whatever was being searched for is in a document that is no longer here.
    if (on && !find.hidden) closeFind();

    emptyReopen.hidden = !reopen;
    if (reopen) {
      emptyReopen.textContent = "Reopen " + reopen.name;
      emptyReopen.title = reopen.path;
    }

    // Which of the page and its source is drawn depends on there being a
    // document at all, so it is settled here, after the empty state is.
    syncSource();
  }

  // The four things in the bar that turn something on and leave it on.
  // Everything else there happens once and has no state to show.
  function syncBar() {
    barToc.setAttribute("aria-pressed", String(!toc.hidden));
    barFind.setAttribute("aria-pressed", String(!find.hidden));
    barWide.setAttribute("aria-pressed", String(document.documentElement.hasAttribute("data-wide")));
    barSource.setAttribute("aria-pressed", String(!source.hidden));

    // A document with no headings has no contents to list, and a button that
    // looks like every other one and does nothing reads as broken. It is
    // marked unavailable rather than disabled: a disabled button takes no
    // pointer events, so its tooltip -- the one place to say why -- would
    // never show. With no document at all it is disabled outright, like the
    // rest of the bar, and there is nothing to explain.
    var nothingToList = empty.hidden && tocList.childElementCount === 0;
    if (nothingToList) barToc.setAttribute("aria-disabled", "true");
    else barToc.removeAttribute("aria-disabled");
    barToc.title = nothingToList ? "No table of contents: this document has no headings" : TOC_TITLE;
  }

  // A click leaves the focus on the button, where the next Enter or space would
  // press it a second time -- on the back button, that is the history walking
  // away underneath someone who was only trying to read. page.focus(), which the
  // find bar uses to get out of its own input, is no help here: #page takes no
  // focus of its own.
  function press(id, action) {
    var button = document.getElementById(id);
    button.addEventListener("click", function () {
      button.blur();
      action();
    });
  }

  press("bar-open", function () {
    send({ type: "pick" });
  });
  press("empty-open", function () {
    send({ type: "pick" });
  });
  press("empty-reopen", function () {
    send({ type: "reopen" });
  });
  press("bar-back", function () {
    send({ type: "back" });
  });
  press("bar-forward", function () {
    send({ type: "forward" });
  });
  press("bar-folder", showFolder);
  press("bar-path", copyPath);
  press("bar-reload", function () {
    send({ type: "reload" });
  });
  press("bar-print", function () {
    send({ type: "print" });
  });
  press("bar-toc", toggleToc);
  press("bar-wide", toggleWide);
  press("bar-source", toggleSource);
  press("bar-copy", copySource);
  press("bar-theme", toggleThemeMenu);
  press("bar-find", function () {
    if (find.hidden) openFind();
    else closeFind();
  });

  // The folder the document lives in, opened by Rust in the file manager.
  // With no document there is no folder to name, and the key, like the
  // button, does nothing.
  function showFolder() {
    if (empty.hidden) send({ type: "folder" });
  }

  // The whole path of the document on screen, as Rust sent it with the bar's
  // state -- already absolute, however the file was opened. It is the
  // tooltip on the name in the middle of the bar too, which is where it is
  // read back from rather than kept twice.
  function copyPath() {
    if (!empty.hidden || !barName.title) return;
    writeClipboard(barName.title).then(
      function () {
        flash(barPath, "said");
      },
      function () {
        flash(barPath, "refused");
      }
    );
  }

  // ------------------------------------------------------------------- zoom

  function setZoom(step) {
    zoom = Math.max(0, Math.min(ZOOM_STEPS.length - 1, step));
    document.documentElement.style.fontSize = BASE_FONT_SIZE * ZOOM_STEPS[zoom] + "px";
    // Every heading has just moved, and a zoom on its own scrolls nothing.
    updateSpy();
  }

  // -------------------------------------------------------------- shortcuts

  document.addEventListener("keydown", function (event) {
    var typing = document.activeElement === findInput;
    var mod = event.ctrlKey || event.metaKey;
    var key = event.key;

    if (key === "Escape") {
      event.preventDefault();
      if (!help.hidden) closeHelp();
      else if (!themeMenu.hidden) closeThemeMenu();
      else if (viewing) closeViewer();
      else if (!find.hidden) closeFind();
      // The source is a way of looking at the document, and leaving it is the
      // dismissal a reader means before they mean closing the file.
      else if (!source.hidden) toggleSource();
      // The last rung is the document itself, not the window. Esc arrives here
      // by being pressed once too often as much as on purpose, and the empty
      // state offers the document straight back; quitting would not. Once there
      // is nothing left to close, the key does nothing at all.
      else if (empty.hidden) send({ type: "close" });
      return;
    }

    // F1 before the Ctrl block, because it is a key of its own and Windows
    // readers reach for it first.
    if (key === "F1") {
      event.preventDefault();
      return toggleHelp();
    }

    // The panel is modal: behind it, a t or a d would be an invisible action on
    // a document nobody can see. Only the keys that close it get through.
    if (!help.hidden) {
      if (key === "?") {
        event.preventDefault();
        closeHelp();
      }
      return;
    }

    // The theme menu is not modal, but d under an open one would walk the
    // palettes while the menu went on ticking the entry it opened with. Its own
    // handler has already had the arrows by the time this runs.
    if (!themeMenu.hidden) return;

    // Everything but Ctrl Q, which goes on quitting from the one place it is
    // written below.
    if (viewing && !(mod && key === "q")) return viewerKey(event, mod, key);

    if (mod) {
      switch (key) {
        case "+":
        case "=":
          event.preventDefault();
          return setZoom(zoom + 1);
        case "-":
          event.preventDefault();
          return setZoom(zoom - 1);
        case "0":
          event.preventDefault();
          return setZoom(3);
        case "f":
          event.preventDefault();
          return openFind();
        case "o":
          event.preventDefault();
          return send({ type: "pick" });
        // Shift makes it a capital: Ctrl O brings a file in, Ctrl Shift O goes
        // out to where it lives.
        case "O":
          event.preventDefault();
          return showFolder();
        case "P":
          event.preventDefault();
          return copyPath();
        case "p":
          event.preventDefault();
          return send({ type: "print" });
        case "r":
          event.preventDefault();
          return send({ type: "reload" });
        case "u":
          event.preventDefault();
          return toggleSource();
        // Shift turns the key into a capital, and Ctrl C without it is left to
        // copy whatever is selected, in the page or in the source.
        case "C":
          event.preventDefault();
          return copySource();
        case "q":
          event.preventDefault();
          return send({ type: "quit" });
      }
    }

    if (event.altKey && key === "ArrowLeft") {
      event.preventDefault();
      return send({ type: "back" });
    }
    if (event.altKey && key === "ArrowRight") {
      event.preventDefault();
      return send({ type: "forward" });
    }

    if (typing || mod || event.altKey) return;

    if ((key === "Enter" || key === " ") && document.activeElement.classList.contains("diagram")) {
      event.preventDefault();
      return openViewer(document.activeElement);
    }
    if (key === "/") {
      event.preventDefault();
      return openFind();
    }
    if (key === "?") {
      event.preventDefault();
      return openHelp();
    }
    if (key === "t") {
      event.preventDefault();
      return toggleToc();
    }
    if (key === "z") {
      event.preventDefault();
      return toggleWide();
    }
    if (key === "d") {
      event.preventDefault();
      return cycleTheme();
    }
    if (key === "D") {
      event.preventDefault();
      return setTheme("system");
    }
    if (key === "Home") {
      event.preventDefault();
      return page.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (key === "End") {
      event.preventDefault();
      return page.scrollTo({ top: page.scrollHeight, behavior: "smooth" });
    }
  });

  // What the sidebar highlights depends on where the reading line falls, so it
  // is worked out again whenever the page moves under it or the layout changes.
  page.addEventListener("scroll", updateSpy, { passive: true });
  window.addEventListener("resize", updateSpy);

  function updateSpy() {
    if (spy) spy();
  }

  // Ctrl+wheel is the other half of what people expect from zoom.
  page.addEventListener(
    "wheel",
    function (event) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? 1 : -1));
    },
    { passive: false }
  );

  // ----------------------------------------------------------------- window

  // The sidebar and the measure, as the reader last left them. Anything in
  // storage but the values toggleToc and toggleWide write is left alone rather
  // than guessed at.
  function applyStoredLayout() {
    var answer = stored(TOC_KEY);
    if (answer === "shown") tocChoice = true;
    else if (answer === "hidden") tocChoice = false;

    if (stored(WIDE_KEY) === "1") document.documentElement.setAttribute("data-wide", "");
    syncBar();
  }

  // The window as it was last left, for Rust to open the next one at. Anything
  // that is not JSON is nothing kept; whether what is kept makes a sensible
  // size is Rust's question, since Rust knows the screen.
  function storedWindow() {
    try {
      return JSON.parse(stored(WINDOW_KEY));
    } catch (e) {
      return null;
    }
  }

  // A maximised window keeps the size it had before, so that one reopened
  // maximised and then restored lands on the window the reader shaped rather
  // than on one the size of the screen.
  function keepWindow() {
    var next = windowPending;
    var kept = storedWindow();
    if (next.maximized && kept && typeof kept.width === "number" && typeof kept.height === "number") {
      next = { width: kept.width, height: kept.height, maximized: true };
    }
    store(WINDOW_KEY, JSON.stringify(next));
  }

  // Before anything is on screen, so a remembered choice never shows as a flash
  // of the other palette or the other measure.
  applyStoredTheme();
  applyStoredLayout();

  // Ask for the document. Doing it this way instead of having Rust push on a
  // timer removes the race between the webview loading and the first render.
  // The window's remembered size rides along: Rust keeps the window hidden
  // until this arrives, so that it opens at that size rather than jumping to it.
  send({ type: "ready", window: storedWindow() });
})();
