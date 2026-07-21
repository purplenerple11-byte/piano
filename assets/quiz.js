/* Reusable retrieval-practice widget for CLEP Precalculus lessons.
   Usage: <div class="retrieval-quiz" data-quiz="quiz-name"></div>
   plus a matching <script type="application/json" id="quiz-name">[...]</script>
   Item shape: { q: "prompt", a: "exact answer", choices: ["optional","multiple","choice"] }
   Omit `choices` for a typed short-answer item (case-insensitive, trimmed match).

   Choices are SHUFFLED at render time, so authors may list the correct answer
   first in the JSON without leaking position as a cue. Never rely on choice
   order being stable. */
(function () {
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function renderQuiz(container) {
    var dataId = container.getAttribute("data-quiz");
    var dataEl = document.getElementById(dataId);
    if (!dataEl) return;
    var items = JSON.parse(dataEl.textContent);
    var idx = 0;
    var score = 0;

    var wrap = document.createElement("div");
    wrap.className = "quiz-box";
    container.appendChild(wrap);

    function checkText(userVal, correct) {
      return userVal.trim().toLowerCase() === correct.trim().toLowerCase();
    }

    function renderItem() {
      wrap.innerHTML = "";
      if (idx >= items.length) {
        var done = document.createElement("div");
        done.className = "quiz-done";
        done.textContent = "Score: " + score + " / " + items.length;
        wrap.appendChild(done);
        var retry = document.createElement("button");
        retry.className = "quiz-btn";
        retry.textContent = "Retry";
        retry.onclick = function () { idx = 0; score = 0; renderItem(); };
        wrap.appendChild(retry);
        return;
      }
      var item = items[idx];
      var progress = document.createElement("div");
      progress.className = "quiz-progress";
      progress.textContent = (idx + 1) + " / " + items.length;
      wrap.appendChild(progress);

      var q = document.createElement("div");
      q.className = "quiz-q";
      q.textContent = item.q;
      wrap.appendChild(q);

      var feedback = document.createElement("div");
      feedback.className = "quiz-feedback";

      function showFeedback(correct) {
        feedback.style.display = "block";
        feedback.className = "quiz-feedback " + (correct ? "quiz-good" : "quiz-bad");
        feedback.textContent = correct ? "Correct." : "Not quite — answer: " + item.a;
        if (correct) score++;
        var next = document.createElement("button");
        next.className = "quiz-btn quiz-next";
        next.textContent = idx + 1 < items.length ? "Next" : "See score";
        next.onclick = function () { idx++; renderItem(); };
        wrap.appendChild(next);
      }

      if (item.choices && item.choices.length) {
        var choiceWrap = document.createElement("div");
        choiceWrap.className = "quiz-choices";
        if (!item._shuffled) {
          item._shuffled = shuffle(item.choices);
        }
        item._shuffled.forEach(function (choice) {
          var btn = document.createElement("button");
          btn.className = "quiz-choice-btn";
          btn.textContent = choice;
          btn.onclick = function () {
            Array.prototype.forEach.call(choiceWrap.children, function (b) { b.disabled = true; });
            showFeedback(checkText(choice, item.a));
          };
          choiceWrap.appendChild(btn);
        });
        wrap.appendChild(choiceWrap);
      } else {
        var form = document.createElement("form");
        form.className = "quiz-form";
        var input = document.createElement("input");
        input.type = "text";
        input.className = "quiz-input";
        input.autocomplete = "off";
        input.spellcheck = false;
        var submit = document.createElement("button");
        submit.type = "submit";
        submit.className = "quiz-btn";
        submit.textContent = "Check";
        form.appendChild(input);
        form.appendChild(submit);
        form.onsubmit = function (e) {
          e.preventDefault();
          input.disabled = true;
          submit.disabled = true;
          showFeedback(checkText(input.value, item.a));
        };
        wrap.appendChild(form);
      }

      wrap.appendChild(feedback);
    }

    renderItem();
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".retrieval-quiz").forEach(renderQuiz);
  });
})();
