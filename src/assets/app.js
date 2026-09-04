// The page half of mark: fills in the document Rust sends, keeps the sidebar in
// sync, and forwards anything that needs the filesystem back over IPC.
(function () {
  "use strict";

  var page = document.getElementById("page");
  var content = document.getElementById("content");
  var toc = document.getElementById("toc");
  var tocList = document.getElementById("toc-list");
  var find = document.getElementById("find");
  var findInput = document.getElementById("find-input");
  var help = document.getElementById("help");
  var helpCard = document.getElementById("help-card");
  var helpClose = document.getElementById("help-close");

  var BASE_FONT_SIZE = 16.5;
  var ZOOM_STEPS = [0.75, 0.85, 0.92, 1, 1.1, 1.25, 1.4, 1.6, 1.85];
  var zoom = 3;

  var tocEnabled = true;
  var spy = null;

  // Every ```mermaid fence is drawn once per palette. The colours mermaid uses
  // end up inside the SVG it produces, so a theme cannot be a stylesheet matter
  // the way it is for the syntax colours unless both drawings are on the page
  // and the stylesheet picks one -- which is also what keeps a printout from
  // being a dark diagram on white paper.
  var DIAGRAM_PALETTES = [
    { theme: "default", className: "diagram-light" },
    { theme: "dark", className: "diagram-dark" },
  ];
  var mermaidLoading = null;
  var diagrams = 0;

  // Which document is on screen. A save part way through drawing a diagram
  // replaces the page under it, and the drawing that finishes afterwards must
  // not write into a DOM that has already been thrown away.
  var generation = 0;

  var THEME_KEY = "mark.theme";

  function send(message) {
    window.ipc.postMessage(JSON.stringify(message));
  }

  // ------------------------------------------------------------------ theme

  // With nothing stored the stylesheet follows the system on its own, through a
  // media query, and keeps following it if the system changes while the window
  // is open. Storing a choice stamps the root element, which outranks that.
  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function applyStoredTheme() {
    var stored = storedTheme();
    if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
  }

  function shownTheme() {
    return (
      document.documentElement.dataset.theme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    );
  }

  function toggleTheme() {
    var next = shownTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      // Not being able to remember the choice is no reason to refuse it.
    }
  }

  function followSystemTheme() {
    delete document.documentElement.dataset.theme;
    try {
      localStorage.removeItem(THEME_KEY);
    } catch (e) {}
  }

  // ------------------------------------------------------------- rendering

  // Called from Rust every time the document is loaded or re-read from disk.
  window.__mark = {
    setContent: function (html, keepScroll) {
      var offset = keepScroll ? page.scrollTop : 0;
      var mine = (generation += 1);
      content.innerHTML = html;
      labelCodeBlocks();
      wrapTables();
      buildToc();
      // Diagrams change the height of everything below them, so the scroll is
      // restored after they have settled rather than before. A document with no
      // fence to draw resolves immediately and lands in the same frame it
      // always did.
      drawDiagrams(mine).then(function () {
        if (mine !== generation) return;
        // Images and fonts settle a frame later; restoring after that keeps a
        // save from nudging the reader off the paragraph they were on.
        requestAnimationFrame(function () {
          page.scrollTop = offset;
        });
      });
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

    mermaidLoading = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "/__mark__/mermaid.min.js";
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("the diagram renderer could not be loaded"));
      };
      document.head.appendChild(script);
    });
    return mermaidLoading;
  }

  // ---------------------------------------------------------------- sidebar

  function buildToc() {
    spy = null;
    tocList.textContent = "";

    var headings = content.querySelectorAll("h1[id], h2[id], h3[id], h4[id]");
    // One or two headings is not a document you need a map for.
    if (headings.length < 3) {
      toc.hidden = true;
      return;
    }

    headings.forEach(function (heading) {
      var link = document.createElement("a");
      link.href = "#" + heading.id;
      link.className = "level-" + heading.tagName.slice(1);
      link.textContent = headingText(heading);
      tocList.appendChild(link);
    });

    toc.hidden = !tocEnabled;
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
        if (heading.getBoundingClientRect().top < line) chosen = heading.id;
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
    tocEnabled = !tocEnabled;
    toc.hidden = !tocEnabled || tocList.childElementCount === 0;
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

  function jumpTo(id) {
    var target = document.getElementById(id) || content.querySelector("[name='" + id + "']");
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    // A document that fits the window does not scroll at all, so nothing else
    // would ever tell the sidebar which entry the reader picked. Where the page
    // does scroll, the spy settles the highlight a moment later anyway.
    markActive(id);
  }

  // -------------------------------------------------------------- find bar

  function openFind() {
    find.hidden = false;
    findInput.select();
    findInput.focus();
  }

  function closeFind() {
    find.hidden = true;
    find.classList.remove("no-match");
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
      else if (!find.hidden) closeFind();
      else send({ type: "quit" });
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
        case "p":
          event.preventDefault();
          return send({ type: "print" });
        case "r":
          event.preventDefault();
          return send({ type: "reload" });
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
    if (key === "d") {
      event.preventDefault();
      return toggleTheme();
    }
    if (key === "D") {
      event.preventDefault();
      return followSystemTheme();
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

  // Before anything is on screen, so a remembered choice never shows as a flash
  // of the other palette.
  applyStoredTheme();

  // Ask for the document. Doing it this way instead of having Rust push on a
  // timer removes the race between the webview loading and the first render.
  send({ type: "ready" });
})();
