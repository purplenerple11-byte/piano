/* RhythmDrill — play a notated rhythm against a click; graded on placement.

   Every other drill in this workspace grades WHICH key. This one grades WHEN,
   and deliberately does not care which key you press — pitch is a separate
   skill and mixing the two would mean a miss could be either. On one note there
   is nothing to read, so a bad score can only mean timing.

   Mount:
     <div data-rhythmdrill
          data-rhythm="rhythm-mount-id"
          data-bpm="80"
          data-loops="2"          <!-- times through the pattern -->
          data-note="any"         <!-- "any" | a MIDI number to require -->
          data-title="…" data-caption="…"></div>

   ── Why the numbers are what they are ────────────────────────────────────
   Tolerances are in milliseconds, not fractions of a beat, because human timing
   error is roughly constant in absolute terms — playing at 60bpm does not make
   you three times more precise than at 180. ±60ms reads as "together with the
   click"; ±140ms is recognisably the right rhythm but loose. Beyond that the
   note is in the wrong place.

   The headline number is mean ABSOLUTE error (how tight) reported alongside
   mean SIGNED error (whether you rush or drag). Those are different problems
   with different fixes, and a single "accuracy %" hides both: consistently
   playing 90ms early is a metronome-relationship problem, while scattering
   ±90ms either side is a control problem. */
