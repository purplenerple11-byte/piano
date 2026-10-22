/* Chords — triad theory, chord symbols, and left-hand patterns.

   The theory here is verified, not remembered:
     - A triad is three notes stacked in thirds: root, third, fifth.
       Major = 0–4–7 semitones, minor = 0–3–7.
       https://en.wikipedia.org/wiki/Triad_(music)
     - Alberti bass plays the chord in the order lowest–highest–middle–highest.
       https://en.wikipedia.org/wiki/Alberti_bass

   Mount a shape display:
     <div data-chord="Am" data-from="55" data-title="…" data-caption="…"></div>
     data-inversion="1" draws 1st inversion (2 for 2nd); default is root position.

   API:
     Chords.parse("Am")            -> { root, quality, name }
     Chords.notes("Am", nearMidi)  -> [midi, midi, midi] in root position
     Chords.notes("Am", near, 1)   -> 1st inversion, lowest first
     Chords.roles(1)               -> ["third", "fifth", "root"]
     Chords.pcs("Am")              -> [9, 0, 4]
     Chords.pattern("alberti")     -> [[0],[2],[1],[2]]  (indices into the triad)
     Chords.PROGRESSIONS.pop       -> ["C","G","Am","F"] */
(function () {
  var LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  var QUALITY = {
    maj: { steps: [0, 4, 7], suffix: "" },
    min: { steps: [0, 3, 7], suffix: "m" }
  };

  /* Chord-tone patterns for the left hand, as a list of STRIKES; each strike is
     the chord-tone indices (0 = root, 1 = third, 2 = fifth) played together.
     One representation covers both the simultaneous and the one-at-a-time
     patterns, so a drill never has to branch on which kind it is. */
  var PATTERNS = {
    block:   { strikes: [[0, 1, 2]], label: "Block", blurb: "All three at once." },
    broken:  { strikes: [[0], [1], [2]], label: "Broken", blurb: "Root, third, fifth — one at a time, upwards." },
    alberti: { strikes: [[0], [2], [1], [2]], label: "Alberti",
               blurb: "Lowest, highest, middle, highest. The Classical accompaniment engine." }
  };

  var PROGRESSIONS = {
    // The four chords of C major. Ordering varies by song; I–V–vi–IV is the one
    // documented across 300+ recordings. https://en.wikipedia.org/wiki/I%E2%80%93V%E2%80%93vi%E2%80%93IV_progression
    pop:   ["C", "G", "Am", "F"],
    order: ["C", "F", "G", "Am"]     // I–IV–V–vi, the user's own listing
  };

  function parse(sym) {
    var m = /^([A-G])([♯#b♭]?)(m?)$/.exec((sym || "").trim());
    if (!m) return null;
    var pc = LETTER_PC[m[1]];
    if (m[2] === "♯" || m[2] === "#") pc += 1;
    if (m[2] === "b" || m[2] === "♭") pc -= 1;
    pc = ((pc % 12) + 12) % 12;
    return { root: pc, quality: m[3] === "m" ? "min" : "maj", name: sym.trim() };
  }

  function pcs(sym) {
    var c = typeof sym === "string" ? parse(sym) : sym;
    if (!c) return [];
    return QUALITY[c.quality].steps.map(function (s) { return (c.root + s) % 12; });
  }

  /* Root position at or above `from`, or an inversion of it. An inversion is
     the same three notes with the bottom one moved up an octave: once gives
     1st inversion (third on the bottom), twice gives 2nd (fifth on the bottom).
     The result is always lowest-first. */
  function notes(sym, from, inversion) {
    var c = typeof sym === "string" ? parse(sym) : sym;
    if (!c) return [];
    from = from == null ? 60 : from;
    var root = from + (((c.root - from) % 12) + 12) % 12;
    var ns = QUALITY[c.quality].steps.map(function (s) { return root + s; });
    for (var i = 0; i < (inversion || 0) % 3; i++) ns.push(ns.shift() + 12);
    return ns;
  }

  var ROLES = ["root", "third", "fifth"];
  var INVERSIONS = ["root position", "1st inversion", "2nd inversion"];

  // Chord-tone role of each note in notes(sym, from, inversion), lowest first.
  function roles(inversion) {
    var r = ROLES.slice();
    for (var i = 0; i < (inversion || 0) % 3; i++) r.push(r.shift());
    return r;
  }

  function nameOfPc(pc) { return SHARP[((pc % 12) + 12) % 12]; }

  function pattern(name) { return (PATTERNS[name] || PATTERNS.block).strikes; }

  var built = 0;
  function build(mount) {
    var sym = mount.getAttribute("data-chord");
    var from = parseInt(mount.getAttribute("data-from") || "60", 10);
    var inv = parseInt(mount.getAttribute("data-inversion") || "0", 10);
    var ns = notes(sym, from, inv);
    var rs = roles(inv);
    if (!ns.length) { console.error("Chords: cannot parse", sym); return; }

    mount.classList.add("chord-box");
    var titleText = mount.getAttribute("data-title");
    if (titleText) {
      var lab = document.createElement("div");
      lab.className = "chord-label";
      lab.textContent = titleText;
      mount.appendChild(lab);
    }

    var row = document.createElement("div");
    row.className = "chord-row";

    var sigil = document.createElement("div");
    sigil.className = "chord-sigil";
    sigil.textContent = sym;
    row.appendChild(sigil);

    var spell = document.createElement("div");
    spell.className = "chord-spell";
    spell.innerHTML = ns.map(function (n, i) {
      return '<span class="chord-tone"><span class="chord-tone-name">' + nameOfPc(n) +
             '</span><span class="chord-tone-role">' +
             rs[i] + "</span></span>";
    }).join('<span class="chord-plus">+</span>');
    row.appendChild(spell);
    mount.appendChild(row);

    // The keyboard is built by KeyboardWidget so the shape is shown on the same
    // picture every other lesson uses, rather than a second kind of diagram.
    var kb = document.createElement("div");
    // A counter, because one page can draw the same chord twice.
    var id = "chordkb-" + (++built) + "-" + sym.replace(/\W/g, "");
    kb.id = id;
    kb.setAttribute("data-keyboard", "");
    kb.setAttribute("data-from", String(Math.floor((from) / 12) * 12));
    kb.setAttribute("data-octaves", "2");
    kb.setAttribute("data-labels", "white");
    kb.setAttribute("data-groups", "false");
    kb.setAttribute("data-interactive", "false");
    kb.setAttribute("data-live", "false");
    mount.appendChild(kb);
    var api = window.KeyboardWidget.build(kb);
    ns.forEach(function (n) { if (api.has(n)) api.mark(n, "kbd-hi"); });

    var capText = mount.getAttribute("data-caption");
    if (capText) {
      var cap = document.createElement("div");
      cap.className = "chord-caption";
      cap.innerHTML = capText;
      mount.appendChild(cap);
    }
    mount.chord = { notes: ns, pcs: pcs(sym) };
    return mount.chord;
  }

  window.Chords = {
    parse: parse, pcs: pcs, notes: notes, roles: roles, INVERSIONS: INVERSIONS,
    pattern: pattern, nameOfPc: nameOfPc,
    PATTERNS: PATTERNS, PROGRESSIONS: PROGRESSIONS, QUALITY: QUALITY, build: build
  };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-chord]").forEach(build);
  });
})();
