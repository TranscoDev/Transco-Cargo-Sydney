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
          var played = { url: URL.createObjectURL(blob), seconds: seconds };
          toBase64(blob).then(function (data) { send({ data: data, mimeType: mime.split(";")[0] }, played); });
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

  // ---------- the customer's own voice note, shown like WhatsApp ----------
  // bubble(el, src, seconds): turns a chat bubble into ▶ wave 0:04. src is a
  // URL or a Promise of one (My Transco fetches it with the sign-in token).
  // heard(text[, el]): the small "I heard: …" line under it (the last
  // bubble by default), so a wrong word is easy to spot without a second
  // message repeating it.
  var lastBubble = null;

  function addBubbleStyle() {
    if (document.getElementById("tc-vn-style")) return;
    var s = document.createElement("style");
    s.id = "tc-vn-style";
    s.textContent =
      ".tc-vn{display:flex;align-items:center;gap:10px;min-width:190px}" +
      ".tc-vn-play{flex-shrink:0;width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;font-size:13px;line-height:1;" +
      "display:inline-flex;align-items:center;justify-content:center;padding:0;color:inherit;background:currentColor}" +
      ".tc-vn-play span{filter:invert(1);mix-blend-mode:normal}" +
      ".tc-vn-play:disabled{opacity:.4;cursor:default}" +
      ".tc-vn-wave{flex:1;display:flex;align-items:center;gap:2px;height:24px}" +
      ".tc-vn-wave i{flex:1;max-width:4px;border-radius:2px;background:currentColor;opacity:.35;transition:opacity .15s}" +
      ".tc-vn-wave i.on{opacity:.95}" +
      ".tc-vn-time{flex-shrink:0;font-size:12px;opacity:.8;font-variant-numeric:tabular-nums}" +
      ".tc-vn-heard{margin-top:6px;font-size:12.5px;line-height:1.4;opacity:.75}";
    document.head.appendChild(s);
  }

  var PLAY = "▶︎"; // ▶ as a plain symbol, not the iPhone emoji
  function fmtTime(n) { n = Math.max(0, Math.round(n || 0)); return Math.floor(n / 60) + ":" + ("0" + (n % 60)).slice(-2); }

  function bubble(el, src, seconds) {
    addBubbleStyle();
    el.innerHTML = "";
    var row = document.createElement("div");
    row.className = "tc-vn";
    var play = document.createElement("button");
    play.type = "button";
    play.className = "tc-vn-play";
    play.setAttribute("aria-label", "Play voice message");
    var icon = document.createElement("span");
    icon.textContent = PLAY;
    play.appendChild(icon);
    play.disabled = true;
    var wave = document.createElement("span");
    wave.className = "tc-vn-wave";
    var bars = [];
    for (var i = 0; i < 22; i++) {
      var b = document.createElement("i");
      b.style.height = (6 + Math.round(16 * Math.abs(Math.sin(i * 1.7 + 0.6)))) + "px";
      wave.appendChild(b);
      bars.push(b);
    }
    var time = document.createElement("span");
    time.className = "tc-vn-time";
    time.textContent = seconds ? fmtTime(seconds) : "";
    row.appendChild(play); row.appendChild(wave); row.appendChild(time);
    el.appendChild(row);
    lastBubble = el;

    var audio = null, total = seconds || 0;
    function paint() {
      var p = audio && total ? audio.currentTime / total : 0;
      bars.forEach(function (bar, k) { bar.className = k / bars.length < p ? "on" : ""; });
    }
    Promise.resolve(src).then(function (url) {
      audio = new Audio(url);
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", function () {
        if (isFinite(audio.duration) && audio.duration > 0) { total = audio.duration; time.textContent = fmtTime(total); }
      });
      audio.addEventListener("timeupdate", function () { paint(); if (total) time.textContent = fmtTime(total - audio.currentTime); });
      audio.addEventListener("ended", function () { icon.textContent = PLAY; audio.currentTime = 0; paint(); time.textContent = fmtTime(total); });
      play.disabled = false;
    }).catch(function () {
      time.textContent = "—";
    });
    play.addEventListener("click", function () {
      if (!audio) return;
      if (audio.paused) { audio.play(); icon.textContent = "❚❚"; }
      else { audio.pause(); icon.textContent = PLAY; }
    });
    return el;
  }

  function heard(text, el, label) {
    el = el || lastBubble;
    if (!el || !text) return;
    var line = document.createElement("div");
    line.className = "tc-vn-heard";
    line.textContent = (label || "I heard") + ': "' + text + '"';
    el.appendChild(line);
  }

  window.TranscoChatVoice = { attach: attach, bubble: bubble, heard: heard };
})();
