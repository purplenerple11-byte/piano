/* StaffDrill — the sight-reading feedback loop: a symbol appears, you PLAY it,
   graded instantly against what your hands actually did.

   Two modes share this file:

     SINGLE (Lesson 2) — one notehead at a time. data-pool = "landmarks" | "steps".
       The skill is symbol→key for isolated notes; octave counts, so right-letter
       wrong-octave is called out as its own kind of miss.

     PHRASE (Lesson 3) — a whole LINE of notes; you play it left to right.
       data-pool = "treble-steps" | "treble-skips" | "bass-steps" | "bass-skips".
       The skill is different in kind: you stop reading each note from a landmark
       and start reading each note as a step or a skip from the one before it. The
       drill generates lines procedurally (a bounded random walk by step/skip),
       tracks a cursor through the line, and grades note by note.

   Either mode can also run as a SPRINT: a per-drill countdown (default 60s). The
   fixed-rounds run measures how well you read; the sprint measures how fast, by
   throughput — the whole course is about automaticity, and a clock is the missing
   pressure. It's a toggle on every drill, so you can warm up untimed and then
   race. The buzzer stops the drill wherever it is; a half-finished item just
   doesn't count.

   Mount:
     <div data-staffdrill
          data-staff="staff-id"    <!-- a [data-staff] mount -->
          data-kb="kb-id"          <!-- a [data-keyboard] mount, for feedback -->
          data-pool="treble-steps"
          data-rounds="8"
          data-length="5"          <!-- notes per line, phrase mode only -->
          data-seconds="60"></div>  <!-- sprint length when timed -->

   Timing and stats mirror keydrill.js (median, not mean). The sprint timer and
   toggle already live in drillcore.js, shared with keydrill; the per-drill
   scaffold/stats/median are still duplicated, and that's the next thing to move
   into DrillCore if these files grow again. */
