/* KeyboardWidget — an SVG piano keyboard that draws the black-key grouping,
   lights up when you play, and can be clicked when no MIDI device is around.

   Mount:
     <div data-keyboard
          data-from="48"        <!-- MIDI note of the leftmost key; must be a C -->
          data-octaves="2"      <!-- whole octaves drawn, plus a closing C -->
          data-labels="white"   <!-- none | white | all -->
          data-groups="true"    <!-- draw the 2-black / 3-black brackets -->
          data-interactive="true"></div>

   API (on the mount element, as `el.keyboard`):
     .mark(notes, cls)    add a class to those MIDI notes (array or single)
     .markPC(pc, cls)     add a class to EVERY key of that pitch class
     .clear(cls)          remove that class everywhere (omit cls to clear all marks)

   Every key carries data-note (MIDI number) and data-pc (pitch class), so a
   drill can query the widget instead of recomputing geometry. */
(function () {
  var W = 40, H = 170, BW = 24, BH = 105;
  var WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
  // A black key sits after white-key indices 0,1 (the two-group) and 3,4,5
  // (the three-group). Nothing after 2 (E) or 6 (B) — that is the whole map.
  var BLACK_AFTER = [0, 1, 3, 4, 5];
  var MARK_CLASSES = ["kbd-hi", "kbd-good", "kbd-bad"];

  var SVGNS = "http://www.w3.org/2000/svg";
  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  function build(mount) {
    var from = parseInt(mount.getAttribute("data-from") || "48", 10);
    var octaves = parseInt(mount.getAttribute("data-octaves") || "2", 10);
    var labels = mount.getAttribute("data-labels") || "none";
    var groups = mount.getAttribute("data-groups") === "true";
    var interactive = mount.getAttribute("data-interactive") === "true";

    var nWhite = octaves * 7 + 1;         // closing C so the pattern reads as complete
    var topPad = groups ? 40 : 8;
    var width = nWhite * W;
    var height = topPad + H + 10;

    mount.classList.add("kbd-box");
    var labelText = mount.getAttribute("data-title");
    if (labelText) {
      var lab = document.createElement("div");
      lab.className = "kbd-label";
      lab.textContent = labelText;
      mount.appendChild(lab);
    }

    var svg = el("svg", {
      class: "kbd-svg",
      viewBox: "0 0 " + width + " " + height,
      role: "img",
      "aria-label": "Piano keyboard, " + octaves + " octaves from C"
    });

    var byNote = {};
    var whiteLayer = el("g", {});
    var blackLayer = el("g", {});
    var textLayer = el("g", {});
    svg.appendChild(whiteLayer);
    svg.appendChild(blackLayer);

    function register(note, rect) {
      (byNote[note] = byNote[note] || []).push(rect);
      rect.setAttribute("data-note", note);
      rect.setAttribute("data-pc", ((note % 12) + 12) % 12);
      rect.setAttribute("class", rect.getAttribute("class") + (interactive ? " kbd-key" : " kbd-key-static"));
      if (interactive) {
        rect.addEventListener("pointerdown", function (e) {
          e.preventDefault();
          window.PianoMIDI.inject(note, true);
        });
        rect.addEventListener("pointerup", function () { window.PianoMIDI.inject(note, false); });
        rect.addEventListener("pointerleave", function () { window.PianoMIDI.inject(note, false); });
      }
    }

    for (var j = 0; j < nWhite; j++) {
      var oct = Math.floor(j / 7), idx = j % 7;
      var note = from + oct * 12 + WHITE_PC[idx];
      var x = j * W;
      var r = el("rect", { x: x, y: topPad, width: W, height: H, rx: 3, class: "kbd-w" });
      whiteLayer.appendChild(r);
      register(note, r);
      if (labels === "white" || labels === "all") {
        textLayer.appendChild(el("text", {
          x: x + W / 2, y: topPad + H - 14, class: "kbd-name kbd-name-w"
        })).textContent = window.PianoMIDI.SHARP_NAMES[((note % 12) + 12) % 12];
      }
    }

    for (var o = 0; o < octaves; o++) {
      for (var b = 0; b < BLACK_AFTER.length; b++) {
        var wj = o * 7 + BLACK_AFTER[b];
        var bnote = from + o * 12 + WHITE_PC[BLACK_AFTER[b]] + 1;
        var bx = (wj + 1) * W - BW / 2;
        var br = el("rect", { x: bx, y: topPad, width: BW, height: BH, rx: 2, class: "kbd-b" });
        blackLayer.appendChild(br);
        register(bnote, br);
        if (labels === "all") {
          textLayer.appendChild(el("text", {
            x: bx + BW / 2, y: topPad + BH - 10, class: "kbd-name kbd-name-b"
          })).textContent = window.PianoMIDI.SHARP_NAMES[((bnote % 12) + 12) % 12];
        }
      }
    }

    if (groups) {
      for (var g = 0; g < octaves; g++) {
        // The two-group brackets the black keys after white 0 and 1; the
        // three-group brackets those after 3, 4 and 5.
        drawBracket(g * 7 + 0, g * 7 + 1, "2");
        drawBracket(g * 7 + 3, g * 7 + 5, "3");
      }
    }

    function drawBracket(firstWhite, lastWhite, text) {
      var x1 = (firstWhite + 1) * W - BW / 2 - 4;
      var x2 = (lastWhite + 1) * W + BW / 2 + 4;
      var y = topPad - 14;
      svg.appendChild(el("path", {
        class: "kbd-group",
        d: "M" + x1 + " " + (y + 7) + " V" + y + " H" + x2 + " V" + (y + 7)
      }));
      var t = el("text", { x: (x1 + x2) / 2, y: y - 6, class: "kbd-group-txt" });
      t.textContent = text;
      svg.appendChild(t);
    }

    svg.appendChild(textLayer);
    mount.appendChild(svg);

    var caption = mount.getAttribute("data-caption");
    if (caption) {
      var cap = document.createElement("div");
      cap.className = "kbd-caption";
      cap.innerHTML = caption;
      mount.appendChild(cap);
    }

    function each(notes, fn) {
      (Array.isArray(notes) ? notes : [notes]).forEach(function (n) {
        (byNote[n] || []).forEach(fn);
      });
    }

    var api = {
      lowest: from,
      highest: from + octaves * 12,
      notes: Object.keys(byNote).map(Number),
      mark: function (notes, cls) { each(notes, function (r) { r.classList.add(cls); }); },
      unmark: function (notes, cls) { each(notes, function (r) { r.classList.remove(cls); }); },
      markPC: function (pc, cls) {
        api.notes.forEach(function (n) {
          if (((n % 12) + 12) % 12 === pc) each(n, function (r) { r.classList.add(cls); });
        });
      },
      clear: function (cls) {
        var classes = cls ? [cls] : MARK_CLASSES;
        svg.querySelectorAll("rect").forEach(function (r) {
          classes.forEach(function (c) { r.classList.remove(c); });
        });
      },
      has: function (note) { return !!byNote[note]; }
    };
    mount.keyboard = api;

    // Live feedback: any key you press lights up, hardware or click. This is
    // also the fastest way to confirm the MIDI connection actually works.
    if (mount.getAttribute("data-live") !== "false") {
      window.PianoMIDI.subscribe(function (e) {
        if (!byNote[e.note]) return;
        if (e.on) api.mark(e.note, "kbd-hi"); else api.unmark(e.note, "kbd-hi");
      });
    }
    return api;
  }

  window.KeyboardWidget = { build: build };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-keyboard]").forEach(build);
  });
})();