(function () {
  var TIGHT = 60, LOOSE = 140;

  function mean(xs) {
    if (!xs.length) return 0;
    return xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
  }

  function build(mount) {
    if (mount._unsub) { mount._unsub(); mount._unsub = null; }
    if (mount._metro) { mount._metro.stop(); }

    var rhythmEl = document.getElementById(mount.getAttribute("data-rhythm"));
    var rhythm = rhythmEl && rhythmEl.rhythm;
    if (!rhythm) { console.error("RhythmDrill: no rhythm mount for", mount); return; }

    var bpm = parseInt(mount.getAttribute("data-bpm") || "80", 10);
    var loops = parseInt(mount.getAttribute("data-loops") || "2", 10);
    var noteAttr = mount.getAttribute("data-note") || "any";
    var requiredNote = noteAttr === "any" ? null : parseInt(noteAttr, 10);

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

    // Tempo control: the same rhythm slow is a different exercise from fast, and
    // slowing down is the correct response to missing, so it must be one tap away.
    var slower = document.createElement("button");
    slower.className = "drill-btn drill-btn-ghost";
    slower.textContent = "−10";
    var tempoLabel = document.createElement("span");
    tempoLabel.className = "drill-clock";
    var faster = document.createElement("button");
    faster.className = "drill-btn drill-btn-ghost";
    faster.textContent = "+10";
    controls.appendChild(slower);
    controls.appendChild(tempoLabel);
    controls.appendChild(faster);
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

    var metro = window.RhythmWidget.metronome();
    mount._metro = metro;
    var running = false, due = [], nextIdx = 0, errors = [], hits = 0;

    function setTempo(v) {
      bpm = Math.max(40, Math.min(160, v));
      tempoLabel.textContent = bpm + " bpm";
    }
    setTempo(bpm);
    slower.onclick = function () { if (!running) setTempo(bpm - 10); };
    faster.onclick = function () { if (!running) setTempo(bpm + 10); };

    function renderStats() {
      var abs = errors.map(Math.abs);
      var tight = errors.filter(function (e) { return Math.abs(e) <= TIGHT; }).length;
      var signed = mean(errors);
      stats.innerHTML = "";
      [["Notes", hits + " / " + due.length],
       ["In time", errors.length ? Math.round(tight * 100 / errors.length) + "%" : "—"],
       ["Avg off", errors.length ? Math.round(mean(abs)) + "ms" : "—"],
       ["Tendency", errors.length < 3 ? "—"
          : Math.abs(signed) < 25 ? "even"
          : signed < 0 ? "rushing" : "dragging"]
      ].forEach(function (p) {
        var d = document.createElement("div");
        d.className = "drill-stat";
        d.innerHTML = '<span class="drill-stat-val">' + p[1] + "</span>" +
                      '<span class="drill-stat-key">' + p[0] + "</span>";
        stats.appendChild(d);
      });
    }

    /* Build the list of moments a note is due, in audioContext time. Rests are
       skipped — nothing is expected of the player there, which is the whole
       point of a rest and worth grading honestly. */
    function buildDue(beat0) {
      var spb = 60 / bpm;
      var evts = rhythm.events();
      var total = rhythm.totalBeats();
      var list = [];
      for (var L = 0; L < loops; L++) {
        evts.forEach(function (e, i) {
          if (e.rest) return;
          list.push({ t: beat0 + (L * total + e.beat) * spb, i: i, loop: L, done: false });
        });
      }
      return list;
    }

    function finish() {
      running = false;
      metro.stop();
      startBtn.textContent = "Start";
      rhythm.cursor(null);
      var abs = errors.map(Math.abs);
      var tight = errors.filter(function (e) { return Math.abs(e) <= TIGHT; }).length;
      var signed = Math.round(mean(errors));
      var pct = errors.length ? Math.round(tight * 100 / errors.length) : 0;
      var missed = due.length - hits;
      sub.className = "drill-sub";
      sub.innerHTML = "<strong>" + pct + "% in time</strong>, average " +
        Math.round(mean(abs)) + "ms off" +
        (missed > 0 ? ", " + missed + " not played" : "") + ". " +
        (pct >= 70
          ? (Math.abs(signed) < 25 ? "That is in the pocket. Nudge the tempo up."
             : signed < 0 ? "Tight, but ahead of the click — let the beat arrive."
             : "Tight, but behind the click — start the finger moving sooner.")
          : "Take it down 10bpm. Rhythm is learned slow and then sped up, never the other way.");
      renderStats();
    }

    startBtn.onclick = function () {
      if (running) { finish(); return; }
      if (!metro.available()) {
        sub.className = "drill-sub drill-sub-bad";
        sub.textContent = "This browser has no Web Audio, so there is no click to play against.";
        return;
      }
      rhythm.clear();
      errors = []; hits = 0; nextIdx = 0;
      var beat0 = metro.start({
        bpm: bpm, countIn: 4, accentEvery: 4,
        onBeat: function (b) {
          if (b < 0) {
            sub.className = "drill-sub";
            sub.textContent = "Count in… " + (4 + b + 1);
          }
        }
      });
      if (beat0 == null) return;
      due = buildDue(beat0);
      running = true;
      startBtn.textContent = "Stop";
      renderStats();

      // Drive the cursor and the end of the run off the audio clock, so the
      // display never drifts away from what the player is hearing.
      var spb = 60 / bpm;
      var endT = beat0 + rhythm.totalBeats() * loops * spb;
      var tick = setInterval(function () {
        if (!running) { clearInterval(tick); return; }
        var t = metro.now();
        if (t >= beat0 - 0.05) {
          if (sub.textContent.indexOf("Count in") === 0) {
            sub.className = "drill-sub";
            sub.textContent = "Play it.";
          }
          // Highlight whichever note is nearest ahead.
          var upcoming = due.find(function (d) { return !d.done && d.t > t - 0.12; });
          rhythm.cursor(upcoming ? upcoming.i : null);
        }
        if (t > endT + 0.4) { clearInterval(tick); finish(); }
      }, 40);
    };

    mount._unsub = window.PianoMIDI.subscribe(function (e) {
      if (!running || !e.on) return;
      if (requiredNote != null && e.note !== requiredNote) return;
      var t = metro.now();
      /* Match the press to the nearest UNCLAIMED due note. Nearest-match rather
         than next-in-order so that one fumbled note doesn't cascade and mark
         every following note wrong. */
      var best = null, bestErr = Infinity;
      due.forEach(function (d) {
        if (d.done) return;
        var err = (t - d.t) * 1000;
        if (Math.abs(err) < Math.abs(bestErr)) { best = d; bestErr = err; }
      });
      if (!best || Math.abs(bestErr) > 700) return;   // nowhere near anything
      best.done = true;
      hits++;
      errors.push(bestErr);
      var cls = Math.abs(bestErr) <= TIGHT ? "good"
              : Math.abs(bestErr) <= LOOSE ? "near" : "bad";
      rhythm.mark(best.i, cls);
      sub.className = "drill-sub " + (cls === "bad" ? "drill-sub-bad" : "drill-sub-good");
      sub.textContent = cls === "good" ? "On it"
        : (bestErr < 0 ? Math.round(-bestErr) + "ms early" : Math.round(bestErr) + "ms late");
      renderStats();
    });

    renderStats();
    sub.textContent = "Press Start. Four clicks to count you in, then play.";
  }

  window.RhythmDrill = { build: build };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-rhythmdrill]").forEach(build);
  });
})();
