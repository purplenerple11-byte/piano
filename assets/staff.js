/* StaffWidget — a grand staff that can show a note, mark the landmarks, and be
   driven by a drill.

   Mount:
     <div data-staff
          data-clefs="both"        <!-- both | treble | bass -->
          data-title="..."
          data-caption="..."></div>

   API (on the mount element, as `el.staff`):
     .show(midiNote, clef)   draw one notehead ("treble" | "bass")
     .landmarks(on)          show/hide the three guide notes with labels
     .clear()
     .yFor(midiNote, clef)   vertical position, exposed for tests

   Positioning is diatonic, not chromatic. A staff has no idea what a black key
   is — F and F♯ occupy the same line, distinguished only by an accidental. So
   every position here is computed from a DIATONIC STEP index:

       step = octave * 7 + degree,  degree: C=0 D=1 E=2 F=3 G=4 A=5 B=6

   Middle C is step 28. Treble's bottom line (E4) is step 30; bass's bottom line
   (G2) is step 18. One diatonic step = half a line gap. That single rule places
   every note, ledger lines included, on either clef.

   Note that middle C sits in TWO different places on a grand staff — one ledger
   line below the treble, or one ledger line above the bass. Same key, same
   pitch, two spellings. That is why .show() needs to be told the clef. */
