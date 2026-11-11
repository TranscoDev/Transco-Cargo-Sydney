/*
 * Chat typing boxes: a long message wraps onto new lines and the box grows
 * (up to about 5 lines, then scrolls) instead of running off to the side.
 * Enter sends; Shift+Enter starts a new line.
 *
 *   TranscoChatGrow.attach(textarea, send, sendButton)
 */
(function () {
  var MAX = 132; // px — about 5 lines

  function style() {
    if (document.getElementById("tc-grow-style")) return;
    var s = document.createElement("style");
    s.id = "tc-grow-style";
    s.textContent =
      "textarea.tc-grow{resize:none;min-width:0;display:block;line-height:1.35;overflow-x:hidden;overflow-y:hidden;white-space:pre-wrap;max-height:" + MAX + "px;}" +
      "textarea.tc-grow::placeholder{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".tc-grow-row{align-items:flex-end;}";
    document.head.appendChild(s);
  }

  function attach(box, send, sendBtn) {
    if (!box || box.tagName !== "TEXTAREA" || box.dataset.grow) return function () {};
    box.dataset.grow = "1";
    style();
    box.classList.add("tc-grow");
    if (box.parentNode) box.parentNode.classList.add("tc-grow-row");

    function fit() {
      box.style.height = "auto";
      // Not on screen yet (chat closed / still being built): keep the
      // natural one-line height — measuring now would give 0.
      if (!box.scrollHeight) { box.style.height = ""; return; }
      var h = box.scrollHeight + (box.offsetHeight - box.clientHeight);
      box.style.height = Math.min(h, MAX) + "px";
      box.style.overflowY = h > MAX ? "auto" : "hidden";
    }
    var later = function () { setTimeout(fit, 0); };

    box.addEventListener("input", fit);
    box.addEventListener("focus", fit);
    box.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
        later();
      }
    });
    if (sendBtn) sendBtn.addEventListener("click", later);
    if (box.form) box.form.addEventListener("submit", later);
    window.addEventListener("resize", fit);
    fit();
    return fit;
  }

  window.TranscoChatGrow = { attach: attach };
})();
