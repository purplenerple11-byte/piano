/* RhythmWidget — notated rhythm on a one-line staff, plus a metronome.

   Rhythm is the one dimension every drill in this course has ignored: they all
   grade WHICH key and never WHEN. This module supplies the missing half.

   Pattern notation — space-separated tokens, `r` prefix means rest:
       w = whole (4 beats)   h = half (2)   q = quarter (1)   e = eighth (0.5)
       rw rh rq re            the same durations, silent
   e.g. "q q e e q"  or  "h rq q"

   Mount:
     <div data-rhythm data-pattern="q q q q" data-title="…" data-caption="…"></div>

   API (on the mount, as `el.rhythm`):
     .show(pattern)   re-render from a pattern string
     .events()        [{ beat, beats, rest }] — the parsed pattern
     .mark(i, cls)    colour one notehead ("good" | "near" | "bad")
     .cursor(i)       move the "you are here" column (null hides it)
     .clear()

   ── On the metronome ──────────────────────────────────────────────────────
   setInterval/setTimeout are not accurate enough to schedule audio: they drift
   and get starved by layout. The standard fix is a lookahead scheduler — a
   coarse timer that wakes often and schedules the next few clicks precisely on
   the Web Audio clock, which runs on the audio thread and does not drift.
   (Chris Wilson, "A Tale of Two Clocks",
   https://web.dev/articles/audio-scheduling)

   Grading has to happen on the SAME clock the player hears, so beat times are
   published in audioContext time and MIDI arrivals are converted into it. */
