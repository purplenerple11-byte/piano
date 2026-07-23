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

  /* Pick how to notate a set of pitches. All at or above middle C → treble; all
     below → bass; straddling it → "auto" per-note on a grand staff. Returns the
     note-clef the drill uses and the clefs the staff should draw. */
  function clefInfo(midis) {
    var min = Math.min.apply(null, midis), max = Math.max.apply(null, midis);
    if (min >= 60) return { note: "treble", staff: "treble" };
    if (max < 60) return { note: "bass", staff: "bass" };
    return { note: "auto", staff: "both" };
  }

  // Build a self-contained play-along block: staff + keyboard + drill, wired up.
  function block(parent, opts) {
    var staff = makeStaff(opts.id + "-staff", opts.staffClefs);
    var kb = makeKeyboard(opts.id + "-kb", opts.allNotes);
    var drill = el("div");
    drill.setAttribute("data-staffdrill", "");
    drill.setAttribute("data-staff", staff.id);
    drill.setAttribute("data-kb", kb.id);
    drill.setAttribute("data-title", opts.title);
    if (opts.caption) drill.setAttribute("data-caption", opts.caption);
    if (opts.notes) {
      drill.setAttribute("data-notes", opts.notes.join(" "));
      drill.setAttribute("data-clef", opts.noteClef);
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

  /* A both-hands, chord-graded play-along. Each column is a chord (notes in either
     hand); it's satisfied when every note has been struck, in any order, and only
     then does the cursor move on — playing a chord is agreeing on one moment, not
     an ordered run. Built on staff.duet (which now stacks chords) plus its own
     small grader, kept separate from Lesson 5's DuetDrill so neither disturbs the
     other. */
  function chordBlock(parent, opts) {
    var all = [];
    opts.columns.forEach(function (c) {
      (c.treble || []).forEach(function (n) { all.push(n); });
      (c.bass || []).forEach(function (n) { all.push(n); });
    });
    var staff = makeStaff(opts.id + "-staff", "both");
    var kb = makeKeyboard(opts.id + "-kb", all);
    var box = el("div", "drill-box");
    box.appendChild(el("div", "drill-label", opts.title));
    var sub = el("div", "drill-sub");
    sub.style.textAlign = "center"; sub.style.minHeight = "1.4rem";
    box.appendChild(sub);
    var controls = el("div", "drill-controls");
    var startBtn = el("button", "drill-btn"); startBtn.textContent = "Start";
    controls.appendChild(startBtn);
    box.appendChild(controls);
    var stats = el("div", "drill-stats"); box.appendChild(stats);
    if (opts.caption) box.appendChild(el("div", "drill-caption", opts.caption));

    parent.appendChild(staff);
    parent.appendChild(kb);
    parent.appendChild(box);
    window.StaffWidget.build(staff);
    window.KeyboardWidget.build(kb);
    var st = staff.staff, kbApi = kb.keyboard;

    var running = false, line = null, pos = 0, pending = [], doneCols = 0, cleanCols = 0, colErr = false;
    var total = opts.columns.length;

    function renderStats() {
      var acc = doneCols ? Math.round(cleanCols * 100 / doneCols) + "%" : "—";
      stats.innerHTML = "";
      [["Chord", Math.min(pos + (running ? 1 : 0), total) + " / " + total],
       ["Chords clean", acc]].forEach(function (p) {
        var d = el("div", "drill-stat");
        d.innerHTML = '<span class="drill-stat-val">' + p[1] + '</span><span class="drill-stat-key">' + p[0] + "</span>";
        stats.appendChild(d);
      });
    }
    function arm() {
      pending = line.notesAt(pos).map(function (nt) { return { hand: nt.hand, midi: nt.midi, done: false }; });
      colErr = false;
      line.cursor(pos);
      if (kbApi) kbApi.clear();
    }
    function finish() {
      running = false;
      line.cursor(null);
      var acc = doneCols ? cleanCols / doneCols : 0;
      sub.className = "drill-sub";
      sub.innerHTML = "<strong>" + Math.round(acc * 100) + "%</strong> of chords clean. " +
        (acc >= 0.9 ? "That's the progression, both hands." :
         acc >= 0.7 ? "Close — loop the chords that fought back." :
         "Take it a chord at a time; there's no clock here.");
      startBtn.textContent = "Restart";
      renderStats();
    }
    startBtn.onclick = function () {
      running = true; startBtn.textContent = "Restart";
      doneCols = 0; cleanCols = 0; pos = 0;
      line = st.duet(opts.columns);
      arm();
      sub.className = "drill-sub";
      sub.textContent = "Play each chord — both hands. The notes can go down in any order.";
      renderStats();
    };
    window.PianoMIDI.subscribe(function (e) {
      if (!running || !e.on || !pending.length) return;
      var want = null;
      for (var i = 0; i < pending.length; i++) {
        if (!pending[i].done && pending[i].midi === e.note) { want = pending[i]; break; }
      }
      if (!want) {
        colErr = true;
        if (kbApi) kbApi.mark(e.note, "kbd-bad");
        sub.className = "drill-sub drill-sub-bad";
        sub.textContent = "Not in this chord — play the notes shown, then the cursor moves on.";
        return;
      }
      want.done = true;
      line.markNote(pos, want.hand, want.midi, "staff-note-good");
      if (kbApi) kbApi.mark(want.midi, "kbd-good");
      if (pending.some(function (p) { return !p.done; })) {
        sub.className = "drill-sub";
        return;
      }
      doneCols++; if (!colErr) cleanCols++;
      pos++;
      renderStats();
      pending = [];   // ignore stray keys during the brief gap before the next chord
      if (pos >= line.length) { setTimeout(finish, 300); return; }
      setTimeout(arm, 300);
    });

    renderStats();
    sub.textContent = "Press Start. Each column is a chord — play all of its notes together.";
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
      var ci = clefInfo(sec.notes);
      var wrap = el("div", "song-section");
      wrap.appendChild(el("h3", null, sec.title || ("Phrase " + (i + 1))));
      if (sec.note) wrap.appendChild(el("p", "song-note", sec.note));
      mount.appendChild(wrap);
      block(wrap, {
        id: idBase + "-s" + i,
        staffClefs: ci.staff,
        noteClef: ci.note,
        notes: sec.notes,
        allNotes: sec.notes,
        title: sec.title || ("Phrase " + (i + 1)),
        caption: sec.caption || "Play the line as the cursor reaches each note. Turn on Hints if a position won't stick."
      });
    });

    // Full play-along: every section's line, in order, with the feedback toggle.
    var all = [];
    sections.forEach(function (s) { all = all.concat(s.notes); });
    var wrap2 = el("div", "song-section song-full");
    wrap2.appendChild(el("h3", null, "The whole thing"));
    wrap2.appendChild(el("p", "song-note",
      "Every phrase, back to back. Leave feedback on while you're still learning it; " +
      "switch to <strong>Feedback off</strong> for a real run-through — no marks as you play, " +
      "just your score at the end."));
    mount.appendChild(wrap2);
    block(wrap2, {
      id: idBase + "-full",
      staffClefs: clefInfo(all).staff,
      lines: sections.map(function (s) { return { clef: clefInfo(s.notes).note, notes: s.notes }; }),
      allNotes: all,
      feedbackToggle: true,
      title: "Full play-along",
      caption: "The cursor carries you through the whole song, phrase after phrase."
    });

    // Optional both-hands chord pass: the harmony as block chords, hands together.
    if (song.chords && song.chords.length) {
      var wrap3 = el("div", "song-section song-full");
      wrap3.appendChild(el("h3", null, song.chordsTitle || "Both hands — the chords"));
      if (song.chordsNote) wrap3.appendChild(el("p", "song-note", song.chordsNote));
      mount.appendChild(wrap3);
      chordBlock(wrap3, {
        id: idBase + "-chords",
        columns: song.chords,
        title: "The chord progression",
        caption: "Left hand takes the bass note, right hand the chord above it. Play both hands on each column; the order the notes go down doesn't matter, landing them together does."
      });
    }
  }

  window.SongPlayer = { build: build };
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-song]").forEach(build);
  });
})();
