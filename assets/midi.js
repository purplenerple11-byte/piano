/* PianoMIDI — shared input layer for every lesson in this workspace.
   https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API

   Usage:
     <div data-midi-bar></div>            <!-- status + connect button, auto-rendered -->
     PianoMIDI.subscribe(function (e) {   // e = { note, velocity, on, name, pc, source }
       if (e.on) ...
     });

   Facts that drive the design of this file:

     1. requestMIDIAccess() needs a SECURE CONTEXT — file:// will not work.
        Serve over http://localhost (a secure context by spec) or HTTPS.
     2. It needs explicit user permission, so connection is button-driven.
     3. Support is not Baseline. Apple declined Web MIDI in 2020 over
        fingerprinting and there is still no roadmap, so NO browser on iOS
        supports it — every iOS browser is required to use WebKit.
     4. On iPad the one route to real MIDI is the Web MIDI Browser app, which
        injects a polyfill derived from Chris Wilson's WebMIDIAPIShim. That
        polyfill is old, so this file must not assume the modern spec shape —
        see normaliseInputs() and the late-injection poll below.

   Every drill also works from taps on the on-screen keyboard, so none of this
   failing ever ends a lesson.

   Note numbers: 60 = middle C (C4). Pitch class = note % 12. */
(function () {
  var subscribers = [];
  var access = null;
  var state = "idle"; // idle|connecting|connected|nodevice|denied|unsupported|ios|insecure
  var detail = "";
  var deviceNames = [];
  var bars = [];
  var pollsLeft = 0;
  var pollTimer = null;

  /* iPadOS reports itself as "Macintosh", so a userAgent test alone misses the
     iPad — the touch-point count is what separates it from a real Mac. The
     advice differs by platform: on a desktop browser without Web MIDI the fix
     is "use Chrome", and on iOS Chrome is no better than Safari. */
  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

  var SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  var FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

  function pitchClass(note) { return ((note % 12) + 12) % 12; }
  function octaveOf(note) { return Math.floor(note / 12) - 1; }  // 60 -> 4

  function nameOf(note, prefer) {
    return (prefer === "flat" ? FLAT_NAMES : SHARP_NAMES)[pitchClass(note)];
  }

  function hasMIDI() { return typeof navigator.requestMIDIAccess === "function"; }

  /* GitHub Pages is HTTPS, so isSecureContext should be true — but the Web MIDI
     Browser webview is a decade old and we accept an explicit https: origin as
     equivalent rather than refusing to try. */
  function isSecure() {
    return window.isSecureContext === true || location.protocol === "https:";
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
      note: note, velocity: vel, on: isOn,
      pc: pitchClass(note), octave: octaveOf(note), name: nameOf(note),
      source: "midi"
    });
  }

  /* MIDIAccess.inputs has had three shapes in the wild:
       - a Map (current spec)                          -> .forEach / .values()
       - a plain Array (early spec, and old shims)      -> .forEach
       - absent, with a getInputs() method instead      -> older still
     The Web MIDI Browser polyfill predates the current spec, so assuming a Map
     would silently find zero devices on the one platform this matters most on.
     Returns a plain array either way. */
  function normaliseInputs(a) {
    if (!a) return [];
    var list = [];
    var src = a.inputs;
    if (!src && typeof a.getInputs === "function") src = a.getInputs();
    if (!src) return [];
    if (typeof src.forEach === "function") {
      // Map.forEach gives (value, key); Array.forEach gives (value, index).
      // The first argument is the input in both cases.
      src.forEach(function (input) { if (input) list.push(input); });
    } else if (typeof src.length === "number") {
      for (var i = 0; i < src.length; i++) list.push(src[i]);
    } else if (typeof src.values === "function") {
      var it = src.values(), step = it.next();
      while (!step.done) { list.push(step.value); step = it.next(); }
    }
    return list;
  }

  function bindInputs() {
    var inputs = normaliseInputs(access);
    deviceNames = [];
    inputs.forEach(function (input) {
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
    if (!isSecure()) { setState("insecure"); return; }
    // Re-check every time: on iOS a polyfill may have arrived since last try.
    if (!hasMIDI()) { setState(IS_IOS ? "ios" : "unsupported"); return; }
    setState("connecting");

    function ok(a) {
      access = a;
      a.onstatechange = bindInputs;
      bindInputs();
    }
    function fail(err) {
      setState("denied", err && err.message ? err.message : "");
    }
    /* Some builds of the iOS shim only grant access when SysEx is requested
       (reported repeatedly in the app's reviews). Try the cheap, no-prompt call
       first and only escalate if it is refused. */
    try {
      navigator.requestMIDIAccess().then(ok, function () {
        try {
          navigator.requestMIDIAccess({ sysex: true }).then(ok, fail);
        } catch (e2) { fail(e2); }
      });
    } catch (e) { fail(e); }
  }

  /* A polyfill injected by a host app may land AFTER DOMContentLoaded. Latching
     to "no MIDI here" on first look would make a working setup appear broken,
     so re-check for a few seconds before settling. */
  function pollForLatePolyfill() {
    if (pollTimer) return;
    pollsLeft = 12;                        // 12 x 250ms = 3s
    pollTimer = setInterval(function () {
      if (hasMIDI()) {
        clearInterval(pollTimer); pollTimer = null;
        connect();
      } else if (--pollsLeft <= 0) {
        clearInterval(pollTimer); pollTimer = null;
      }
    }, 250);
  }

  var MESSAGES = {
    idle: ["", "Plug in your keyboard, then <strong>connect</strong> — the drills below will read what you actually play."],
    connecting: ["", "Asking the browser for MIDI access…"],
    connected: ["on", "Listening to <strong>DEVICE</strong>. Play a key."],
    nodevice: ["off", "MIDI is on, but <strong>no keyboard was found</strong>. Check the cable or Bluetooth pairing and the keyboard's power, then reconnect."],
    denied: ["off", "MIDI access was <strong>refused</strong>. Allow it in the site permissions and reconnect — or just tap the on-screen keys instead."],
    unsupported: ["off", "This browser has <strong>no Web MIDI</strong>. Open the lesson in Chrome or Edge — or tap the on-screen keys instead."],
    ios: ["off", "Safari can't read a MIDI keyboard — Apple has never shipped Web MIDI. To be graded on your real playing here, use the free <a href=\"https://apps.apple.com/us/app/web-midi-browser/id953846217\">Web MIDI Browser</a> app and pair the piano <em>inside</em> it. Otherwise <strong>tap the on-screen keys</strong>. Not working? Open the <a href=\"DIAGHREF\">connection test</a>."],
    insecure: ["off", "Web MIDI needs a <strong>secure context</strong>. This page is on <code>file://</code>; serve the folder with <code>python3 -m http.server</code> and open it via <code>localhost</code>."]
  };

  function renderBar(bar) {
    var spec = MESSAGES[state] || MESSAGES.idle;
    var msg = spec[1]
      .replace("DEVICE", deviceNames.join(", "))
      .replace("DIAGHREF", bar.getAttribute("data-diag") || "diag.html");
    if (state === "denied" && detail) msg += " <span style=\"opacity:.7\">(" + detail + ")</span>";
    bar.innerHTML =
      '<span class="midi-dot ' + (spec[0] ? "midi-dot-" + spec[0] : "") + '"></span>' +
      '<span class="midi-msg">' + msg + "</span>";
    if (state !== "connected") {
      var btn = document.createElement("button");
      btn.className = "midi-btn";
      btn.textContent = state === "connecting" ? "Connecting…" : "Connect keyboard";
      /* Deliberately NOT disabled in the "ios" state. If the user switches to a
         browser that provides MIDI, or a polyfill arrives late, the button is
         the only way back — disabling it strands a setup that actually works. */
      btn.disabled = state === "connecting" || state === "unsupported" || state === "insecure";
      btn.onclick = connect;
      bar.appendChild(btn);
    }
  }

  function initBars() {
    bars = Array.prototype.slice.call(document.querySelectorAll("[data-midi-bar]"));
    bars.forEach(function (b) { b.className = "midi-bar"; });
    if (!isSecure()) { setState("insecure"); return; }
    if (!hasMIDI()) {
      setState(IS_IOS ? "ios" : "unsupported");
      if (IS_IOS) pollForLatePolyfill();
      return;
    }
    /* If permission was granted in an earlier session the browser will not
       prompt again, so connect straight away and skip the pointless button.
       query() can throw SYNCHRONOUSLY on an unrecognised permission name in
       some engines, which would otherwise take out the whole init. */
    try {
      navigator.permissions.query({ name: "midi" }).then(function (res) {
        if (res.state === "granted") connect(); else bars.forEach(renderBar);
      }, function () { bars.forEach(renderBar); });
    } catch (e) {
      bars.forEach(renderBar);
    }
  }

  window.PianoMIDI = {
    subscribe: function (fn) {
      subscribers.push(fn);
      return function () {
        var i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
    /* Lets the on-screen keyboard (or any future input, e.g. microphone pitch
       detection) feed the same event stream as real hardware, so a drill never
       has to know where a note came from. */
    inject: function (note, on, source) {
      emit({ note: note, velocity: on ? 100 : 0, on: on, pc: pitchClass(note),
             octave: octaveOf(note), name: nameOf(note), source: source || "click" });
    },
    connect: connect,
    isConnected: function () { return state === "connected"; },
    state: function () { return state; },
    devices: function () { return deviceNames.slice(); },
    normaliseInputs: normaliseInputs,   // exported so diag.html can reuse it
    isIOS: IS_IOS,
    pitchClass: pitchClass,
    octaveOf: octaveOf,
    nameOf: nameOf,
    SHARP_NAMES: SHARP_NAMES,
    FLAT_NAMES: FLAT_NAMES
  };

  document.addEventListener("DOMContentLoaded", initBars);
})();
