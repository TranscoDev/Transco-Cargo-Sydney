// 🎤 Voice message button for the website chat (every page with the
// assistant). Like WhatsApp: tap 🎤 to start recording, then ➤ to send or
// × to cancel. Stops by itself at 2 minutes. The server hears it
// (voiceHear.js — Sinhala, Tamil, English or a mix), answers it like a
// typed message and keeps the recording privately for staff.
//
// Usage, after the page's chat input exists:
//   TranscoChatVoice.attach(inputEl, function (voice) { ... })
// voice = { data: base64, mimeType: "audio/webm" | "audio/mp4" | ... }.
// Browsers that can't record (very old ones) just don't get the button.
(function () {
  var MAX_SECONDS = 120;
  var TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function pickType() {
    for (var i = 0; i < TYPES.length; i++) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(TYPES[i])) return TYPES[i];
    }
    return "";
  }

  function addStyle() {
    if (document.getElementById("tc-voice-style")) return;
    var s = document.createElement("style");
    s.id = "tc-voice-style";
    s.textContent =
      ".tc-voice-btn{flex-shrink:0;width:42px;height:42px;border-radius:50%;border:1px solid #d7dbd9;background:#fff;" +
      "cursor:pointer;font-size:18px;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}" +
      ".tc-voice-btn:hover{border-color:#1d3557}.tc-voice-btn:disabled{opacity:.5;cursor:default}" +
      ".tc-voice-bar{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid #e3e6e4;background:#fdf3f2;font-size:14px;color:#4a5550}" +
      ".tc-voice-dot{width:10px;height:10px;border-radius:50%;background:#d93025;flex-shrink:0;animation:tcVoicePulse 1s ease-in-out infinite}" +
      "@keyframes tcVoicePulse{50%{opacity:.25}}" +
      ".tc-voice-bar span{flex:1;min-width:0}" +
      ".tc-voice-time{font-variant-numeric:tabular-nums;font-weight:600;color:#1d3557}" +
      ".tc-voice-cancel,.tc-voice-send{flex-shrink:0;height:34px;border-radius:17px;border:none;cursor:pointer;font-size:14px;padding:0 14px;font-family:inherit}" +
      ".tc-voice-cancel{background:#e3e6e4;color:#333}.tc-voice-send{background:#1d3557;color:#fff;font-weight:600}";
    document.head.appendChild(s);
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { var u = String(r.result); resolve(u.slice(u.indexOf(",") + 1)); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function attach(input, send, texts) {
    if (!supported() || !input || !input.parentNode || input.getAttribute("data-voice")) return;
    input.setAttribute("data-voice", "1");
    addStyle();
    var t = texts || {};

    var row = input.parentNode;
    var recorder = null, stream = null, chunks = [], timer = null, seconds = 0, bar = null, keep = false;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tc-voice-btn";
    btn.title = t.record || "Send a voice message";
    btn.setAttribute("aria-label", t.record || "Send a voice message");
    btn.textContent = "🎤";

    function fmt(n) { return Math.floor(n / 60) + ":" + ("0" + (n % 60)).slice(-2); }

    function cleanUp() {
      if (timer) clearInterval(timer);
      timer = null;
      if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); });
      stream = null;
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
      bar = null;
      btn.disabled = false;
      input.disabled = false;
    }

    function stop(send) {
      keep = send;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else cleanUp();
    }

    function showBar() {
      bar = document.createElement("div");
      bar.className = "tc-voice-bar";
      var dot = document.createElement("i");
      dot.className = "tc-voice-dot";
      var label = document.createElement("span");
      label.textContent = (t.recording || "Recording…") + " ";
      var time = document.createElement("b");
      time.className = "tc-voice-time";
      time.textContent = "0:00";
      label.appendChild(time);
      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "tc-voice-cancel";
      cancel.textContent = "×";
      cancel.setAttribute("aria-label", t.cancel || "Cancel");
      cancel.addEventListener("click", function () { stop(false); });
      var go = document.createElement("button");
      go.type = "button";
      go.className = "tc-voice-send";
      go.textContent = (t.send || "Send") + " ➤";
      go.addEventListener("click", function () { stop(true); });
      bar.appendChild(dot);
      bar.appendChild(label);
      bar.appendChild(cancel);
      bar.appendChild(go);
      if (row.parentNode) row.parentNode.insertBefore(bar, row);
      timer = setInterval(function () {
        seconds++;
        time.textContent = fmt(seconds);
        if (seconds >= MAX_SECONDS) stop(true);
      }, 1000);
    }

    btn.addEventListener("click", function () {
      btn.disabled = true;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s;
        var type = pickType();
        recorder = type ? new MediaRecorder(s, { mimeType: type }) : new MediaRecorder(s);
        chunks = [];
        seconds = 0;
        keep = false;
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = function () {
          var mime = (recorder.mimeType || type || "audio/webm").toLowerCase();
          var blob = new Blob(chunks, { type: mime });
          var tooShort = seconds < 1;
          cleanUp();
          if (!keep) return;
          if (tooShort || !blob.size) { alert(t.tooShort || "That was too short — hold on a little longer and try again."); return; }
          toBase64(blob).then(function (data) { send({ data: data, mimeType: mime.split(";")[0] }); });
        };
        recorder.start();
        input.disabled = true;
        showBar();
      }).catch(function () {
        btn.disabled = false;
        alert(t.noMic || "Please allow the microphone to send a voice message, or type your question instead.");
      });
    });

    row.insertBefore(btn, input);
  }

  window.TranscoChatVoice = { attach: attach };
})();
