/* SongPlayer — turns one song description into a guided, play-along page.

   A guided song is taught the way you'd actually learn one: phrase by phrase,
   each short line drilled until it's under the hands, then a full play-along that
   strings them together. The grading, cursor, hints and the performance-mode
   feedback toggle all come from StaffDrill (a song is just the phrase drill with
   its lines pinned); SongPlayer only assembles the staves, keyboards and drills.

   Mount:
     <div data-song data-song-src="song-json"></div>
     <script type="application/json" id="song-json">
       { "sections": [
           { "title": "Phrase 1 — right hand", "clef": "treble",
             "notes": [64, 62, 60, 62, 64, 64, 64], "note": "optional guidance" },
           ...
       ] }
     </script>

   notes are MIDI numbers (60 = middle C). Each section is one clef / one hand;
   the full play-along at the end plays every section's line in order. */
(function () {
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  /* A keyboard must start on a C. Snap the range down to the C at or below the
     lowest note and up to the C at or above the highest, so every note in the
     line has a key — and no more keyboard than the song needs. */
  function keyboardRange(midis) {
    var min = Math.min.apply(null, midis), max = Math.max.apply(null, midis);
    var lo = min - (((min % 12) + 12) % 12);
    var hi = max + ((12 - (((max % 12) + 12) % 12)) % 12);
    if (hi <= lo) hi = lo + 12;
    return { from: lo, octaves: Math.max(1, Math.round((hi - lo) / 12)) };
  }

  function makeKeyboard(id, midis) {
    var range = keyboardRange(midis);
    var d = el("div");
    d.id = id;
    d.setAttribute("data-keyboard", "");
    d.setAttribute("data-from", range.from);
    d.setAttribute("data-octaves", range.octaves);
    d.setAttribute("data-labels", "none");
    d.setAttribute("data-groups", "true");
    d.setAttribute("data-interactive", "true");
    return d;
  }

  function makeStaff(id, clefs) {
    var d = el("div");
    d.id = id;
    d.setAttribute("data-staff", "");
    d.setAttribute("data-clefs", clefs);
    return d;
  }

  // Build a self-contained play-along block: staff + keyboard + drill, wired up.
  function block(parent, opts) {
    var staff = makeStaff(opts.id + "-staff", opts.clefs);
    var kb = makeKeyboard(opts.id + "-kb", opts.allNotes);
    var drill = el("div");
    drill.setAttribute("data-staffdrill", "");
    drill.setAttribute("data-staff", staff.id);
    drill.setAttribute("data-kb", kb.id);
    drill.setAttribute("data-title", opts.title);
    if (opts.caption) drill.setAttribute("data-caption", opts.caption);
    if (opts.notes) {
      drill.setAttribute("data-notes", opts.notes.join(" "));
      drill.setAttribute("data-clef", opts.clefs);
    }
    if (opts.lines) drill.setAttribute("data-lines", JSON.stringify(opts.lines));
    if (opts.feedbackToggle) drill.setAttribute("data-feedback-toggle", "true");

    parent.appendChild(staff);
    parent.appendChild(kb);
    parent.appendChild(drill);
    window.StaffWidget.build(staff);
    window.KeyboardWidget.build(kb);
    window.StaffDrill.build(drill);
  }

  function build(mount) {
    var srcId = mount.getAttribute("data-song-src");
    var srcEl = srcId && document.getElementById(srcId);
    if (!srcEl) { console.error("SongPlayer: no song data for", mount); return; }
    var song = JSON.parse(srcEl.textContent);
    var sections = song.sections || [];
    if (!sections.length) return;

    mount.innerHTML = "";
    var idBase = mount.id || "song";

    // Phrase-by-phrase build-up: one block per section.
    sections.forEach(function (sec, i) {
      var wrap = el("div", "song-section");
      wrap.appendChild(el("h3", null, sec.title || ("Phrase " + (i + 1))));
      if (sec.note) wrap.appendChild(el("p", "song-note", sec.note));
      mount.appendChild(wrap);
      block(wrap, {
        id: idBase + "-s" + i,
        clefs: sec.clef || "treble",
        notes: sec.notes,
        allNotes: sec.notes,
        title: sec.title || ("Phrase " + (i + 1)),
        caption: sec.caption || "Play the line as the cursor reaches each note. Turn on 💡 Hints if a position won't stick."
      });
    });

    // Full play-along: every section's line, in order, with the feedback toggle.
    var clefs = sections.every(function (s) { return (s.clef || "treble") === "treble"; }) ? "treble"
              : sections.every(function (s) { return s.clef === "bass"; }) ? "bass" : "both";
    var all = [];
    sections.forEach(function (s) { all = all.concat(s.notes); });
    var wrap2 = el("div", "song-section song-full");
    wrap2.appendChild(el("h3", null, "The whole thing"));
    wrap2.appendChild(el("p", "song-note",
      "Every phrase, back to back. Leave feedback on while you're still learning it; " +
      "switch to <strong>🙈 Feedback off</strong> for a real run-through — no marks as you play, " +
      "just your score at the end."));
    mount.appendChild(wrap2);
    block(wrap2, {
      id: idBase + "-full",
      clefs: clefs,
      lines: sections.map(function (s) { return { clef: s.clef || "treble", notes: s.notes }; }),
      allNotes: all,
      feedbackToggle: true,
      title: "Full play-along",
      caption: "The cursor carries you through the whole song, phrase after phrase."
    });
  }

  window.SongPlayer = { build: build };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-song]").forEach(build);
  });
})();
