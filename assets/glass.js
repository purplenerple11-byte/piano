/* Makes the glass react.
   =======================
   The stylesheet can describe what a pane of glass looks like standing still.
   It cannot describe what makes it read as glass on an Apple device, which is
   that the material never stands still: the specular highlight slides along
   the rim as the pane moves through the scene, the edge flares under your
   finger, and a floating toolbar only frosts when there is something beneath
   it to frost.

   Three behaviours, all driven by two custom properties the stylesheet reads:

     --gx / --gy   where the light is landing, in the pane's own coordinates
     --gflare      how hot that highlight is, 0 to 1

   Everything else is CSS. This file only moves the light. */

(function () {
  "use strict";

  var PANES =
    ".callout,.card,.ask-agent,.quiz-box,.midi-bar,.kbd-box,.drill-box," +
    ".staff-box,.rhythm-box,.chord-box,.nav,.drill-btn,.drill-ans,.midi-btn," +
    ".quiz-choice-btn,.quiz-btn";

  // Someone who has asked for less transparency has asked for less of all of
  // this. The stylesheet already flattens the panels; don't animate them either.
  if (window.matchMedia &&
      window.matchMedia("(prefers-reduced-transparency: reduce)").matches) return;

  var reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var panes = [];
  var pending = false;
  var pointerPane = null;   // the pane currently under a finger or cursor
  var nav = null;           // the sticky toolbar, if this page has one
  var navMark = null;       // a sentinel just after it, marking the page end

  function collect() {
    panes = Array.prototype.slice.call(document.querySelectorAll(PANES));
  }

  /* ── The light ──────────────────────────────────────────────
     One fixed source, above the top of the screen and a little to the left,
     the way a window lights a desk. It does not move; the panes move past it.

     A pane reports where that light falls by pointing at it: take the vector
     from the pane's centre to the light, normalise it, and put the highlight
     out at the rim in that direction. So a card low on the screen is lit from
     above and glints along its top edge; scroll it up past the light and the
     glint travels around to the bottom. That travel is the whole effect —
     it is what a still gradient cannot fake. */

  function place() {
    pending = false;
    var vh = window.innerHeight;
    var lightX = window.innerWidth * 0.32;
    var lightY = -vh * 0.35;

    // Docked once the end of the document has come into view: at that point the
    // toolbar has stopped floating and there is nothing passing beneath it.
    if (navMark) {
      nav.setAttribute("data-docked",
        navMark.getBoundingClientRect().top <= vh ? "true" : "false");
    }

    for (var i = 0; i < panes.length; i++) {
      var el = panes[i];
      if (el === pointerPane) continue;      // the finger wins over the window

      var r = el.getBoundingClientRect();
      if (!r.height || r.bottom < -240 || r.top > vh + 240) continue;

      var dx = lightX - (r.left + r.width / 2);
      var dy = lightY - (r.top + r.height / 2);
      var len = Math.sqrt(dx * dx + dy * dy) || 1;

      // 55% rather than 50% pushes the centre of the glow just outside the
      // pane, so what lands on the rim is the falloff rather than the hotspot.
      el.style.setProperty("--gx", (50 + (dx / len) * 55).toFixed(1) + "%");
      el.style.setProperty("--gy", (50 + (dy / len) * 55).toFixed(1) + "%");
    }
  }

  function schedule() {
    if (!pending) { pending = true; requestAnimationFrame(place); }
  }

  /* ── The finger ─────────────────────────────────────────────
     Touch or hover a pane and the light stops coming from the window and
     starts coming from the contact point, hotter. Drag and it follows. This
     is the part that reads as "the material noticed me". */

  function track(e) {
    var el = e.target.closest ? e.target.closest(PANES) : null;
    if (!el) { release(); return; }

    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;

    if (pointerPane && pointerPane !== el) release();
    pointerPane = el;

    el.style.setProperty("--gx", (((e.clientX - r.left) / r.width) * 100).toFixed(1) + "%");
    el.style.setProperty("--gy", (((e.clientY - r.top) / r.height) * 100).toFixed(1) + "%");
    el.style.setProperty("--gflare", "1");
  }

  function release() {
    if (!pointerPane) return;
    pointerPane.style.removeProperty("--gflare");
    pointerPane = null;
    schedule();
  }

  /* ── The toolbar ────────────────────────────────────────────
     A floating toolbar that is frosted even when it is resting at the bottom
     of the document is not glass, it is a grey bar. It should be near-clear
     when docked with nothing behind it, and frost as content slides underneath.

     A sentinel dropped just after the toolbar marks the end of the document;
     place() checks each frame whether it has come into view. That could be an
     IntersectionObserver, but the scroll loop is already running and reading
     one more rect per frame is cheaper than a second async mechanism that
     answers the same question later. */

  function findToolbar() {
    nav = document.querySelector(".nav");
    if (!nav) return;

    navMark = document.createElement("div");
    navMark.setAttribute("aria-hidden", "true");
    navMark.style.cssText = "height:1px;margin-top:-1px;pointer-events:none";
    nav.parentNode.insertBefore(navMark, nav.nextSibling);
  }

  /* ── Wiring ─────────────────────────────────────────────────
     The drills build their own boxes and buttons after load, so the pane list
     has to be rebuilt when the DOM changes rather than captured once. */

  function start() {
    findToolbar();
    collect();
    place();

    if (!reduceMotion) {
      window.addEventListener("scroll", schedule, { passive: true });
    }
    window.addEventListener("resize", function () { collect(); schedule(); }, { passive: true });

    document.addEventListener("pointermove", track, { passive: true });
    document.addEventListener("pointerdown", track, { passive: true });
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    document.addEventListener("pointerleave", release, { passive: true });

    if (window.MutationObserver) {
      var settle;
      new MutationObserver(function () {
        clearTimeout(settle);
        settle = setTimeout(function () { collect(); place(); }, 120);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
