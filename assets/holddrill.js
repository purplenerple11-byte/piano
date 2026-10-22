/* HoldDrill — the left hand holds, the right hand keeps time over it.

   Mount:
     <div data-holddrill
          data-staff="staff-id"      <!-- a both-clefs StaffWidget -->
          data-kb="keyboard-id"
          data-bars="json-id"        <!-- [{ "name": "C", "lh": [36, 48], "rh": [60, 64, 67] }, …] -->
          data-hands="both"          <!-- left | right | both -->
          data-hits="4"              <!-- right-hand strikes per bar -->
          data-loops="1"             <!-- times through the progression -->
          data-clock="free"          <!-- free | click -->
          data-bpm="60"              <!-- click mode only -->
          data-show-keys="false"     <!-- light the next keys on the keyboard -->
          data-title="…" data-caption="…"></div>

   ── What is being measured ───────────────────────────────────────────────
   Every other two-hand drill here asks both hands to land and then let go. This
   one asks the hands to do DIFFERENT things over the same stretch of time: the
   left strikes once and stays down, the right strikes four times above it. The
   trap is that the hands want to copy each other — every right-hand strike drags
   the left hand up with it — so the headline number besides the chords is
   **holds kept**: bars where the left hand stayed down until the fourth chord.

   A hold is judged from real note-offs, so it is only graded from a MIDI
   keyboard. Taps on the on-screen keys can't hold one key while pressing others
   with the same pointer, and grading them on it would be grading the mouse.

   `free` has no clock: each column waits for you, and a hold runs from the
   left-hand strike until the fourth right-hand chord is complete. `click` plays
   against a metronome, graded per note in milliseconds like Lesson 4, and a
   hold must last until the fourth beat of its bar has sounded. */
