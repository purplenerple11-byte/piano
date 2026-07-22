/* DrillCore — the plumbing every drill in this workspace shares.

   Three drills now exist (keydrill, staffdrill single-note, staffdrill phrase),
   and all three grow the same sprint feature: a per-drill countdown that trades
   the fixed-rounds run for "as many as you can in N seconds", scored by
   throughput. Rather than copy that a third time, the timer and the toggle live
   here and each drill wires its own start/ask/finish into them.

   Deliberately small and drill-agnostic: DrillCore knows about a countdown and a
   toggle button, nothing about notes, staves or keys. Each drill keeps its own
   scaffold, stats and grading — only the sprint mechanics are shared. */
(function () {
  function mmss(ms) {
    var s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
  }

  /* A countdown that ticks a display and fires once when it hits zero. Kept dumb
     on purpose: the drill decides what "expired" means (it calls its own finish),
     the timer just watches the clock. */
  function makeTimer(seconds, onTick, onExpire) {
    var iv = null, endAt = 0, done = false;
    function tick() {
      var rem = Math.max(0, endAt - performance.now());
      onTick(rem);
      if (rem <= 0 && !done) { done = true; stop(); onExpire(); }
    }
    function stop() { if (iv) { clearInterval(iv); iv = null; } }
    return {
      start: function () { done = false; endAt = performance.now() + seconds * 1000; tick(); iv = setInterval(tick, 200); },
      stop: stop
    };
  }

  /* Wire a sprint toggle + countdown onto a drill.

       els        { sprintBtn, clock } — the toggle button and clock <span>
       secs       sprint length in seconds
       isRunning  () => bool, so a live run can't be toggled out from under itself
       onToggle   (sprint) => void, called when the mode flips (drill resets its UI)
       onExpire   () => void, called once when the buzzer goes (drill calls finish)

     Returns { isSprint, startClock, stopClock, timer }. Toggling mid-run is
     ignored — Restart is how you change your mind. */
  /* Monochrome button icons, drawn rather than set as emoji. ⏱ renders as a full
     colour glyph on Apple platforms with no way to desaturate it, which clashed
     beside the stroked Hints icon. Stroked with currentColor, these follow the
     button's own colour through light/dark and the on/off state. */
  var ICO = 'class="drill-btn-ico" viewBox="0 0 24 24" width="14" height="14" ' +
            'fill="none" stroke="currentColor" stroke-width="1.9" ' +
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var STOPWATCH_ICON =
    "<svg " + ICO + '><circle cx="12" cy="13.6" r="7.6"/>' +
    '<path d="M12 9.8v3.8l2.4 1.6"/><path d="M9.4 2.6h5.2"/><path d="M12 2.6v3.4"/>' +
    '<path d="m18.7 6.1 1.5-1.5"/></svg>';
  var INFINITY_ICON =
    "<svg " + ICO + '><path d="M8.3 15.2a3.2 3.2 0 1 1 0-6.4c2.6 0 4.1 6.4 6.7 6.4a3.2 3.2 0 1 0 0-6.4' +
    'c-2.6 0-4.1 6.4-6.7 6.4Z"/></svg>';

  function sprintControls(els, secs, isRunning, onToggle, onExpire) {
    var sprintBtn = els.sprintBtn, clock = els.clock;
    var sprint = false, timer = null;
    function faceLabel(isSprint) {
      return isSprint
        ? INFINITY_ICON + '<span class="drill-btn-txt">Untimed</span>'
        : STOPWATCH_ICON + '<span class="drill-btn-txt">' + secs + "s sprint</span>";
    }
    sprintBtn.innerHTML = faceLabel(false);
    sprintBtn.onclick = function () {
      if (isRunning()) return;
      sprint = !sprint;
      sprintBtn.innerHTML = faceLabel(sprint);
      clock.style.display = sprint ? "" : "none";
      clock.classList.remove("drill-clock-low");
      clock.textContent = mmss(secs * 1000);
      onToggle(sprint);
    };
    return {
      isSprint: function () { return sprint; },
      startClock: function () {
        if (!sprint) return null;
        if (timer) timer.stop();
        clock.style.display = "";
        timer = makeTimer(secs, function (rem) {
          clock.textContent = mmss(rem);
          clock.classList.toggle("drill-clock-low", rem <= 10000);
        }, onExpire);
        timer.start();
        return timer;
      },
      stopClock: function () { if (timer) { timer.stop(); timer = null; } },
      timer: function () { return timer; }
    };
  }

  window.DrillCore = { mmss: mmss, makeTimer: makeTimer, sprintControls: sprintControls };
})();
