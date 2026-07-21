/* KeyDrill — timed retrieval practice on keyboard geography.

   Two directions, because recognition and production are different skills and
   only drilling both makes the map bidirectional:

     mode="find"  cue is a note NAME  → play that key (MIDI or click)
     mode="name"  cue is a lit KEY    → choose its name from four options

   Mount:
     <div data-drill="find" data-kb="kb-main" data-pool="black" data-rounds="12"
          data-title="Drill" data-caption="…"></div>

   data-pool: white | black | all
   data-kb:   id of a [data-keyboard] mount (its .keyboard API is used)

   Timing is deliberate. The mission target is "name any key in under a second",
   so the drill reports MEDIAN response time, not a score alone — accuracy with
   a four-second stare is not the skill. Median rather than mean so one fumbled
   round doesn't swamp the reading. */
(function () {
  var WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
  var BLACK_PC = [1, 3, 6, 8, 10];

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

  /* Black keys get both names, because the two names ARE the geography — the
     key between D and E is one key with two labels, and hiding that just moves
     the confusion later. White keys get their single letter. */
  function label(pc) {
    var sharp = window.PianoMIDI.SHARP_NAMES[pc];
    var flat = window.PianoMIDI.FLAT_NAMES[pc];
    return sharp === flat ? sharp : sharp + " / " + flat;
  }

  function build(mount) {
    var mode = mount.getAttribute("data-drill");
    var poolName = mount.getAttribute("data-pool") || "all";
    var rounds = parseInt(mount.getAttribute("data-rounds") || "12", 10);
    var kbMount = document.getElementById(mount.getAttribute("data-kb"));
    var kb = kbMount && kbMount.keyboard;
    if (!kb) { console.error("KeyDrill: no keyboard found for", mount); return; }

    var pool = poolName === "white" ? WHITE_PC : poolName === "black" ? BLACK_PC
             : WHITE_PC.concat(BLACK_PC);

    // A drill can be rebuilt in place (e.g. a lesson swapping the pool from
    // black-only to all twelve). Drop the previous instance's MIDI subscriber
    // first — otherwise the stale closure keeps scoring alongside the new one.
    if (mount._drillUnsub) { mount._drillUnsub(); mount._drillUnsub = null; }

    mount.classList.add("drill-box");
    mount.innerHTML = "";

    var title = mount.getAttribute("data-title");
    if (title) {
      var lab = document.createElement("div");
      lab.className = "drill-label";
      lab.textContent = title;
      mount.appendChild(lab);
    }

    var stage = document.createElement("div");
    stage.className = "drill-stage";
    var cue = document.createElement("span");
    cue.className = "drill-cue";
    var sub = document.createElement("div");
    sub.className = "drill-sub";
    stage.appendChild(cue);
    stage.appendChild(sub);
    mount.appendChild(stage);

    var answers = document.createElement("div");
    answers.className = "drill-answers";
    mount.appendChild(answers);

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

    var caption = mount.getAttribute("data-caption");
    if (caption) {
      var cap = document.createElement("div");
      cap.className = "drill-caption";
      cap.innerHTML = caption;
      mount.appendChild(cap);
    }

    var running = false, locked = true, round = 0, correct = 0;
    var times = [], streak = 0, bestStreak = 0;
    var targetPC = null, cuedNote = null, askedAt = 0, queue = [];

    function renderStats() {
      var med = median(times);
      stats.innerHTML = "";
      [["Round", round + " / " + rounds],
       ["Correct", correct + ""],
       ["Median", times.length ? (med / 1000).toFixed(2) + "s" : "—"],
       ["Best streak", bestStreak + ""]].forEach(function (pair) {
        var d = document.createElement("div");
        d.className = "drill-stat";
        d.innerHTML = '<span class="drill-stat-val">' + pair[1] + "</span>" +
                      '<span class="drill-stat-key">' + pair[0] + "</span>";
        stats.appendChild(d);
      });
    }

    /* Draw without immediate repeats — a repeat can be answered from muscle
       memory of the last round rather than from the map. */
    function nextPC() {
      if (!queue.length) queue = shuffle(pool);
      var pc = queue.pop();
      if (pc === targetPC && queue.length) { var alt = queue.pop(); queue.push(pc); pc = alt; }
      return pc;
    }

    function start() {
      running = true; round = 0; correct = 0; times = []; streak = 0; bestStreak = 0;
      targetPC = null; queue = [];
      startBtn.textContent = "Restart";
      ask();
    }

    function ask() {
      kb.clear();
      answers.innerHTML = "";
      sub.className = "drill-sub";
      sub.textContent = "";
      if (round >= rounds) { finish(); return; }
      round++;
      targetPC = nextPC();
      renderStats();

      if (mode === "find") {
        cue.className = "drill-cue";
        cue.textContent = label(targetPC);
        sub.textContent = "Play it — any octave.";
        locked = false;
        askedAt = performance.now();
      } else {
        // Light one specific key so the answer depends on reading the pattern,
        // not on remembering which octave the drill favours.
        var candidates = kb.notes.filter(function (n) { return ((n % 12) + 12) % 12 === targetPC; });
        cuedNote = candidates[Math.floor(Math.random() * candidates.length)];
        // Accent, not green: green means "you got it right" everywhere else in
        // this drill, and the cue has not been answered yet.
        kb.mark(cuedNote, "kbd-hi");
        cue.className = "drill-cue drill-cue-small";
        cue.textContent = "Which key is lit?";
        renderAnswerButtons();
        locked = false;
        askedAt = performance.now();
      }
    }

    function renderAnswerButtons() {
      // Distractors are drawn from the SAME colour as the answer. Mixing white
      // and black names would leak the answer through string length alone.
      var sameKind = BLACK_PC.indexOf(targetPC) >= 0 ? BLACK_PC : WHITE_PC;
      var others = shuffle(sameKind.filter(function (p) { return p !== targetPC; })).slice(0, 3);
      shuffle(others.concat([targetPC])).forEach(function (pc) {
        var b = document.createElement("button");
        b.className = "drill-ans";
        b.textContent = label(pc);
        b.onclick = function () { answer(pc, b); };
        answers.appendChild(b);
      });
    }

    function score(ok, ms) {
      if (ok) {
        correct++; times.push(ms); streak++;
        if (streak > bestStreak) bestStreak = streak;
      } else {
        streak = 0;
      }
      renderStats();
      setTimeout(ask, ok ? 700 : 1600);
    }

    function answer(pc, btn) {
      if (locked || !running) return;
      locked = true;
      var ms = performance.now() - askedAt;
      var ok = pc === targetPC;
      Array.prototype.forEach.call(answers.children, function (b) { b.disabled = true; });
      btn.classList.add(ok ? "drill-ans-good" : "drill-ans-bad");
      if (!ok) {
        Array.prototype.forEach.call(answers.children, function (b) {
          if (b.textContent === label(targetPC)) b.classList.add("drill-ans-good");
        });
      }
      sub.className = "drill-sub " + (ok ? "drill-sub-good" : "drill-sub-bad");
      sub.textContent = ok ? (ms / 1000).toFixed(2) + "s" : "It was " + label(targetPC) + ".";
      score(ok, ms);
    }

    mount._drillUnsub = window.PianoMIDI.subscribe(function (e) {
      if (mode !== "find" || !running || locked || !e.on) return;
      locked = true;
      var ms = performance.now() - askedAt;
      var ok = e.pc === targetPC;
      kb.clear();
      if (ok) {
        kb.markPC(targetPC, "kbd-good");
        sub.className = "drill-sub drill-sub-good";
        sub.textContent = (ms / 1000).toFixed(2) + "s";
      } else {
        kb.mark(e.note, "kbd-bad");
        kb.markPC(targetPC, "kbd-good");
        sub.className = "drill-sub drill-sub-bad";
        sub.textContent = "That was " + label(e.pc) + ". Green is " + label(targetPC) + ".";
      }
      score(ok, ms);
    });

    function finish() {
      running = false; locked = true;
      kb.clear();
      answers.innerHTML = "";
      cue.className = "drill-cue drill-cue-small";
      var med = median(times);
      var verdict = correct < rounds * 0.8
        ? "Accuracy first — run it again before chasing speed."
        : med <= 1000
          ? "Under a second and accurate. That is the target — keep it warm."
          : med <= 2000
            ? "Accurate. Now shave the time: look for the black-key group first, then count."
            : "Accurate but slow. You are still counting up from C — find the group, not the letter.";
      cue.textContent = verdict;
      sub.className = "drill-sub";
      sub.textContent = correct + " of " + rounds + " correct, median " +
        (times.length ? (med / 1000).toFixed(2) + "s" : "—");
      renderStats();
    }

    startBtn.onclick = start;
    renderStats();
    cue.className = "drill-cue drill-cue-small";
    cue.textContent = "Press Start.";
  }

  window.KeyDrill = { build: build };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-drill]").forEach(build);
  });
})();
