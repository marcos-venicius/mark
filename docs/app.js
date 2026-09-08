/* The landing page's script. One IIFE, no framework, no build step -- the same
   shape as the app's own page script, and for the same reason: there is nothing
   here that a bundler would earn its keep on.

   Everything below is an enhancement. The page is complete without it: the
   palette follows the system through a media query, the first pane and the
   first install tab are the ones the markup already shows, and every command is
   selectable by hand. */
(function () {
  "use strict";

  /* ------------------------------------------------------------- theme */

  /* Its own key, not the app's "mark.theme": the two settings live on
     different machines as often as not, and a browser has no business
     guessing what someone chose inside the window. */
  var THEME_KEY = "mark.site.theme";
  var root = document.documentElement;
  var button = document.getElementById("theme");

  function stored() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function systemIsDark() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function isDark() {
    var choice = root.dataset.theme;
    return choice ? choice === "dark" : systemIsDark();
  }

  function describe() {
    if (!button) return;
    button.setAttribute("aria-pressed", isDark() ? "true" : "false");
    button.title = isDark() ? "Switch to light" : "Switch to dark";
  }

  if (button) {
    button.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        /* Private browsing, or storage turned off. The choice still applies to
           this page; it simply will not outlive it. */
      }
      describe();
    });
  }

  /* Nothing has been chosen here, so the system is still in charge and the
     button's label has to keep up with it while the page is open -- which is
     what the window does too. */
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    if (!stored()) describe();
  });

  describe();

  /* ------------------------------------------------- the window's panes */

  /* The file name in the mock's bar is part of the illusion: switching pane is
     the reader following a link, so the bar has to say where they landed. */
  var FILES = { doc: "README.md", diagram: "ARCHITECTURE.md", maths: "MATHS.md" };

  var paneButtons = document.querySelectorAll(".panes [data-pane]");
  var barName = document.getElementById("mock-name");

  Array.prototype.forEach.call(paneButtons, function (tab) {
    tab.addEventListener("click", function () {
      Array.prototype.forEach.call(paneButtons, function (other) {
        other.setAttribute("aria-selected", String(other === tab));
      });

      var wanted = tab.getAttribute("aria-controls");
      Array.prototype.forEach.call(document.querySelectorAll(".window-page .pane"), function (pane) {
        pane.classList.toggle("shown", pane.id === wanted);
      });

      if (barName) barName.textContent = FILES[tab.dataset.pane] || barName.textContent;

      /* And the sidebar marks the section the reader has landed in, which is
         the one thing in the window that would give the mock away if it sat
         still. The heading of the pane is what it matches on, so the two
         cannot be set to disagree. */
      var heading = document.querySelector("#" + wanted + " h3");
      Array.prototype.forEach.call(document.querySelectorAll(".window-toc a"), function (link) {
        link.classList.toggle("here", !!heading && link.textContent === heading.textContent);
      });
    });
  });

  /* ------------------------------------------------------- install tabs */

  var tabs = document.querySelectorAll(".tabs [data-tab]");

  Array.prototype.forEach.call(tabs, function (tab) {
    tab.addEventListener("click", function () {
      Array.prototype.forEach.call(tabs, function (other) {
        other.setAttribute("aria-selected", String(other === tab));
        var panel = document.getElementById(other.getAttribute("aria-controls"));
        if (panel) panel.hidden = other !== tab;
      });
    });
  });

  /* The platform the reader is on is the tab they want open. Guessed from the
     user agent, which is exactly the kind of guess a wrong answer costs one
     click to undo. */
  if (navigator.userAgent.indexOf("Windows") !== -1) {
    var windowsTab = document.querySelector('.tabs [data-tab="windows"]');
    if (windowsTab) windowsTab.click();
  }

  /* ------------------------------------------------------ copy buttons */

  function say(target, word) {
    var was = target.textContent;
    target.textContent = word;
    target.classList.add("said");
    setTimeout(function () {
      target.textContent = was;
      target.classList.remove("said");
    }, 1400);
  }

  function copy(text, target) {
    /* The clipboard API needs a secure context, which a page opened straight
       off the filesystem is not. The textarea is the fallback that has always
       worked, and it is two lines. */
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        say(target, "Copied");
      }, function () {
        say(target, "Failed");
      });
      return;
    }

    var pad = document.createElement("textarea");
    pad.value = text;
    pad.setAttribute("readonly", "");
    pad.style.position = "fixed";
    pad.style.left = "-9999px";
    document.body.appendChild(pad);
    pad.select();
    try {
      say(target, document.execCommand("copy") ? "Copied" : "Failed");
    } catch (e) {
      say(target, "Failed");
    }
    document.body.removeChild(pad);
  }

  /* A button that names what it copies, for the one in the hero. */
  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (target) {
    target.addEventListener("click", function () {
      var source = document.querySelector(target.getAttribute("data-copy"));
      if (source) copy(source.textContent.trim(), target);
    });
  });

  /* And one per shell block, added here rather than written out fourteen times
     in the markup. The prompt is dropped: nobody wants a "$ " in their
     terminal. */
  Array.prototype.forEach.call(document.querySelectorAll(".shell"), function (block) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = "Copy";
    button.setAttribute("aria-label", "Copy these commands");

    button.addEventListener("click", function () {
      var lines = block.cloneNode(true);
      Array.prototype.forEach.call(lines.querySelectorAll(".prompt, .copy-button"), function (bit) {
        bit.remove();
      });
      copy(lines.textContent.trim(), button);
    });

    block.appendChild(button);
  });
})();