(function () {
  var POOLS = {
    // [midi, clef] — the three guide notes every method starts from.
    landmarks: [[67, "treble"], [60, "treble"], [53, "bass"]],
    // …plus one diatonic step either side, which is where interval reading starts.
    steps: [[67, "treble"], [60, "treble"], [53, "bass"],
            [65, "treble"], [69, "treble"], [62, "treble"],
            [52, "bass"], [55, "bass"]]
  };

  /* Phrase generators. A "step" here is a diatonic step (see staff.js): the next
     LETTER, on the next line/space. moves are those deltas — [-1,1] is steps only,
     adding [-2,2] mixes in skips. lo/hi bound the walk so nothing runs off into
     ledger-line territory; starts are the landmarks a line begins from. All white
     keys — accidentals are a later lesson, and mixing them in here would test two
     things at once. */
  var PHRASE_POOLS = {
    "treble-steps": { clef: "treble", moves: [-1, 1],        lo: 28, hi: 35, starts: [28, 32], len: 5 },
    "treble-skips": { clef: "treble", moves: [-2, -1, 1, 2], lo: 28, hi: 35, starts: [28, 32], len: 5 },
    "bass-steps":   { clef: "bass",   moves: [-1, 1],        lo: 21, hi: 28, starts: [24, 28], len: 5 },
    "bass-skips":   { clef: "bass",   moves: [-2, -1, 1, 2], lo: 21, hi: 28, starts: [24, 28], len: 5 }
  };

  var WHITE_PC = [0, 2, 4, 5, 7, 9, 11];   // diatonic degree -> pitch class
  function stepToMidi(s) {
    var oct = Math.floor(s / 7);
    return (oct + 1) * 12 + WHITE_PC[s - oct * 7];
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function median(xs) {
    if (!xs.length) return 0;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function nameOf(midi) {
    var info = window.StaffWidget.stepOf(midi);
    return info.letter + (info.sharp ? "♯" : "") + info.octave;
  }

  function samePC(a, b) { return (((a % 12) + 12) % 12) === (((b % 12) + 12) % 12); }

  /* Build a line by walking from a landmark. A mild bias toward continuing in the
     same direction gives the line a shape you can feel under the hand, rather than
     the aimless back-and-forth a pure random walk produces — but reversals still
     happen, because reading only one contour would teach only half the skill. */
  function genPhrase(cfg) {
    var s = cfg.starts[Math.floor(Math.random() * cfg.starts.length)];
    var seq = [s], dir = 0;
    for (var i = 1; i < cfg.len; i++) {
      var opts = cfg.moves.filter(function (d) {
        var nx = s + d; return nx >= cfg.lo && nx <= cfg.hi;
      });
      if (!opts.length) break;
      var same = opts.filter(function (d) { return dir === 0 || (d > 0) === (dir > 0); });
      var pick = (same.length && Math.random() < 0.62)
        ? same[Math.floor(Math.random() * same.length)]
        : opts[Math.floor(Math.random() * opts.length)];
      s += pick; dir = pick; seq.push(s);
    }
    return seq.map(function (st) { return { midi: stepToMidi(st), clef: cfg.clef }; });
  }

  /* Shared DOM scaffold: label, live status line, Start + sprint-toggle buttons,
     a countdown clock, stat row, caption. Both modes render identically; only the
     stats they push and the grading underneath differ. */
  function scaffold(mount) {
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
    var sprintBtn = document.createElement("button");
    sprintBtn.className = "drill-btn drill-btn-ghost";
    controls.appendChild(sprintBtn);
    var clock = document.createElement("span");
    clock.className = "drill-clock";
    clock.style.display = "none";
    controls.appendChild(clock);
    mount.appendChild(controls);

    var stats = document.createElement("div");
    stats.className = "drill-stats";
    mount.appendChild(stats);

    var captionText = mount.getAttribute("data-caption");
    if (captionText) {
      var cap = document.createElement("div");
      cap.className = "drill-caption";
      cap.innerHTML = captionText;
      mount.appendChild(cap);
    }
    return { sub: sub, startBtn: startBtn, sprintBtn: sprintBtn, clock: clock, stats: stats };
  }

  function renderStatPairs(stats, pairs) {
    stats.innerHTML = "";
    pairs.forEach(function (p) {
      var d = document.createElement("div");
      d.className = "drill-stat";
      d.innerHTML = '<span class="drill-stat-val">' + p[1] + "</span>" +
                    '<span class="drill-stat-key">' + p[0] + "</span>";
      stats.appendChild(d);
    });
  }

  function refs(mount) {
    var staffEl = document.getElementById(mount.getAttribute("data-staff"));
    var kbEl = document.getElementById(mount.getAttribute("data-kb"));
    return { staff: staffEl && staffEl.staff, kb: kbEl && kbEl.keyboard };
  }

  function seconds(mount) {
    return Math.max(10, parseInt(mount.getAttribute("data-seconds") || "60", 10));
  }

  // The sprint toggle + countdown live in DrillCore (shared with keydrill). Each
  // mode passes its toggle button and clock, and wires its own onToggle/onExpire.
  function sprintFor(ui, secs, isRunning, onToggle, onExpire) {
    return window.DrillCore.sprintControls(
      { sprintBtn: ui.sprintBtn, clock: ui.clock }, secs, isRunning, onToggle, onExpire);
  }

  /* ── SINGLE-NOTE MODE (Lesson 2) ─────────────────────────── */
  function buildSingle(mount, pool) {
    var r = refs(mount);
    var staff = r.staff, kb = r.kb;
    if (!staff) { console.error("StaffDrill: no staff for", mount); return; }
    var rounds = parseInt(mount.getAttribute("data-rounds") || "10", 10);
    var secs = seconds(mount);

    var ui = scaffold(mount);
    var sub = ui.sub, stats = ui.stats;

    var running = false, locked = true, round = 0, correct = 0;
    var times = [], streak = 0, best = 0, queue = [], target = null, askedAt = 0;

    var sc = sprintFor(ui, secs, function () { return running; },
      function (sprint) {
        resetState(); renderStats();
        sub.className = "drill-sub";
        sub.textContent = sprint
          ? "Sprint — name as many as you can in " + secs + "s. Press Start."
          : "Press Start. A note appears — play it.";
      },
      function () { if (running) finish(); });

    function resetState() {
      round = 0; correct = 0; times = []; streak = 0; best = 0; queue = []; target = null;
    }

    function renderStats() {
      var perMin = times.length ? Math.round(correct * 60 / secs) : 0;
      renderStatPairs(stats, sc.isSprint()
        ? [["Correct", correct + ""],
           ["Per min", correct ? perMin + "" : "—"],
           ["Median", times.length ? (median(times) / 1000).toFixed(2) + "s" : "—"],
           ["Best streak", best + ""]]
        : [["Round", round + " / " + rounds],
           ["Correct", correct + ""],
           ["Median", times.length ? (median(times) / 1000).toFixed(2) + "s" : "—"],
           ["Best streak", best + ""]]);
    }

    function next() {
      if (!queue.length) queue = shuffle(pool);
      var item = queue.pop();
      if (target && item[0] === target[0] && queue.length) {
        var alt = queue.pop(); queue.push(item); item = alt;
      }
      return item;
    }

    function ask() {
      if (!running) return;
      if (kb) kb.clear();
      sub.className = "drill-sub";
      sub.textContent = "Play it.";
      if (!sc.isSprint() && round >= rounds) return finish();
      round++;
      target = next();
      staff.show(target[0], target[1]);
      renderStats();
      locked = false;
      askedAt = performance.now();
    }

    function score(ok, ms) {
      if (ok) { correct++; times.push(ms); streak++; if (streak > best) best = streak; }
      else streak = 0;
      renderStats();
      setTimeout(ask, ok ? 750 : 2100);
    }

    mount._unsub = window.PianoMIDI.subscribe(function (e) {
      if (!running || locked || !e.on) return;
      locked = true;
      var ms = performance.now() - askedAt;
      var want = target[0];
      var ok = e.note === want;
      var rightLetter = samePC(e.note, want);

      staff.show(want, target[1], ok ? "staff-note-good" : "staff-note-bad");
      if (kb) { if (!ok) kb.mark(e.note, "kbd-bad"); kb.mark(want, "kbd-good"); }
      if (ok) {
        sub.className = "drill-sub drill-sub-good";
        sub.textContent = nameOf(want) + " — " + (ms / 1000).toFixed(2) + "s";
      } else {
        sub.className = "drill-sub drill-sub-bad";
        sub.textContent = rightLetter
          ? "Right letter, wrong octave. That was " + nameOf(e.note) +
            "; the staff says " + nameOf(want) + "."
          : "That was " + nameOf(e.note) + ". The staff says " + nameOf(want) + ".";
      }
      score(ok, ms);
    });

    function finish() {
      if (!running) return;
      running = false; locked = true;
      sc.stopClock();
      staff.clear();
      if (kb) kb.clear();
      var med = median(times);
      sub.className = "drill-sub";
      if (sc.isSprint()) {
        sub.innerHTML = "<strong>" + correct + " correct</strong> in " + secs + "s — " +
          Math.round(correct * 60 / secs) + "/min, median " +
          (times.length ? (med / 1000).toFixed(2) + "s" : "—") + ". " +
          (correct === 0 ? "Start with accuracy; speed follows." : "Next run, beat that number.");
      } else {
        sub.innerHTML = "<strong>" + correct + " of " + rounds + "</strong>, median " +
          (times.length ? (med / 1000).toFixed(2) + "s" : "—") + ". " +
          (correct < rounds * 0.8
            ? "Accuracy first. Find the landmark, then step from it."
            : med <= 2000
              ? "That is reading, not working it out. Keep it warm."
              : "Accurate. Now stop counting up from the bottom line — jump to the nearest landmark first.");
      }
      renderStats();
    }

    ui.startBtn.onclick = function () {
      sc.stopClock();
      running = true; resetState();
      ui.startBtn.textContent = "Restart";
      sc.startClock();
      mount._timer = sc.timer();   // so a rebuild can stop a live clock
      ask();
    };

    renderStats();
    sub.textContent = "Press Start. A note appears — play it.";
  }

  /* ── PHRASE MODE (Lesson 3) ──────────────────────────────── */
  function buildPhrase(mount, poolName) {
    var r = refs(mount);
    var staff = r.staff, kb = r.kb;
    if (!staff) { console.error("StaffDrill: no staff for", mount); return; }

    var cfg = {}, base = PHRASE_POOLS[poolName];
    for (var k in base) cfg[k] = base[k];
    var lenAttr = parseInt(mount.getAttribute("data-length") || "", 10);
    if (lenAttr) cfg.len = lenAttr;
    var rounds = parseInt(mount.getAttribute("data-rounds") || "8", 10);
    var secs = seconds(mount);

    var ui = scaffold(mount);
    var sub = ui.sub, stats = ui.stats;

    var running = false, locked = true, round = 0;
    var phrase = null, pos = 0, missesHere = 0, phraseHadError = false, phraseStart = 0;
    var times = [], cleanPhrases = 0, streak = 0, best = 0;
    var totalNotes = 0, cleanNotes = 0;

    var sc = sprintFor(ui, secs, function () { return running; },
      function (sprint) {
        resetState(); renderStats();
        sub.className = "drill-sub";
        sub.textContent = sprint
          ? "Sprint — read as many lines as you can in " + secs + "s. Press Start."
          : "Press Start. A line of notes appears — play it left to right.";
      },
      function () { if (running) finish(); });

    function resetState() {
      round = 0; times = []; cleanPhrases = 0; streak = 0; best = 0;
      totalNotes = 0; cleanNotes = 0; phraseHadError = false;
    }

    function renderStats() {
      var acc = totalNotes ? Math.round(cleanNotes / totalNotes * 100) + "%" : "—";
      renderStatPairs(stats, [
        sc.isSprint() ? ["Lines", times.length + ""] : ["Line", round + " / " + rounds],
        ["Notes right", acc],
        ["Median / line", times.length ? (median(times) / 1000).toFixed(2) + "s" : "—"],
        ["Clean streak", best + ""]
      ]);
    }

    function ask() {
      if (!running) return;
      if (kb) kb.clear();
      if (!sc.isSprint() && round >= rounds) return finish();
      round++;
      phrase = staff.phrase(genPhrase(cfg));
      pos = 0; missesHere = 0; phraseHadError = false;
      phrase.cursor(0);
      sub.className = "drill-sub";
      sub.textContent = "Play the line, left to right.";
      renderStats();
      locked = false;
      phraseStart = performance.now();
    }

    function finishPhrase() {
      locked = true;
      phrase.cursor(null);
      var ms = performance.now() - phraseStart;
      times.push(ms);
      if (!phraseHadError) { cleanPhrases++; streak++; if (streak > best) best = streak; }
      else streak = 0;
      sub.className = phraseHadError ? "drill-sub" : "drill-sub drill-sub-good";
      sub.textContent = phraseHadError
        ? "Line done — " + (ms / 1000).toFixed(2) + "s, with slips."
        : "Clean — " + (ms / 1000).toFixed(2) + "s.";
      renderStats();
      setTimeout(ask, 950);
    }

    mount._unsub = window.PianoMIDI.subscribe(function (e) {
      if (!running || locked || !e.on) return;
      var want = phrase.midiAt(pos);
      if (e.note === want) {
        phrase.mark(pos, "staff-note-good");
        if (kb) { kb.clear("kbd-bad"); kb.clear("kbd-good"); kb.mark(want, "kbd-good"); }
        totalNotes++;
        if (missesHere === 0) cleanNotes++;
        pos++; missesHere = 0;
        if (pos >= phrase.length) { finishPhrase(); return; }
        phrase.cursor(pos);
        // Recover the neutral prompt if the last note was a slip.
        if (sub.className.indexOf("bad") >= 0) {
          sub.className = "drill-sub";
          sub.textContent = "Play the line, left to right.";
        }
        renderStats();
      } else {
        phraseHadError = true;
        missesHere++;
        streak = 0;
        if (kb) kb.mark(e.note, "kbd-bad");
        sub.className = "drill-sub drill-sub-bad";
        sub.textContent = samePC(e.note, want)
          ? "Right letter, wrong octave — " + nameOf(e.note) +
            " names it but at the wrong end. Play the one on the staff."
          : "Not it — that was " + nameOf(e.note) +
            ". Read it as a step or skip from the note before, and try again.";
        // Stuck twice on the same note: reveal the key so a line never dead-ends.
        if (missesHere >= 2 && kb) kb.mark(want, "kbd-good");
        renderStats();
      }
    });

    function finish() {
      if (!running) return;
      running = false; locked = true;
      sc.stopClock();
      staff.clear();
      if (kb) kb.clear();
      var med = median(times);
      var acc = totalNotes ? cleanNotes / totalNotes : 0;
      sub.className = "drill-sub";
      if (sc.isSprint()) {
        sub.innerHTML = "<strong>" + times.length + " lines</strong> in " + secs + "s — " +
          Math.round(times.length * 60 / secs) + "/min, " + Math.round(acc * 100) +
          "% of notes right first time" + (cleanPhrases ? ", " + cleanPhrases + " clean" : "") + ". " +
          (times.length === 0 ? "Accuracy first; the pace comes after." : "Next run, beat that.");
      } else {
        sub.innerHTML = "<strong>" + cleanPhrases + " of " + rounds + "</strong> lines clean, " +
          Math.round(acc * 100) + "% of notes right first time, median " +
          (times.length ? (med / 1000).toFixed(2) + "s" : "—") + " a line. " +
          (acc < 0.8
            ? "Slow down. Land on a landmark, then read each note as a step or a skip from the last."
            : med <= 6000
              ? "That is reading a line, not decoding it note by note. Now try the other hand."
              : "Accurate. Push the pace — let your eye reach the next note while your hand plays this one.");
      }
      renderStats();
    }

    ui.startBtn.onclick = function () {
      sc.stopClock();
      running = true; resetState();
      ui.startBtn.textContent = "Restart";
      sc.startClock();
      mount._timer = sc.timer();   // so a rebuild can stop a live clock
      ask();
    };

    renderStats();
    sub.textContent = "Press Start. A line of notes appears — play it left to right.";
  }

  function build(mount) {
    if (mount._unsub) { mount._unsub(); mount._unsub = null; }
    if (mount._timer) { mount._timer.stop(); mount._timer = null; }
    var poolName = mount.getAttribute("data-pool") || "landmarks";
    if (PHRASE_POOLS[poolName]) return buildPhrase(mount, poolName);
    return buildSingle(mount, POOLS[poolName] || POOLS.landmarks);
  }

  window.StaffDrill = { build: build, POOLS: POOLS, PHRASE_POOLS: PHRASE_POOLS };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-staffdrill]").forEach(build);
  });
})();
