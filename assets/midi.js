/* PianoMIDI — shared Web MIDI connection for every lesson in this workspace.
   https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API

   Usage:
     <div data-midi-bar></div>            <!-- status + connect button, auto-rendered -->
     PianoMIDI.subscribe(function (e) {   // e = { note, velocity, on, name, pc }
       if (e.on) ...
     });

   Three facts from MDN drive the whole design of this file:
     1. requestMIDIAccess() needs a SECURE CONTEXT — file:// will not work.
        Serve the workspace over http://localhost (a secure context by spec) or
        HTTPS. If we're on file://, say so plainly instead of failing silently.
     2. It needs explicit user permission, so connection is button-driven.
     3. Support is not Baseline — Chromium only, in practice. Every drill that
        uses MIDI must also work from clicks on the on-screen keyboard, so a
        missing API degrades the lesson rather than ending it.

   Note numbers: 60 = middle C (C4). Pitch class = note % 12. */
(function () {
  var subscribers = [];
  var access = null;
  var state = "idle"; // idle | connecting | connected | nodevice | denied | unsupported | ios | insecure
  var detail = "";
  var deviceNames = [];
  var bars = [];

  /* iPadOS reports itself as "Macintosh", so a userAgent test alone misses the
     iPad — the touch-point count is what separates it from a real Mac. This
     matters because the advice differs: on a desktop browser without Web MIDI
     the fix is "use Chrome", and on iOS there is no fix at all. Every browser
     on iOS is required to use WebKit, and WebKit has never shipped Web MIDI
     (https://caniuse.com/midi), so Chrome for iOS is no better than Safari.
     Telling an iPad user to install Chrome would waste their time. */
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  var SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  var FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

  function pitchClass(note) { return ((note % 12) + 12) % 12; }
  function octaveOf(note) { return Math.floor(note / 12) - 1; }  // 60 -> 4

  function nameOf(note, prefer) {
    var table = prefer === "flat" ? FLAT_NAMES : SHARP_NAMES;
    return table[pitchClass(note)];
  }

  function emit(evt) {
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](evt); } catch (err) { console.error(err); }
    }
  }

  function onMessage(e) {
    var data = e.data;
    if (!data || data.length < 3) return;
    var cmd = data[0] & 0xf0;
    var note = data[1];
    var vel = data[2];
    // A note-on with velocity 0 is the conventional note-off. Treat it as one.
    var isOn = cmd === 0x90 && vel > 0;
    var isOff = cmd === 0x80 || (cmd === 0x90 && vel === 0);
    if (!isOn && !isOff) return;
    emit({
      note: note,
      velocity: vel,
      on: isOn,
      pc: pitchClass(note),
      octave: octaveOf(note),
      name: nameOf(note),
      source: "midi"
    });
  }

  function bindInputs() {
    if (!access) return;
    deviceNames = [];
    access.inputs.forEach(function (input) {
      input.onmidimessage = onMessage;
      deviceNames.push(input.name || "unnamed device");
    });
    setState(deviceNames.length ? "connected" : "nodevice");
  }

  function setState(next, extra) {
    state = next;
    detail = extra || "";
    bars.forEach(renderBar);
  }

  function connect() {
    if (state === "connecting" || state === "connected") return;
    if (!window.isSecureContext) { setState("insecure"); return; }
    if (!navigator.requestMIDIAccess) { setState(IS_IOS ? "ios" : "unsupported"); return; }
    setState("connecting");
    navigator.requestMIDIAccess().then(function (a) {
      access = a;
      a.onstatechange = bindInputs;
      bindInputs();
    }, function (err) {
      setState("denied", err && err.message ? err.message : "");
    });
  }

  var MESSAGES = {
    idle: ["", "Plug in your keyboard, then <strong>connect</strong> — the drills below will read what you actually play."],
    connecting: ["", "Asking the browser for MIDI access…"],
    connected: ["on", "Listening to <strong>DEVICE</strong>. Play a key."],
    nodevice: ["off", "MIDI is on, but <strong>no keyboard was found</strong>. Check the USB cable and the keyboard's power, then reconnect."],
    denied: ["off", "MIDI access was <strong>refused</strong>. Allow it in the site permissions and reconnect — or just click the on-screen keys instead."],
    unsupported: ["off", "This browser has <strong>no Web MIDI</strong>. Open the lesson in Chrome or Edge — or click the on-screen keys instead."],
    ios: ["off", "<strong>iPad and iPhone can't read a MIDI keyboard</strong> — no iOS browser supports Web MIDI, including Chrome, so there is nothing to install. <strong>Tap the on-screen keys</strong> to do the drills here; to be graded on your real playing, open this page on a computer in Chrome."],
    insecure: ["off", "Web MIDI needs a <strong>secure context</strong>. This page is on <code>file://</code>; serve the folder with <code>python3 -m http.server</code> and open it via <code>localhost</code>."]
  };

  function renderBar(bar) {
    var spec = MESSAGES[state] || MESSAGES.idle;
    var msg = spec[1].replace("DEVICE", deviceNames.join(", "));
    if (state === "denied" && detail) msg += " <span style=\"opacity:.7\">(" + detail + ")</span>";
    bar.innerHTML =
      '<span class="midi-dot ' + (spec[0] ? "midi-dot-" + spec[0] : "") + '"></span>' +
      '<span class="midi-msg">' + msg + "</span>";
    if (state !== "connected") {
      var btn = document.createElement("button");
      btn.className = "midi-btn";
      btn.textContent = state === "connecting" ? "Connecting…" : "Connect keyboard";
      btn.disabled = state === "connecting" || state === "unsupported" ||
                     state === "insecure" || state === "ios";
      btn.onclick = connect;
      bar.appendChild(btn);
    }
  }

  function initBars() {
    bars = Array.prototype.slice.call(document.querySelectorAll("[data-midi-bar]"));
    bars.forEach(function (b) { b.className = "midi-bar"; });
    if (!window.isSecureContext) { setState("insecure"); return; }
    if (!navigator.requestMIDIAccess) { setState(IS_IOS ? "ios" : "unsupported"); return; }
    // If permission was granted in an earlier session the browser will not
    // prompt again, so connect straight away and skip the pointless button.
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "midi" }).then(function (res) {
        if (res.state === "granted") connect(); else bars.forEach(renderBar);
      }, function () { bars.forEach(renderBar); });
    } else {
      bars.forEach(renderBar);
    }
  }

  window.PianoMIDI = {
    subscribe: function (fn) { subscribers.push(fn); return function () {
      var i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1);
    }; },
    /* Lets the on-screen keyboard feed the same event stream as real hardware,
       so a drill never has to know where a note came from. */
    inject: function (note, on) {
      emit({ note: note, velocity: on ? 100 : 0, on: on, pc: pitchClass(note),
             octave: octaveOf(note), name: nameOf(note), source: "click" });
    },
    connect: connect,
    isConnected: function () { return state === "connected"; },
    pitchClass: pitchClass,
    octaveOf: octaveOf,
    nameOf: nameOf,
    SHARP_NAMES: SHARP_NAMES,
    FLAT_NAMES: FLAT_NAMES
  };

  document.addEventListener("DOMContentLoaded", initBars);
})();
