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

  var BASE_FONT_SIZE = 16.5;
  var ZOOM_STEPS = [0.75, 0.85, 0.92, 1, 1.1, 1.25, 1.4, 1.6, 1.85];
  var zoom = 3;

  var tocEnabled = true;
  var spy = null;

  function send(message) {
    window.ipc.postMessage(JSON.stringify(message));
  }

  // ------------------------------------------------------------- rendering

  // Called from Rust every time the document is loaded or re-read from disk.
  window.__mark = {
    setContent: function (html, keepScroll) {
      var offset = keepScroll ? page.scrollTop : 0;
      content.innerHTML = html;
      labelCodeBlocks();
      wrapTables();
      buildToc();
      // Images and fonts settle a frame later; restoring after that keeps a
      // save from nudging the reader off the paragraph they were on.
      requestAnimationFrame(function () {
        page.scrollTop = offset;
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

  // ---------------------------------------------------------------- sidebar

  function buildToc() {
    if (spy) spy.disconnect();
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

  // Highlight the entry for whichever heading is nearest the top of the view.
  function watchHeadings(headings) {
    var visible = new Set();

    spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });

        var first = null;
        headings.forEach(function (heading) {
          if (!first && visible.has(heading.id)) first = heading.id;
        });
        if (first) markActive(first);
      },
      { root: page, rootMargin: "0px 0px -75% 0px" }
    );

    headings.forEach(function (heading) {
      spy.observe(heading);
    });
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
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // ------------------------------------------------------------------- zoom

  function setZoom(step) {
    zoom = Math.max(0, Math.min(ZOOM_STEPS.length - 1, step));
    document.documentElement.style.fontSize = BASE_FONT_SIZE * ZOOM_STEPS[zoom] + "px";
  }

  // -------------------------------------------------------------- shortcuts

  document.addEventListener("keydown", function (event) {
    var typing = document.activeElement === findInput;
    var mod = event.ctrlKey || event.metaKey;
    var key = event.key;

    if (key === "Escape") {
      event.preventDefault();
      if (!find.hidden) closeFind();
      else send({ type: "quit" });
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
    if (key === "t") {
      event.preventDefault();
      return toggleToc();
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

  // Ask for the document. Doing it this way instead of having Rust push on a
  // timer removes the race between the webview loading and the first render.
  send({ type: "ready" });
})();
