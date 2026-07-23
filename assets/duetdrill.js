/* DuetDrill — reading with both hands.

   Mount:
     <div data-duetdrill
          data-staff="grand-staff-id"
          data-mode="alternate"     <!-- alternate | together -->
          data-events="8"
          data-title="…" data-caption="…"></div>

   ── What is actually being measured ──────────────────────────────────────
   Playing hands together is not two skills running in parallel; the hard part is
   that the two hands must agree on a single moment. So the headline number here
   is **hand spread**: how many milliseconds apart the two hands land when a
   column asks for both. Accuracy alone would hide it completely — you can play
   every note correctly and still sound like two people.

   Under ~50ms reads as one event to a listener. Above ~120ms it is audibly a
   flam, and the fix is not "try harder" but slowing down until the two hands
   arrive together, then speeding up.

   In `alternate` mode the hands take turns and only one note is due per column,
   so there is no spread to report — the stat shows "—". That is the point of
   having both modes: alternating is the easier shape (and the one the opening of
   Für Elise actually uses), and it is worth being able to see that it asks
   something different from true simultaneity.

   A column is satisfied when every note it wants has been played, in ANY order.
   Requiring an order would be measuring obedience, not coordination. */
(function () {
  var TOGETHER = 50, LOOSE = 120;

  // Diatonic step -> MIDI, sharing the convention in staffdrill.js: step =
  // octave*7 + degree, so C4 = 28. Kept local; the two drills are independent.
  var WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
  function stepToMidi(s) {
    var oct = Math.floor(s / 7), deg = s - oct * 7;
    return (oct + 1) * 12 + WHITE_PC[deg];
  }

  function median(xs) {
    if (!xs.length) return 0;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* Right hand sits around Middle C to Treble G, left hand around Bass F —
     the landmarks from lesson 2, so nothing here is a new position to find. */
  var RH = { lo: 28, hi: 32, start: [28, 32] };   // C4..G4
  var LH = { lo: 21, hi: 25, start: [21, 24] };   // F3..C4 region in bass

  function walk(cfg, from) {
    var opts = [-1, 1].filter(function (d) {
      var nx = from + d; return nx >= cfg.lo && nx <= cfg.hi;
    });
    return from + (opts.length ? pick(opts) : 0);
  }

  function generate(mode, count) {
    var r = pick(RH.start), l = pick(LH.start);
    var evts = [];
    if (mode === "together") {
      for (var i = 0; i < count; i++) {
        evts.push({ treble: stepToMidi(r), bass: stepToMidi(l) });
        r = walk(RH, r); l = walk(LH, l);
      }
    } else {
      /* Alternate in short runs rather than strictly every other note: real
         music hands off in phrases, and a rigid R-L-R-L becomes a pattern you
         can play without reading. */
      var hand = Math.random() < 0.5 ? "treble" : "bass";
      var left = count;
      while (left > 0) {
        var run = Math.min(left, 1 + Math.floor(Math.random() * 2) + 1);  // 2–3
        for (var k = 0; k < run; k++) {
          if (hand === "treble") { evts.push({ treble: stepToMidi(r), bass: null }); r = walk(RH, r); }
          else { evts.push({ treble: null, bass: stepToMidi(l) }); l = walk(LH, l); }
        }
        left -= run;
        hand = hand === "treble" ? "bass" : "treble";
      }
    }
    return evts;
  }

  function build(mount) {
    if (mount._unsub) { mount._unsub(); mount._unsub = null; }

    var staffEl = document.getElementById(mount.getAttribute("data-staff"));
    var staff = staffEl && staffEl.staff;
    if (!staff) { console.error("DuetDrill: no staff for", mount); return; }

    var mode = mount.getAttribute("data-mode") || "alternate";
    var count = parseInt(mount.getAttribute("data-events") || "8", 10);

    mount.classList.add("drill-box");
    mount.innerHTML = "";

    var titleText = mount.getAttribute("data-title");
    if (titleText) {
      var lab = document.createElement("div");
      lab.className = "drill-label";
      lab.textContent = titleText;
      mount.appendChild(lab);
    }

    var sub = document.createElement("div");
    sub.className = "drill-sub";
    sub.style.textAlign = "center";
    sub.style.minHeight = "1.4rem";
    mount.appendChild(sub);

    var controls = document.createElement("div");
    controls.className = "drill-controls";
    var startBtn = document.createElement("button");
    startBtn.className = "drill-btn";
    startBtn.textContent = "Start";
    controls.appendChild(startBtn);
    mount.appendChild(controls);

    var stats = document.createElement("div");
    stats.className = "drill-stats";
    mount.appendChild(stats);

    var capText = mount.getAttribute("data-caption");
    if (capText) {
      var cap = document.createElement("div");
      cap.className = "drill-caption";
      cap.innerHTML = capText;
      mount.appendChild(cap);
    }

    var running = false, line = null, pos = 0, pending = [], firstAt = 0;
    var spreads = [], cleanCols = 0, doneCols = 0, hadErrorHere = false;
    var lines = 0, cleanLines = 0, lineStart = 0, lineTimes = [], lineHadError = false;

    function renderStats() {
      var sp = median(spreads);
      stats.innerHTML = "";
      [["Lines", lines + ""],
       ["Clean notes", doneCols ? Math.round(cleanCols * 100 / doneCols) + "%" : "—"],
       ["Hand spread", spreads.length ? Math.round(sp) + "ms" : "—"],
       ["Line time", lineTimes.length ? (median(lineTimes) / 1000).toFixed(1) + "s" : "—"]
      ].forEach(function (p) {
        var d = document.createElement("div");
        d.className = "drill-stat";
        d.innerHTML = '<span class="drill-stat-val">' + p[1] + "</span>" +
                      '<span class="drill-stat-key">' + p[0] + "</span>";
        stats.appendChild(d);
      });
    }

    function armColumn() {
      pending = line.notesAt(pos).map(function (nt) {
        return { hand: nt.hand, midi: nt.midi, done: false, at: 0 };
      });
      firstAt = 0;
      hadErrorHere = false;
      line.cursor(pos);
    }

    function newLine() {
      line = staff.duet(generate(mode, count));
      pos = 0;
      lineHadError = false;
      lineStart = performance.now();
      armColumn();
      sub.className = "drill-sub";
      sub.textContent = mode === "together"
        ? "Both hands, together, left to right."
        : "Play it left to right — watch which staff the note is on.";
    }

    function finishLine() {
      var ms = performance.now() - lineStart;
      lineTimes.push(ms);
      lines++;
      if (!lineHadError) cleanLines++;
      line.cursor(null);
      var sp = median(spreads);
      sub.className = lineHadError ? "drill-sub" : "drill-sub drill-sub-good";
      sub.textContent = (lineHadError ? "Line done — " : "Clean — ") +
        (ms / 1000).toFixed(1) + "s" +
        (spreads.length ? ", hands " + Math.round(sp) + "ms apart" : "");
      renderStats();
      setTimeout(function () { if (running) newLine(); }, 1100);
    }

    mount._unsub = window.PianoMIDI.subscribe(function (e) {
      if (!running || !e.on || !pending.length) return;
      var want = null;
      for (var i = 0; i < pending.length; i++) {
        if (!pending[i].done && pending[i].midi === e.note) { want = pending[i]; break; }
      }
      if (!want) {
        // Wrong note: flag the column, but do NOT advance. The line is a line;
        // dead-ending on a slip would teach nothing except frustration.
        hadErrorHere = true;
        lineHadError = true;
        line.markAll(pos, "staff-note-bad");
        sub.className = "drill-sub drill-sub-bad";
        sub.textContent = "Not that one — the column wants " +
          pending.filter(function (p) { return !p.done; })
                 .map(function (p) { return p.hand === "treble" ? "a right-hand note" : "a left-hand note"; })
                 .join(" and ") + ".";
        return;
      }

      want.done = true;
      want.at = performance.now();
      if (!firstAt) firstAt = want.at;
      line.mark(pos, want.hand, "staff-note-good");

      var left = pending.filter(function (p) { return !p.done; });
      if (left.length) {
        // Half of a two-hand column: say so, and keep the cursor put.
        sub.className = "drill-sub";
        sub.textContent = want.hand === "treble" ? "Right hand down — now the left."
                                                 : "Left hand down — now the right.";
        return;
      }

      doneCols++;
      if (!hadErrorHere) cleanCols++;
      if (pending.length > 1) {
        var spread = Math.max.apply(null, pending.map(function (p) { return p.at; })) -
                     Math.min.apply(null, pending.map(function (p) { return p.at; }));
        spreads.push(spread);
        sub.className = "drill-sub " + (spread <= LOOSE ? "drill-sub-good" : "drill-sub-bad");
        sub.textContent = spread <= TOGETHER ? "Together — " + Math.round(spread) + "ms"
          : spread <= LOOSE ? Math.round(spread) + "ms apart — close"
          : Math.round(spread) + "ms apart — that is an audible flam";
      }
      pos++;
      renderStats();
      if (pos >= line.length) { finishLine(); return; }
      armColumn();
    });

    startBtn.onclick = function () {
      if (running) {
        running = false;
        startBtn.textContent = "Start";
        if (line) line.cursor(null);
        return;
      }
      running = true;
      startBtn.textContent = "Stop";
      spreads = []; cleanCols = 0; doneCols = 0;
      lines = 0; cleanLines = 0; lineTimes = [];
      newLine();
      renderStats();
    };

    renderStats();
    sub.textContent = "Press Start.";
  }

  window.DuetDrill = { build: build, generate: generate };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-duetdrill]").forEach(build);
  });
})();