(function () {
  var TIGHT = 60, LOOSE = 140;
  var SVGNS = "http://www.w3.org/2000/svg";

  function median(xs) {
    if (!xs.length) return 0;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mean(xs) {
    return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0;
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function svgEl(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }
  function names(midis) {
    return midis.map(function (m) { return window.PianoMIDI.nameOf(m); }).join(" ");
  }

  function build(mount) {
    if (mount._unsub) { mount._unsub(); mount._unsub = null; }
    if (mount._metro) mount._metro.stop();
    if (mount._tick) { clearInterval(mount._tick); mount._tick = null; }

    var staffEl = document.getElementById(mount.getAttribute("data-staff"));
    var st = staffEl && staffEl.staff;
    var kbEl = document.getElementById(mount.getAttribute("data-kb"));
    var kb = kbEl && kbEl.keyboard;
    var srcEl = document.getElementById(mount.getAttribute("data-bars"));
    if (!st || !srcEl) { console.error("HoldDrill: missing staff or bar data for", mount); return; }

    var bars = JSON.parse(srcEl.textContent);
    var hands = mount.getAttribute("data-hands") || "both";
    var hits = parseInt(mount.getAttribute("data-hits") || "4", 10);
    var loops = parseInt(mount.getAttribute("data-loops") || "1", 10);
    var clocked = mount.getAttribute("data-clock") === "click";
    var bpm = parseInt(mount.getAttribute("data-bpm") || "60", 10);
    var showKeys = mount.getAttribute("data-show-keys") === "true";
    var useL = hands !== "right", useR = hands !== "left";
    // A hold needs something to be held THROUGH: right-hand strikes or a clock.
    var gradeHolds = useL && (useR || clocked);
    // Bars per staff view. Two bars of four chords is eight columns, about as
    // dense as the staff reads; a left hand alone is one column per bar.
    var perPage = useR ? 2 : 4;

    // ── Box ──
    // StaffWidget auto-mounts on anything with data-staff, which includes this
    // drill's own pointer to its staff. Undo its class; innerHTML clears the rest.
    mount.classList.remove("staff-box");
    mount.classList.add("drill-box");
    mount.innerHTML = "";
    var titleText = mount.getAttribute("data-title");
    if (titleText) mount.appendChild(el("div", "drill-label", titleText));

    var stage = el("div", "drill-stage");
    var cue = el("span", "drill-cue");
    var nextCue = el("div", "chord-next");
    var sub = el("div", "drill-sub");
    stage.appendChild(cue);
    stage.appendChild(nextCue);
    stage.appendChild(sub);
    mount.appendChild(stage);

    var controls = el("div", "drill-controls");
    var startBtn = el("button", "drill-btn");
    startBtn.textContent = "Start";
    controls.appendChild(startBtn);
    var tempoLabel = null;
    if (clocked) {
      // Slowing down is the right answer to missing, so it is one tap away.
      var slower = el("button", "drill-btn drill-btn-ghost"); slower.textContent = "−10";
      tempoLabel = el("span", "drill-clock");
      var faster = el("button", "drill-btn drill-btn-ghost"); faster.textContent = "+10";
      slower.onclick = function () { if (!running) setTempo(bpm - 10); };
      faster.onclick = function () { if (!running) setTempo(bpm + 10); };
      controls.appendChild(slower);
      controls.appendChild(tempoLabel);
      controls.appendChild(faster);
    }
    mount.appendChild(controls);

    var stats = el("div", "drill-stats");
    mount.appendChild(stats);
    var capText = mount.getAttribute("data-caption");
    if (capText) mount.appendChild(el("div", "drill-caption", capText));

    function setTempo(v) {
      bpm = Math.max(40, Math.min(160, v));
      if (tempoLabel) tempoLabel.textContent = bpm + " bpm";
    }
    setTempo(bpm);

    // Overlay for the hold lines, owned here so the staff widget never has to
    // know about holds. duet() only clears its own note layer.
    var svg = staffEl.querySelector("svg");
    var stale = svg.querySelector("g.hold-layer");     // from an earlier build()
    if (stale) stale.parentNode.removeChild(stale);
    var holdLayer = svgEl("g", { class: "hold-layer" });
    svg.appendChild(holdLayer);

    // ── Timeline ──
    var cols = [], holds = [], beat0 = 0, spb = 1;

    function buildTimeline() {
      cols = []; holds = [];
      spb = 60 / bpm;
      var nBars = bars.length * loops;
      for (var b = 0; b < nBars; b++) {
        var bar = bars[b % bars.length];
        var hold = null;
        if (gradeHolds) {
          hold = { bar: b, name: bar.name, notes: bar.lh.slice(), struck: {}, viaMidi: true,
                   broken: false, ended: false, cols: [], lines: [],
                   tEnd: beat0 + (b * hits + hits - 1) * spb };
          holds.push(hold);
        }
        for (var k = 0; k < hits; k++) {
          if (!useR && k > 0) break;
          var c = { bar: b, beat: k, name: bar.name,
                    treble: useR ? bar.rh.slice() : null,
                    bass: useL && k === 0 ? bar.lh.slice() : null,
                    hold: hold, page: Math.floor(b / perPage),
                    t: beat0 + (b * hits + k) * spb,
                    need: {}, got: {}, at: {}, err: false };
          (c.treble || []).forEach(function (m) { c.need[m] = "treble"; });
          (c.bass || []).forEach(function (m) { c.need[m] = "bass"; });
          if (hold) hold.cols.push(c);
          cols.push(c);
        }
      }
      cols.forEach(function (c, i) { c.i = i; });
    }

    // ── Staff view ──
    var page = -1, line = null, pageCols = [];

    function showPage(p) {
      page = p;
      pageCols = cols.filter(function (c) { return c.page === p; });
      pageCols.forEach(function (c, j) { c.slot = j; });
      line = st.duet(pageCols.map(function (c) { return { treble: c.treble, bass: c.bass }; }));
      pageCols.forEach(repaintCol);
      drawHolds();
    }

    function noteClass(c, m) {
      if (!(m in c.got)) return null;
      if (!clocked) return "staff-note-good";
      return Math.abs(c.got[m]) <= LOOSE ? "staff-note-good" : "staff-note-bad";
    }
    function repaintCol(c) {
      if (c.page !== page || !line) return;
      Object.keys(c.need).forEach(function (k) {
        var m = +k, cls = noteClass(c, m);
        if (cls) line.markNote(c.slot, c.need[m], m, cls);
      });
    }

    function drawHolds() {
      holdLayer.innerHTML = "";
      if (!gradeHolds || !line) return;
      var gap = pageCols.length > 1 ? line.xAt(1) - line.xAt(0) : 80;
      holds.forEach(function (h) {
        h.lines = [];
        var hc = h.cols.filter(function (c) { return c.page === page; });
        if (!hc.length) return;
        var x1 = line.xAt(hc[0].slot) + 11;
        var x2 = useR ? line.xAt(hc[hc.length - 1].slot) + 11
                      : Math.min(line.xAt(hc[0].slot) + gap - 16, 548);
        h.notes.forEach(function (m) {
          var y = st.yFor(m, "bass");
          var ln = svgEl("line", { x1: x1, x2: x2, y1: y, y2: y });
          holdLayer.appendChild(ln);
          h.lines.push(ln);
        });
        paintHold(h);
      });
    }
    function paintHold(h) {
      var on = Object.keys(h.struck).length > 0;
      var cls = "hold-line" + (h.broken ? " hold-line-bad"
                : h.ended ? " hold-line-good" : on ? " hold-line-on" : "");
      h.lines.forEach(function (ln) { ln.setAttribute("class", cls); });
    }

    function hintKeys(c) {
      if (!kb || !showKeys) return;
      kb.clear("kbd-next");
      if (c) kb.mark(Object.keys(c.need).map(Number), "kbd-next");
    }

    function setCue(c) {
      if (!c) { nextCue.textContent = ""; return; }
      cue.className = "drill-cue";
      cue.textContent = c.name;
      var nb = bars[(c.bar + 1) % bars.length];
      var last = c.bar + 1 >= bars.length * loops;
      nextCue.textContent = last ? "last bar" : "next: " + nb.name;
    }

    // ── Stats ──
    var running = false, ran = false, pos = 0, armed = false;
    var doneCols = 0, cleanCols = 0, spreads = [], noteErrs = [], wrong = 0;

    function holdTally() {
      var graded = holds.filter(function (h) {
        return h.viaMidi && (h.ended || h.broken) &&
               h.notes.every(function (m) { return h.struck[m]; });
      });
      var kept = graded.filter(function (h) { return !h.broken; }).length;
      return { kept: kept, total: graded.length };
    }

    function renderStats() {
      var nBars = bars.length * loops;
      var cur = clocked ? (running ? Math.min(curBar() + 1, nBars) : ran ? nBars : 0)
                        : (cols[pos] ? cols[pos].bar + (running ? 1 : 0) : nBars);
      var rows = [["Bar", cur + " / " + nBars]];
      if (clocked) {
        var inTime = noteErrs.filter(function (e) { return Math.abs(e) <= LOOSE; }).length;
        rows.push(["In time", noteErrs.length ? Math.round(inTime * 100 / noteErrs.length) + "%" : "—"]);
        rows.push(["Avg off", noteErrs.length ? Math.round(mean(noteErrs.map(Math.abs))) + "ms" : "—"]);
      } else {
        rows.push(["Clean", doneCols ? Math.round(cleanCols * 100 / doneCols) + "%" : "—"]);
        rows.push(["Spread", spreads.length ? Math.round(median(spreads)) + "ms" : "—"]);
      }
      if (gradeHolds) {
        var ht = holdTally();
        rows.push(["Holds kept", ht.total ? ht.kept + " / " + ht.total : "—"]);
      }
      stats.innerHTML = "";
      rows.forEach(function (p) {
        var d = el("div", "drill-stat");
        d.innerHTML = '<span class="drill-stat-val">' + p[1] + "</span>" +
                      '<span class="drill-stat-key">' + p[0] + "</span>";
        stats.appendChild(d);
      });
    }

    function strikeHold(c, m, source) {
      var h = c.hold;
      if (!h || c.need[m] !== "bass") return;
      h.struck[m] = true;
      if (source !== "midi") h.viaMidi = false;
      paintHold(h);
    }

    // A left-hand note of a hold still running — pressing it again means it was
    // released, which onRelease has already reported. Never a wrong note.
    function isHeldNote(m) {
      return holds.some(function (h) { return !h.ended && h.struck[m]; });
    }

    function wrongNote(e, c) {
      wrong++;
      if (c) c.err = true;
      if (kb) kb.mark(e.note, "kbd-bad");
      setTimeout(function () { if (kb) kb.unmark(e.note, "kbd-bad"); }, 500);
      sub.className = "drill-sub drill-sub-bad";
      if (c) {
        var b = bars[c.bar % bars.length];
        sub.textContent = window.PianoMIDI.nameOf(e.note) + " isn't in this bar — " +
          c.name + " is " + names(b.rh) + (useL ? " over " + window.PianoMIDI.nameOf(b.lh[0]) + " octaves." : ".");
        if (!useR) sub.textContent = window.PianoMIDI.nameOf(e.note) + " — this bar wants the " +
          window.PianoMIDI.nameOf(b.lh[0]) + " octave.";
      } else {
        sub.textContent = window.PianoMIDI.nameOf(e.note) + " — nothing due there.";
      }
    }

    function onRelease(e) {
      if (e.source !== "midi") return;
      var now = clocked ? metro.now() : 0;
      holds.forEach(function (h) {
        if (h.ended || h.broken || !h.struck[e.note]) return;
        // In click mode the hold is owed until the 4th beat; a hair early is
        // fine — the hand has to leave to reach the next octave on time.
        if (clocked && now >= h.tEnd - 0.15 * spb) { return; }
        h.broken = true;
        paintHold(h);
        sub.className = "drill-sub drill-sub-bad";
        sub.textContent = "Left hand let go on " + h.name +
          " — keep the octave down until the " + ordinal(hits) + " chord.";
        renderStats();
      });
    }
    function ordinal(n) { return n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : n === 4 ? "fourth" : n + "th"; }

    // ── Free mode: each column waits for you ──
    function armFree() {
      var c = cols[pos];
      armed = true;
      line.cursor(c.slot);
      setCue(c);
      hintKeys(c);
    }

    function onPressFree(e) {
      var c = cols[pos];
      if (!armed || !c) return;
      var m = e.note;
      if (!(m in c.need) || (m in c.got)) {
        if (m in c.got) return;                 // a bounce on a key already down
        if (isHeldNote(m)) return;
        wrongNote(e, c);
        return;
      }
      c.got[m] = 0;
      c.at[m] = performance.now();
      line.markNote(c.slot, c.need[m], m, "staff-note-good");
      strikeHold(c, m, e.source);
      if (Object.keys(c.need).some(function (k) { return !(k in c.got); })) {
        if (!c.err) { sub.className = "drill-sub"; sub.textContent = ""; }
        return;
      }

      // Column complete.
      var ats = Object.keys(c.at).map(function (k) { return c.at[k]; });
      var spread = ats.length > 1 ? Math.max.apply(null, ats) - Math.min.apply(null, ats) : 0;
      if (ats.length > 1) spreads.push(spread);
      doneCols++;
      if (!c.err) cleanCols++;
      var h = c.hold;
      if (h && useR && c.beat === hits - 1 && !h.broken) {
        h.ended = true;
        paintHold(h);
      }
      if (!h || !h.broken || c.beat === 0) {
        sub.className = "drill-sub " + (spread <= LOOSE ? "drill-sub-good" : "drill-sub-bad");
        sub.textContent = ats.length < 2 ? "✓"
          : spread <= TIGHT ? "Together — " + Math.round(spread) + "ms"
          : spread <= LOOSE ? Math.round(spread) + "ms apart"
          : Math.round(spread) + "ms apart — land them as one";
      }
      pos++;
      renderStats();
      if (pos >= cols.length) { armed = false; setTimeout(finish, 350); return; }
      if (cols[pos].page !== page) {
        armed = false;
        setTimeout(function () { if (running) { showPage(cols[pos].page); armFree(); } }, 350);
        return;
      }
      armFree();
    }

    // ── Click mode: graded against the metronome ──
    var metro = clocked ? window.RhythmWidget.metronome() : null;
    mount._metro = metro;
    var tEnd = 0;

    function curBar() {
      if (!metro) return 0;
      var t = metro.now();
      return Math.max(0, Math.floor((t - beat0) / spb / hits));
    }

    function onPressClock(e) {
      var t = metro.now(), m = e.note;
      if (t < beat0 - 0.5 * spb) return;        // still counting in
      var best = null, bestErr = Infinity;
      cols.forEach(function (c) {
        if (!(m in c.need) || (m in c.got)) return;
        var err = (t - c.t) * 1000;
        if (Math.abs(err) < Math.abs(bestErr)) { best = c; bestErr = err; }
      });
      if (!best || Math.abs(bestErr) > spb * 500) {
        if (isHeldNote(m)) return;
        // A right note struck twice around the same beat is a bounce, not a
        // wrong note — the column it belongs to has already been graded.
        if (cols.some(function (c) { return (m in c.got) && Math.abs(t - c.t) <= spb / 2; })) return;
        var near = cols.reduce(function (a, c) {
          return !a || Math.abs(c.t - t) < Math.abs(a.t - t) ? c : a;
        }, null);
        wrongNote(e, near);
        renderStats();
        return;
      }
      best.got[m] = bestErr;
      noteErrs.push(bestErr);
      repaintCol(best);
      strikeHold(best, m, e.source);
      var a = Math.abs(bestErr);
      sub.className = "drill-sub " + (a <= LOOSE ? "drill-sub-good" : "drill-sub-bad");
      sub.textContent = a <= TIGHT ? "On it"
        : bestErr < 0 ? Math.round(-bestErr) + "ms early" : Math.round(bestErr) + "ms late";
      renderStats();
    }

    function startClock() {
      if (!metro.available()) {
        sub.className = "drill-sub drill-sub-bad";
        sub.textContent = "This browser has no Web Audio, so there is no click to play against.";
        return false;
      }
      var b0 = metro.start({
        bpm: bpm, countIn: hits, accentEvery: hits,
        onBeat: function (b) {
          if (b < 0) {
            sub.className = "drill-sub";
            sub.textContent = "Count in… " + (hits + b + 1);
          }
        }
      });
      if (b0 == null) return false;
      beat0 = b0;
      buildTimeline();
      showPage(0);
      setCue(cols[0]);
      tEnd = beat0 + bars.length * loops * hits * spb;
      mount._tick = setInterval(function () {
        if (!running) { clearInterval(mount._tick); mount._tick = null; return; }
        var t = metro.now();
        if (t < beat0 - 0.05) return;
        if (sub.textContent.indexOf("Count in") === 0) { sub.className = "drill-sub"; sub.textContent = "Play."; }
        var up = null;
        for (var i = 0; i < cols.length; i++) { if (cols[i].t > t - 0.25 * spb) { up = cols[i]; break; } }
        if (up) {
          if (up.page !== page) showPage(up.page);
          line.cursor(up.slot);
          setCue(up);
        } else if (line) line.cursor(null);
        holds.forEach(function (h) {
          if (!h.ended && !h.broken && t >= h.tEnd) { h.ended = true; paintHold(h); }
        });
        renderStats();
        if (t > tEnd + 0.4) finish();
      }, 40);
      return true;
    }

    // ── Run ──
    function finish() {
      if (!running && !clocked) return;
      running = false;
      armed = false;
      if (metro) metro.stop();
      if (mount._tick) { clearInterval(mount._tick); mount._tick = null; }
      startBtn.textContent = "Start";
      if (line) line.cursor(null);
      hintKeys(null);
      if (clocked) holds.forEach(function (h) { if (!h.broken) h.ended = true; });
      var ht = holdTally();
      var holdLine = !gradeHolds ? ""
        : ht.total ? " Left hand held " + ht.kept + " of " + ht.total + " bars."
        : " (Holds are only graded from a MIDI keyboard.)";
      cue.className = "drill-cue drill-cue-small";
      nextCue.textContent = "";
      var advice;
      if (clocked) {
        var inTime = noteErrs.filter(function (x) { return Math.abs(x) <= LOOSE; }).length;
        var pct = noteErrs.length ? Math.round(inTime * 100 / noteErrs.length) : 0;
        var expected = cols.reduce(function (a, c) { return a + Object.keys(c.need).length; }, 0);
        var missed = expected - noteErrs.length;
        var signed = mean(noteErrs);
        advice = ht.total && ht.kept < ht.total
          ? "Your left hand is copying your right. Slow it down until it doesn't."
          : pct >= 80 && missed <= 2 ? (Math.abs(signed) < 25 ? "In the pocket. Nudge the tempo up."
            : signed < 0 ? "Solid, but ahead of the click — let the beat come to you."
            : "Solid, but behind the click — move to the next shape sooner.")
          : "Take it down 10bpm. Steady beats a fast mess.";
        cue.textContent = advice;
        sub.className = "drill-sub";
        sub.innerHTML = "<strong>" + pct + "% in time</strong>, average " +
          Math.round(mean(noteErrs.map(Math.abs))) + "ms off" +
          (missed > 0 ? ", " + missed + " notes not played" : "") +
          (wrong ? ", " + wrong + " wrong" : "") + "." + holdLine;
      } else {
        var cp = doneCols ? Math.round(cleanCols * 100 / doneCols) : 0;
        advice = ht.total && ht.kept < ht.total
          ? "Chords there — now keep that left hand down."
          : cp >= 85 ? "Clean. Try it against the click."
          : "Go slower. Find each shape before you press.";
        cue.textContent = advice;
        sub.className = "drill-sub";
        sub.innerHTML = "<strong>" + cp + "% clean</strong>" +
          (spreads.length ? ", spread " + Math.round(median(spreads)) + "ms" : "") + "." + holdLine;
      }
      renderStats();
    }

    function reset() {
      pos = 0; doneCols = 0; cleanCols = 0; spreads = []; noteErrs = []; wrong = 0;
    }

    startBtn.onclick = function () {
      if (running) { finish(); return; }
      reset();
      running = true;
      ran = true;
      startBtn.textContent = "Stop";
      if (clocked) {
        if (!startClock()) { running = false; startBtn.textContent = "Start"; return; }
      } else {
        beat0 = 0;
        buildTimeline();
        showPage(0);
        sub.className = "drill-sub";
        sub.textContent = "";
        armFree();
      }
      renderStats();
    };

    mount._unsub = window.PianoMIDI.subscribe(function (e) {
      if (!running) return;
      if (!e.on) { onRelease(e); return; }
      if (clocked) onPressClock(e); else onPressFree(e);
    });

    // Preview the first page so the staff isn't blank before Start.
    buildTimeline();
    showPage(0);
    renderStats();
    cue.className = "drill-cue drill-cue-small";
    cue.textContent = "Press Start.";
    if (clocked) sub.textContent = hits + " clicks to count you in.";
  }

  window.HoldDrill = { build: build };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-holddrill]").forEach(build);
  });
})();
