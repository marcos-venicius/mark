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
  var themeButton = document.getElementById("bar-theme");
  var themeMenu = document.getElementById("theme-menu");
  var themeItems = themeMenu.getElementsByTagName("button");
  var barName = document.getElementById("bar-name");
  var barBack = document.getElementById("bar-back");
  var barForward = document.getElementById("bar-forward");
  var barToc = document.getElementById("bar-toc");
  var barFind = document.getElementById("bar-find");
  var barWide = document.getElementById("bar-wide");

  var BASE_FONT_SIZE = 16.5;
  var ZOOM_STEPS = [0.75, 0.85, 0.92, 1, 1.1, 1.25, 1.4, 1.6, 1.85];
  var zoom = 3;

  // The reader's answer about the sidebar, and null until they give one. With
  // no answer the sidebar follows the document: one or two headings is not
  // something you need a map for, so it stays away. Pressing the key is an
  // answer, and it outranks that either way.
  var tocChoice = null;
  var spy = null;

  // Every ```mermaid fence is drawn twice. The colours mermaid uses end up inside
  // the SVG it produces, so a theme cannot be a stylesheet matter the way it is
  // for the syntax colours unless both drawings are on the page and the
  // stylesheet picks one -- which is also what keeps a printout from being a
  // dark diagram on white paper.
  //
  // Twice, not once per palette: Catppuccin and Gruvbox are dark pages, and the
  // dark drawing reads correctly on both. A drawing of their own would be a
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

  var THEME_KEY = "mark.theme";

  // Every palette a reader can pick, in the order D walks them. "system" is the
  // absence of the attribute rather than a value of it, which is what lets the
  // media queries in style.css go on following the desktop while the window is
  // open, for nothing. Every other name is a :root[data-theme=...] block there
  // and a scope render.rs gives syntax colours to; the order is this one because
  // the menu is written out in it too.
  var THEMES = ["system", "light", "dark", "catppuccin-mocha", "gruvbox-dark"];

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

  // What the reader chose, which is not the same as what is on screen: with
  // "system" the answer is still "system", and the desktop decides the rest.
  // The menu ticks the choice, because that is the thing pressing an entry sets.
  function currentTheme() {
    return document.documentElement.dataset.theme || "system";
  }

  function setTheme(name) {
    if (name === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = name;

    try {
      if (name === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, name);
    } catch (e) {
      // Not being able to remember the choice is no reason to refuse it.
    }

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

  // The list is the validation. Anything else in storage -- a name from a
  // version that offered a palette this one does not, or a key someone else
  // wrote -- leaves the system in charge rather than stamping the root with a
  // value no stylesheet answers to. Index 0 is "system", which is stored as
  // nothing at all, so a stored "system" is discarded by the same test.
  function applyStoredTheme() {
    var stored = storedTheme();
    if (THEMES.indexOf(stored) > 0) document.documentElement.dataset.theme = stored;
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
  // the two to get right.
  window.__mark = {
    setContent: function (html, keepScroll, state) {
      var offset = keepScroll ? page.scrollTop : 0;
      var mine = (generation += 1);
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
  // countdown rather than a shared one somebody else started.
  function say(button, message) {
    button.textContent = message;
    button.classList.add("said");
    clearTimeout(button.sayTimer);
    button.sayTimer = setTimeout(function () {
      button.textContent = COPY_LABEL;
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
    // What the key answers is whatever is on screen now, which for a short
    // document is the rule above rather than an earlier press.
    tocChoice = toc.hidden;
    toc.hidden = !tocChoice || tocList.childElementCount === 0;
    syncBar();
  }

  // ------------------------------------------------------------------ width

  // The reading column is a measure rather than a limit, and the stylesheet
  // lifts it for whatever carries data-wide. Nothing is remembered between
  // windows: the theme is a fact about the reader, but whether the measure is
  // the wrong shape is a fact about the document that happens to be open.
  function toggleWide() {
    var root = document.documentElement;
    if (root.hasAttribute("data-wide")) root.removeAttribute("data-wide");
    else root.setAttribute("data-wide", "");
    syncBar();
    // Every line has just been rewrapped, so every heading is somewhere else.
    updateSpy();
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
  }

  // The three things in the bar that turn something on and leave it on.
  // Everything else there happens once and has no state to show.
  function syncBar() {
    barToc.setAttribute("aria-pressed", String(!toc.hidden));
    barFind.setAttribute("aria-pressed", String(!find.hidden));
    barWide.setAttribute("aria-pressed", String(document.documentElement.hasAttribute("data-wide")));
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

  press("bar-back", function () {
    send({ type: "back" });
  });
  press("bar-forward", function () {
    send({ type: "forward" });
  });
  press("bar-reload", function () {
    send({ type: "reload" });
  });
  press("bar-print", function () {
    send({ type: "print" });
  });
  press("bar-toc", toggleToc);
  press("bar-wide", toggleWide);
  press("bar-theme", toggleThemeMenu);
  press("bar-find", function () {
    if (find.hidden) openFind();
    else closeFind();
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
      else if (!themeMenu.hidden) closeThemeMenu();
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

    // The theme menu is not modal, but d under an open one would walk the
    // palettes while the menu went on ticking the entry it opened with. Its own
    // handler has already had the arrows by the time this runs.
    if (!themeMenu.hidden) return;

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

  // Before anything is on screen, so a remembered choice never shows as a flash
  // of the other palette.
  applyStoredTheme();

  // Ask for the document. Doing it this way instead of having Rust push on a
  // timer removes the race between the webview loading and the first render.
  send({ type: "ready" });
})();