(function () {
  var SVGNS = "http://www.w3.org/2000/svg";
  var GAP = 12;                 // distance between adjacent staff lines
  var HALF = GAP / 2;           // one diatonic step
  var TREBLE_TOP = 40;          // y of the treble staff's TOP line (F5)
  var BASS_TOP = 140;           // y of the bass staff's TOP line (A3)
  var TREBLE_BOTTOM = TREBLE_TOP + 4 * GAP;   // E4
  var BASS_BOTTOM = BASS_TOP + 4 * GAP;       // G2
  var WIDTH = 560;
  var HEIGHT = 232;
  var NOTE_X = 330;

  var DEGREE = [0, null, 1, null, 2, 3, null, 4, null, 5, null, 6]; // pc -> degree
  var LETTER = ["C", "D", "E", "F", "G", "A", "B"];

  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* Diatonic step of a MIDI note. Black keys have no step of their own, so they
     borrow the step below and carry a sharp — which is exactly how notation
     treats them. */
  function stepOf(midi) {
    var pc = ((midi % 12) + 12) % 12;
    var oct = Math.floor(midi / 12) - 1;
    var deg = DEGREE[pc];
    var sharp = false;
    if (deg === null) { deg = DEGREE[pc - 1]; sharp = true; }
    return { step: oct * 7 + deg, sharp: sharp, letter: LETTER[deg], octave: oct };
  }

  function yFor(midi, clef) {
    var s = stepOf(midi).step;
    return clef === "bass"
      ? BASS_BOTTOM - (s - 18) * HALF
      : TREBLE_BOTTOM - (s - 30) * HALF;
  }

  /* The clef glyphs exist in Unicode (U+1D11E / U+1D122) and render on Apple
     platforms, but font coverage is not guaranteed everywhere. Measure once: if
     the glyph comes back the same width as an unassigned codepoint, it is tofu
     and we draw a lettered marker instead. The lesson must not depend on a font. */
  var glyphsOk = null;
  function clefGlyphsRender() {
    if (glyphsOk !== null) return glyphsOk;
    function w(ch) {
      var s = document.createElement("span");
      s.style.cssText = "position:absolute;visibility:hidden;font-size:64px;white-space:pre";
      s.textContent = ch;
      document.body.appendChild(s);
      var r = s.getBoundingClientRect().width;
      s.remove();
      return r;
    }
    var tofu = w("󰀀");
    glyphsOk = Math.abs(w("𝄞") - tofu) > 0.5 &&
               Math.abs(w("𝄢") - tofu) > 0.5;
    return glyphsOk;
  }

  function build(mount) {
    var clefs = mount.getAttribute("data-clefs") || "both";
    var showTreble = clefs === "both" || clefs === "treble";
    var showBass = clefs === "both" || clefs === "bass";

    mount.classList.add("staff-box");
    var titleText = mount.getAttribute("data-title");
    if (titleText) {
      var lab = document.createElement("div");
      lab.className = "staff-label";
      lab.textContent = titleText;
      mount.appendChild(lab);
    }

    var svg = el("svg", {
      class: "staff-svg", viewBox: "0 0 " + WIDTH + " " + HEIGHT,
      role: "img", "aria-label": "Grand staff"
    });

    function staffLines(top) {
      for (var i = 0; i < 5; i++) {
        svg.appendChild(el("line", {
          class: "staff-line", x1: 46, x2: WIDTH - 20,
          y1: top + i * GAP, y2: top + i * GAP
        }));
      }
    }
    if (showTreble) staffLines(TREBLE_TOP);
    if (showBass) staffLines(BASS_TOP);

    // Left-hand brace and the barline joining the two staves.
    if (showTreble && showBass) {
      svg.appendChild(el("line", {
        class: "staff-brace", x1: 46, x2: 46, y1: TREBLE_TOP, y2: BASS_BOTTOM
      }));
    }

    function addClef(kind, top) {
      if (clefGlyphsRender()) {
        /* Fit the glyph by MEASUREMENT, not by magic numbers. Whichever font
           supplies U+1D11E / U+1D122 differs between macOS, iPadOS and anything
           else, and each has its own glyph metrics — a hardcoded font-size and
           baseline that looks right here would sit crooked on the iPad, which is
           the device this course is actually used on.

           So: render once, measure the box, scale it to the span a clef should
           occupy, then shift it so its top lands on the intended staff line. */
        var t = el("text", { class: "staff-clef", x: 56, y: top, "font-size": 60 });
        t.textContent = kind === "treble" ? "𝄞" : "𝄢";
        svg.appendChild(t);
        // Deferred: getBBox only returns real numbers once the <svg> is in the
        // document, and that happens further down. Queued here, fitted there.
        pendingClefs.push({ node: t, kind: kind, top: top });
      } else {
        var g = el("text", {
          class: "staff-clef-fallback", x: 60,
          y: (kind === "treble" ? top + 3 * GAP : top + 1 * GAP) + 5
        });
        g.textContent = kind === "treble" ? "G" : "F";
        svg.appendChild(g);
      }
    }
    var pendingClefs = [];
    if (showTreble) addClef("treble", TREBLE_TOP);
    if (showBass) addClef("bass", BASS_TOP);

    var noteLayer = el("g", {});
    var markLayer = el("g", {});
    svg.appendChild(markLayer);
    svg.appendChild(noteLayer);
    mount.appendChild(svg);

    /* Fit the clef glyphs by MEASUREMENT, not by magic numbers. Whichever font
       supplies U+1D11E / U+1D122 differs between macOS, iPadOS and anything
       else, and each has its own metrics — a hardcoded font-size and baseline
       that looks right on this machine would sit crooked on the iPad, which is
       the device this course is actually used on. Scale to the span a clef
       should occupy, then shift so its top lands on the intended line. */
    pendingClefs.forEach(function (c) {
      var target = c.kind === "treble"
        ? { top: c.top - 1.2 * GAP, height: 6.8 * GAP }  // spills above and below
        : { top: c.top,             height: 3.0 * GAP }; // sits inside the staff
      var b = c.node.getBBox();
      if (!b.height) return;                             // glyph missing; leave as-is
      c.node.setAttribute("font-size", 60 * (target.height / b.height));
      b = c.node.getBBox();
      c.node.setAttribute("y", c.top + (target.top - b.y));
    });

    var captionText = mount.getAttribute("data-caption");
    if (captionText) {
      var cap = document.createElement("div");
      cap.className = "staff-caption";
      cap.innerHTML = captionText;
      mount.appendChild(cap);
    }

    /* Ledger lines: short strokes continuing the staff for notes outside it.
       Drawn on every OTHER diatonic step (i.e. each full line position) between
       the staff edge and the note. */
    function ledgers(layer, midi, clef, x) {
      var s = stepOf(midi).step;
      var bottomStep = clef === "bass" ? 18 : 30;
      var topStep = bottomStep + 8;
      var y;
      if (s < bottomStep) {
        for (var st = bottomStep - 2; st >= s; st -= 2) {
          y = clef === "bass" ? BASS_BOTTOM - (st - 18) * HALF
                              : TREBLE_BOTTOM - (st - 30) * HALF;
          layer.appendChild(el("line", { class: "staff-line staff-ledger",
            x1: x - 15, x2: x + 15, y1: y, y2: y }));
        }
      } else if (s > topStep) {
        for (var st2 = topStep + 2; st2 <= s; st2 += 2) {
          y = clef === "bass" ? BASS_BOTTOM - (st2 - 18) * HALF
                              : TREBLE_BOTTOM - (st2 - 30) * HALF;
          layer.appendChild(el("line", { class: "staff-line staff-ledger",
            x1: x - 15, x2: x + 15, y1: y, y2: y }));
        }
      }
    }

    function drawNote(layer, midi, clef, x, cls, label) {
      var y = yFor(midi, clef);
      var info = stepOf(midi);
      ledgers(layer, midi, clef, x);
      var head = el("ellipse", {
        class: "staff-note " + (cls || ""), cx: x, cy: y, rx: 7.6, ry: 5.6,
        transform: "rotate(-18 " + x + " " + y + ")"
      });
      layer.appendChild(head);
      if (info.sharp) {
        var acc = el("text", { class: "staff-acc", x: x - 16, y: y + 5 });
        acc.textContent = "♯";
        layer.appendChild(acc);
      }
      if (label) {
        var t = el("text", { class: "staff-notelabel", x: x, y: y - 14 });
        t.textContent = label;
        layer.appendChild(t);
      }
      return y;
    }

    var api = {
      yFor: yFor,
      stepOf: stepOf,
      show: function (midi, clef, cls) {
        noteLayer.innerHTML = "";
        return drawNote(noteLayer, midi, clef || "treble", NOTE_X, cls || "");
      },
      clear: function () { noteLayer.innerHTML = ""; },
      /* The three guide notes every method starts with: Treble G, Middle C,
         Bass F. Everything else is read as a distance from one of these. */
      landmarks: function (on) {
        markLayer.innerHTML = "";
        if (!on) return;
        if (showTreble) {
          drawNote(markLayer, 67, "treble", 150, "staff-note-mark", "Treble G");
          drawNote(markLayer, 60, "treble", 250, "staff-note-mark", "Middle C");
        }
        if (showBass) {
          drawNote(markLayer, 53, "bass", 150, "staff-note-mark", "Bass F");
          if (!showTreble) drawNote(markLayer, 60, "bass", 250, "staff-note-mark", "Middle C");
        }
      }
    };
    mount.staff = api;
    if (mount.getAttribute("data-landmarks") === "true") api.landmarks(true);
    return api;
  }

  window.StaffWidget = { build: build, yFor: yFor, stepOf: stepOf };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-staff]").forEach(build);
  });
})();
