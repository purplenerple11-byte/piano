/* StaffDrill — a note appears on the staff; you PLAY it on the piano.

   This is the sight-reading feedback loop in its smallest honest form: symbol in,
   key out, graded instantly against what your hands actually did.

   Mount:
     <div data-staffdrill
          data-staff="staff-id"    <!-- a [data-staff] mount -->
          data-kb="kb-id"          <!-- a [data-keyboard] mount, for feedback -->
          data-pool="landmarks"    <!-- landmarks | steps -->
          data-rounds="10"></div>

   One difference from KeyDrill that matters pedagogically: this grades the
   EXACT note, not the pitch class. Lesson 1 accepted C in any octave, because
   the skill there was "where does C live in the pattern". A staff position
   names one specific key, so playing the right letter in the wrong octave is
   the wrong answer here — and it is the single most common beginner error, so
   the feedback says so explicitly rather than just marking it wrong.

   Timing and stats deliberately mirror keydrill.js (median, not mean). The two
   share their CSS but not their code; if a third drill appears, extract the
   stats/median/queue logic into a shared drillcore module rather than copying
   it a third time. */
(function () {
  var POOLS = {
    // [midi, clef] — the three guide notes every method starts from.
    landmarks: [[67, "treble"], [60, "treble"], [53, "bass"]],
    // …plus one diatonic step either side, which is where interval reading starts.
    steps: [[67, "treble"], [60, "treble"], [53, "bass"],
            [65, "treble"], [69, "treble"], [62, "treble"],
            [52, "bass"], [55, "bass"]]
  };
  var LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

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

  function build(mount) {
    if (mount._unsub) { mount._unsub(); mount._unsub = null; }

    var staffEl = document.getElementById(mount.getAttribute("data-staff"));
    var kbEl = document.getElementById(mount.getAttribute("data-kb"));
    var staff = staffEl && staffEl.staff;
    var kb = kbEl && kbEl.keyboard;
    if (!staff) { console.error("StaffDrill: no staff for", mount); return; }

    var pool = POOLS[mount.getAttribute("data-pool") || "landmarks"] || POOLS.landmarks;
    var rounds = parseInt(mount.getAttribute("data-rounds") || "10", 10);

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

    var captionText = mount.getAttribute("data-caption");
    if (captionText) {
      var cap = document.createElement("div");
      cap.className = "drill-caption";
      cap.innerHTML = captionText;
      mount.appendChild(cap);
    }

    var running = false, locked = true, round = 0, correct = 0;
    var times = [], streak = 0, best = 0, queue = [], target = null, askedAt = 0;

    function renderStats() {
      var med = median(times);
      stats.innerHTML = "";
      [["Round", round + " / " + rounds],
       ["Correct", correct + ""],
       ["Median", times.length ? (med / 1000).toFixed(2) + "s" : "—"],
       ["Best streak", best + ""]].forEach(function (p) {
        var d = document.createElement("div");
        d.className = "drill-stat";
        d.innerHTML = '<span class="drill-stat-val">' + p[1] + "</span>" +
                      '<span class="drill-stat-key">' + p[0] + "</span>";
        stats.appendChild(d);
      });
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
      if (kb) kb.clear();
      sub.className = "drill-sub";
      sub.textContent = "Play it.";
      if (round >= rounds) return finish();
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
      /* Right letter, wrong octave is the classic miss, and it means something
         different from "wrong note" — the staff was read correctly but the hand
         went to the wrong end of the keyboard. Say which it was. */
      var rightLetter = (((e.note % 12) + 12) % 12) === (((want % 12) + 12) % 12);

      staff.show(want, target[1], ok ? "staff-note-good" : "staff-note-bad");
      if (kb) {
        if (!ok) kb.mark(e.note, "kbd-bad");
        kb.mark(want, "kbd-good");
      }
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
      running = false; locked = true;
      staff.clear();
      if (kb) kb.clear();
      var med = median(times);
      sub.className = "drill-sub";
      sub.innerHTML = "<strong>" + correct + " of " + rounds + "</strong>, median " +
        (times.length ? (med / 1000).toFixed(2) + "s" : "—") + ". " +
        (correct < rounds * 0.8
          ? "Accuracy first. Find the landmark, then step from it."
          : med <= 2000
            ? "That is reading, not working it out. Keep it warm."
            : "Accurate. Now stop counting up from the bottom line — jump to the nearest landmark first.");
      renderStats();
    }

    startBtn.onclick = function () {
      running = true; round = 0; correct = 0; times = [];
      streak = 0; best = 0; queue = []; target = null;
      startBtn.textContent = "Restart";
      ask();
    };

    renderStats();
    sub.textContent = "Press Start. A note appears — play it.";
  }

  window.StaffDrill = { build: build, POOLS: POOLS };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-staffdrill]").forEach(build);
  });
})();