(function () {
  var SVGNS = "http://www.w3.org/2000/svg";
  var LINE_Y = 74;              // the single rhythm line
  var WIDTH = 560, HEIGHT = 118;
  var X0 = 40, X1 = WIDTH - 34;
  var STEM = 34;

  var DUR = { w: 4, h: 2, q: 1, e: 0.5 };

  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  function parse(str) {
    var out = [], beat = 0;
    (str || "").trim().split(/\s+/).forEach(function (tok) {
      if (!tok) return;
      var rest = tok.charAt(0) === "r";
      var key = rest ? tok.slice(1) : tok;
      var beats = DUR[key];
      if (!beats) return;
      out.push({ beat: beat, beats: beats, rest: rest, kind: key });
      beat += beats;
    });
    return out;
  }

  function totalBeats(evts) {
    return evts.reduce(function (a, e) { return a + e.beats; }, 0);
  }

  function build(mount) {
    mount.classList.add("rhythm-box");
    var titleText = mount.getAttribute("data-title");
    if (titleText) {
      var lab = document.createElement("div");
      lab.className = "rhythm-label";
      lab.textContent = titleText;
      mount.appendChild(lab);
    }

    var svg = el("svg", { class: "rhythm-svg", viewBox: "0 0 " + WIDTH + " " + HEIGHT,
                          role: "img", "aria-label": "Rhythm" });
    var cursorLayer = el("g", {});
    var noteLayer = el("g", {});
    svg.appendChild(cursorLayer);
    svg.appendChild(el("line", { class: "rhythm-line", x1: X0 - 14, x2: X1 + 14,
                                 y1: LINE_Y, y2: LINE_Y }));
    svg.appendChild(noteLayer);
    mount.appendChild(svg);

    var capText = mount.getAttribute("data-caption");
    if (capText) {
      var cap = document.createElement("div");
      cap.className = "rhythm-caption";
      cap.innerHTML = capText;
      mount.appendChild(cap);
    }

    var evts = [], groups = [], band = null;

    function xOf(beat, total) { return X0 + (X1 - X0) * (beat / total); }

    function drawRest(g, x, kind) {
      if (kind === "w" || kind === "h") {
        // Whole rest hangs under a line; half rest sits on top of one.
        g.appendChild(el("rect", { class: "rhythm-rest", x: x - 8,
          y: kind === "w" ? LINE_Y : LINE_Y - 7, width: 16, height: 7 }));
      } else if (kind === "q") {
        g.appendChild(el("path", { class: "rhythm-rest-stroke",
          d: "M" + (x - 4) + " " + (LINE_Y - 20) +
             " l 7 10 l -8 8 l 8 10" }));
      } else {
        g.appendChild(el("path", { class: "rhythm-rest-stroke",
          d: "M" + (x - 5) + " " + (LINE_Y - 2) + " l 10 -14" }));
        g.appendChild(el("circle", { class: "rhythm-rest", cx: x + 4, cy: LINE_Y - 14, r: 3 }));
      }
    }

    function render() {
      noteLayer.innerHTML = "";
      cursorLayer.innerHTML = "";
      groups = [];
      var total = totalBeats(evts) || 1;

      // Consecutive sounding eighths get beamed together, the way real notation
      // groups them — the beam is what makes "1 & 2 &" visible at a glance.
      var beamRuns = [], run = [];
      evts.forEach(function (e, i) {
        if (!e.rest && e.kind === "e") run.push(i);
        else { if (run.length > 1) beamRuns.push(run); run = []; }
      });
      if (run.length > 1) beamRuns.push(run);
      var inBeam = {};
      beamRuns.forEach(function (r) { r.forEach(function (i) { inBeam[i] = true; }); });

      evts.forEach(function (e, i) {
        var x = xOf(e.beat, total);
        var g = el("g", {});
        noteLayer.appendChild(g);
        groups.push({ g: g, x: x, e: e });
        if (e.rest) { drawRest(g, x, e.kind); return; }

        var hollow = e.kind === "w" || e.kind === "h";
        g.appendChild(el("ellipse", {
          class: "rhythm-note" + (hollow ? " rhythm-note-open" : ""),
          cx: x, cy: LINE_Y, rx: 8.2, ry: 6,
          transform: "rotate(-18 " + x + " " + LINE_Y + ")"
        }));
        if (e.kind !== "w") {
          g.appendChild(el("line", { class: "rhythm-stem",
            x1: x + 7.6, x2: x + 7.6, y1: LINE_Y - 2, y2: LINE_Y - STEM }));
          if (e.kind === "e" && !inBeam[i]) {
            g.appendChild(el("path", { class: "rhythm-flag",
              d: "M" + (x + 7.6) + " " + (LINE_Y - STEM) +
                 " c 9 6 10 12 6 18" }));
          }
        }
      });

      beamRuns.forEach(function (r) {
        var xa = xOf(evts[r[0]].beat, total) + 7.6;
        var xb = xOf(evts[r[r.length - 1]].beat, total) + 7.6;
        noteLayer.appendChild(el("line", { class: "rhythm-beam",
          x1: xa, x2: xb, y1: LINE_Y - STEM, y2: LINE_Y - STEM }));
      });

      band = el("rect", { class: "rhythm-cursor", x: 0, y: LINE_Y - 44,
                          width: 26, height: 74, rx: 6 });
      band.style.display = "none";
      cursorLayer.appendChild(band);
    }

    var api = {
      show: function (pattern) { evts = parse(pattern); render(); return api; },
      events: function () { return evts.slice(); },
      totalBeats: function () { return totalBeats(evts); },
      mark: function (i, cls) {
        var gr = groups[i];
        if (!gr) return;
        gr.g.setAttribute("class", cls ? "rhythm-hit-" + cls : "");
      },
      cursor: function (i) {
        if (!band) return;
        if (i == null || !groups[i]) { band.style.display = "none"; return; }
        band.setAttribute("x", groups[i].x - 13);
        band.style.display = "";
      },
      clear: function () {
        groups.forEach(function (gr) { gr.g.setAttribute("class", ""); });
        api.cursor(null);
      }
    };
    mount.rhythm = api;
    api.show(mount.getAttribute("data-pattern") || "q q q q");
    return api;
  }

  /* Metronome. start() returns the audioContext time of beat 0, so a drill can
     compute exactly when every note in a pattern is due. onBeat fires slightly
     ahead of the audible click (it is called at schedule time), so visual
     updates are driven off the returned times, not off this callback. */
  function metronome() {
    var ctx = null, timer = null;
    var bpm = 80, nextBeat = 0, nextTime = 0, running = false;
    var accentEvery = 4, onBeat = null;
    var LOOKAHEAD = 0.12, TICK = 25;

    function ensureCtx() {
      if (!ctx) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        ctx = new C();
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function click(time, accent) {
      var osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = accent ? 1600 : 1000;
      // Very short percussive envelope; a raw square would click on both edges.
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(time); osc.stop(time + 0.07);
    }

    function schedule() {
      var spb = 60 / bpm;
      while (nextTime < ctx.currentTime + LOOKAHEAD) {
        click(nextTime, accentEvery > 0 && nextBeat % accentEvery === 0);
        if (onBeat) onBeat(nextBeat, nextTime);
        nextBeat++;
        nextTime += spb;
      }
    }

    return {
      available: function () { return !!(window.AudioContext || window.webkitAudioContext); },
      ctx: function () { return ctx; },
      /* Returns the audioContext time of beat 0, or null if audio is unavailable.
         countIn beats are clicked before beat 0 so the player can find the pulse. */
      start: function (opts) {
        opts = opts || {};
        if (!ensureCtx()) return null;
        this.stop();
        bpm = opts.bpm || 80;
        accentEvery = opts.accentEvery == null ? 4 : opts.accentEvery;
        onBeat = opts.onBeat || null;
        var countIn = opts.countIn || 0;
        var spb = 60 / bpm;
        var t0 = ctx.currentTime + 0.15;      // a beat of headroom before the first click
        nextBeat = -countIn;
        nextTime = t0;
        running = true;
        timer = setInterval(function () { if (running) schedule(); }, TICK);
        schedule();
        return t0 + countIn * spb;            // when beat 0 lands
      },
      stop: function () {
        running = false;
        if (timer) { clearInterval(timer); timer = null; }
      },
      isRunning: function () { return running; },
      now: function () { return ctx ? ctx.currentTime : 0; }
    };
  }

  window.RhythmWidget = { build: build, parse: parse, metronome: metronome, DUR: DUR };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-rhythm]").forEach(build);
  });
})();
