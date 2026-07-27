/* ChordDrill — a chord symbol appears; you play it.

   Mount:
     <div data-chorddrill="name"        <!-- name | progression | pattern -->
          data-kb="keyboard-id"
          data-chords="C G Am F"        <!-- pool, or the progression in order -->
          data-pattern="alberti"        <!-- pattern mode only -->
          data-rounds="8"
          data-title="…" data-caption="…"></div>

   ── What each mode measures, and why ─────────────────────────────────────
   `name` grades the SET of pitch classes, in any octave and any order. A C
   chord is a C chord wherever you play it, so demanding one exact voicing would
   be grading obedience rather than knowledge. Spread (ms between first and last
   note) is reported too, carried over from Lesson 5: three notes that arrive
   40ms apart are a chord, three notes 300ms apart are an arpeggio you did not
   mean to play.

   `progression` measures CHANGE TIME — from finishing one chord to finishing the
   next. This is the real skill and the one that decides whether you can play a
   song. Nobody is stuck because they cannot find F; they are stuck because
   getting from C to F takes a second and a half and the song does not wait.

   `pattern` is the only mode where ORDER matters, because the left-hand
   patterns are defined by their order — Alberti is lowest–highest–middle–highest
   and playing those four notes in any other sequence is a different pattern. */
(function () {
  var TOGETHER = 60, LOOSE = 150;

  function median(xs) {
    if (!xs.length) return 0;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pcOf(n) { return ((n % 12) + 12) % 12; }

  function build(mount) {
    if (mount._unsub) { mount._unsub(); mount._unsub = null; }

    var mode = mount.getAttribute("data-chorddrill") || "name";
    var syms = (mount.getAttribute("data-chords") || "C G Am F").trim().split(/\s+/);
    var rounds = parseInt(mount.getAttribute("data-rounds") || "8", 10);
    var patName = mount.getAttribute("data-pattern") || "block";
    var kbEl = document.getElementById(mount.getAttribute("data-kb"));
    var kb = kbEl && kbEl.keyboard;

    mount.classList.add("drill-box");
    mount.innerHTML = "";

    var titleText = mount.getAttribute("data-title");
    if (titleText) {
      var lab = document.createElement("div");
      lab.className = "drill-label";
      lab.textContent = titleText;
      mount.appendChild(lab);
    }

    var stage = document.createElement("div");
    stage.className = "drill-stage";
    var cue = document.createElement("span");
    cue.className = "drill-cue";
    var nextCue = document.createElement("div");
    nextCue.className = "chord-next";
    var sub = document.createElement("div");
    sub.className = "drill-sub";
    stage.appendChild(cue);
    stage.appendChild(nextCue);
    stage.appendChild(sub);
    mount.appendChild(stage);

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

    var running = false, round = 0, done = 0, correct = 0, queue = [];
    var target = null, pending = [], spreads = [], changes = [], lastDoneAt = 0;
    var strikes = [], strikeIdx = 0, hadError = false;

    function renderStats() {
      var rows;
      if (mode === "progression") {
        rows = [["Chord", round + " / " + rounds],
                ["Clean", done ? Math.round(correct * 100 / done) + "%" : "—"],
                ["Change", changes.length ? (median(changes) / 1000).toFixed(2) + "s" : "—"],
                ["Spread", spreads.length ? Math.round(median(spreads)) + "ms" : "—"]];
      } else if (mode === "pattern") {
        rows = [["Round", round + " / " + rounds],
                ["Clean", done ? Math.round(correct * 100 / done) + "%" : "—"],
                ["Pattern", (window.Chords.PATTERNS[patName] || {}).label || patName]];
      } else {
        rows = [["Round", round + " / " + rounds],
                ["Clean", done ? Math.round(correct * 100 / done) + "%" : "—"],
                ["Spread", spreads.length ? Math.round(median(spreads)) + "ms" : "—"]];
      }
      stats.innerHTML = "";
      rows.forEach(function (p) {
        var d = document.createElement("div");
        d.className = "drill-stat";
        d.innerHTML = '<span class="drill-stat-val">' + p[1] + "</span>" +
                      '<span class="drill-stat-key">' + p[0] + "</span>";
        stats.appendChild(d);
      });
    }

    function nextSymbol() {
      /* A progression is played in its written order; the other modes shuffle so
         the answer can't be predicted from position.

         `round` has already been incremented by ask() when this is called, so the
         CURRENT chord is at round-1 and `round` itself indexes the next one — which
         is exactly what the look-ahead hint wants. Getting this wrong started the
         progression on G and made the hint name the chord already on screen. */
      if (mode === "progression") return syms[(round - 1) % syms.length];
      if (!queue.length) queue = shuffle(syms);
      var s = queue.pop();
      if (s === target && queue.length) { var alt = queue.pop(); queue.push(s); s = alt; }
      return s;
    }

    function armStrike() {
      var ns = window.Chords.notes(target, 60);
      var idxs = strikes[strikeIdx] || [];
      pending = idxs.map(function (i) {
        return { pc: pcOf(ns[i]), idx: i, done: false, at: 0 };
      });
      if (kb) {
        kb.clear();
        idxs.forEach(function (i) { kb.markPC(pcOf(ns[i]), "kbd-hi"); });
      }
    }

    function ask() {
      if (round >= rounds) return finish();
      round++;
      target = nextSymbol();
      hadError = false;
      cue.className = "drill-cue";
      cue.textContent = target;
      nextCue.textContent = mode === "progression"
        ? "next: " + syms[round % syms.length] : "";
      strikes = mode === "pattern" ? window.Chords.pattern(patName) : [[0, 1, 2]];
      strikeIdx = 0;
      armStrike();
      sub.className = "drill-sub";
      sub.textContent = mode === "pattern"
        ? (window.Chords.PATTERNS[patName] || {}).blurb || ""
        : "Play it — any octave.";
      renderStats();
    }

    function completeRound() {
      var now = performance.now();
      if (mode === "progression" && lastDoneAt) changes.push(now - lastDoneAt);
      lastDoneAt = now;
      done++;
      if (!hadError) correct++;
      renderStats();
      setTimeout(function () { if (running) ask(); }, hadError ? 1200 : 550);
    }

    mount._unsub = window.PianoMIDI.subscribe(function (e) {
      if (!running || !e.on || !pending.length) return;
      /* Between two strikes of a pattern there is a short gap while the next
         strike is armed. `pending` is still the finished one, so anything played
         in that window has nothing to match and would be reported against an
         empty list ("this step wants ."). Playing Alberti at speed lands notes
         inside that gap, so swallow input here rather than emit a broken
         message. */
      if (pending.every(function (p) { return p.done; })) return;
      var want = null;
      for (var i = 0; i < pending.length; i++) {
        if (!pending[i].done && pending[i].pc === pcOf(e.note)) { want = pending[i]; break; }
      }
      if (!want) {
        var played = window.Chords.nameOfPc(pcOf(e.note));
        var chordPcs = window.Chords.pcs(target);
        var inChord = chordPcs.indexOf(pcOf(e.note)) >= 0;

        /* A note already struck in this strike is not a mistake — fingers bounce,
           and in `name` mode the same pitch class can legitimately arrive twice in
           different octaves. Ignore it rather than punishing it. */
        if (inChord && pending.some(function (p) { return p.pc === pcOf(e.note) && p.done; })) return;

        hadError = true;
        if (kb) kb.mark(e.note, "kbd-bad");
        sub.className = "drill-sub drill-sub-bad";
        if (inChord) {
          /* Right chord, wrong note FOR THIS STEP — only reachable in pattern
             mode, where order is the thing being graded. Saying "not in the
             chord" here would be flatly untrue and baffling. */
          var due = pending.filter(function (p) { return !p.done; })
                           .map(function (p) { return window.Chords.nameOfPc(p.pc); })
                           .join(" and ");
          sub.textContent = played + " is in " + target +
            ", but this step of the pattern wants " + due + ".";
        } else {
          sub.textContent = played + " is not in " + target + " — it is " +
            window.Chords.notes(target, 60)
              .map(function (n) { return window.Chords.nameOfPc(n); }).join(", ") + ".";
        }
        return;
      }
      want.done = true;
      want.at = performance.now();
      if (kb) kb.markPC(want.pc, "kbd-good");

      if (pending.some(function (p) { return !p.done; })) return;   // strike incomplete

      // Strike finished. Report spread only when it asked for more than one note.
      if (pending.length > 1) {
        var ats = pending.map(function (p) { return p.at; });
        var spread = Math.max.apply(null, ats) - Math.min.apply(null, ats);
        spreads.push(spread);
        sub.className = "drill-sub " + (spread <= LOOSE ? "drill-sub-good" : "drill-sub-bad");
        sub.textContent = spread <= TOGETHER ? "Together — " + Math.round(spread) + "ms"
          : spread <= LOOSE ? Math.round(spread) + "ms apart"
          : Math.round(spread) + "ms apart — that is an arpeggio, not a chord";
      } else {
        sub.className = "drill-sub drill-sub-good";
        sub.textContent = "✓";
      }

      strikeIdx++;
      if (strikeIdx < strikes.length) { setTimeout(armStrike, 60); return; }
      completeRound();
    });

    function finish() {
      running = false;
      startBtn.textContent = "Start";
      if (kb) kb.clear();
      cue.className = "drill-cue drill-cue-small";
      nextCue.textContent = "";
      var pct = done ? Math.round(correct * 100 / done) : 0;
      if (mode === "progression") {
        var ch = median(changes) / 1000;
        cue.textContent = pct >= 80 && ch <= 2
          ? "That is a progression you can play under a song."
          : ch > 3 ? "Slow the changes down and look ahead — read the NEXT chord while the current one is still ringing."
          : "Getting there. The change is the skill, not the chord.";
        sub.textContent = pct + "% clean, median change " + ch.toFixed(2) + "s";
      } else {
        cue.textContent = pct >= 80 ? "Solid. Take it to the progression."
                                    : "Say the notes out loud as you play them.";
        sub.textContent = pct + "% clean" +
          (spreads.length ? ", spread " + Math.round(median(spreads)) + "ms" : "");
      }
      sub.className = "drill-sub";
      renderStats();
    }

    startBtn.onclick = function () {
      if (running) { finish(); return; }
      running = true;
      startBtn.textContent = "Stop";
      round = 0; done = 0; correct = 0; spreads = []; changes = []; queue = [];
      target = null; lastDoneAt = 0;
      ask();
    };

    renderStats();
    cue.className = "drill-cue drill-cue-small";
    cue.textContent = "Press Start.";
  }

  window.ChordDrill = { build: build };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-chorddrill]").forEach(build);
  });
})();
