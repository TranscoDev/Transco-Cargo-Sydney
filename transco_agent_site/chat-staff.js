// Website chat for visitors who aren't signed in (every page with the
// assistant):
//  - the chat is kept in this browser for 7 days (not just this tab), with
//    a long random id, so a visitor who comes back still gets our replies;
//  - once at the start, and again when they ask for the team if they
//    skipped it, the bot's reply carries askContact: we show the My Transco
//    invite and a small name + phone form (POST /api/web-chat/contact);
//  - after a handover (staffWillReply) — or when they come back to a chat
//    staff are on — we check every few seconds for staff replies
//    (POST /api/web-chat/updates) and show them as "Transco team".
//
// Usage on a page:
//   var sessionId = TranscoChatStaff.sessionId(KEY);
//   TranscoChatStaff.start({ api: WIDGET_API_URL, sessionId: sessionId, list: messagesEl, add: function (text) { ... } });
//   ...after each reply: TranscoChatStaff.afterReply(data);
(function () {
  var KEEP_MS = 7 * 24 * 60 * 60 * 1000;
  var CHECK_MS = 8000;
  var ACCOUNT_URL = "https://my.transcosydney.com.au/account.html";
  var opts = null, timer = null;

  function read(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return "agentsite-" + crypto.randomUUID();
    var a = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return "agentsite-" + Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  // { id, at, watch, last } in localStorage, renewed while in use.
  var key = null, state = null;
  function save() { state.at = Date.now(); write(key, state); }
  function sessionId(storageKey) {
    key = storageKey + "_v2";
    state = read(key);
    if (!state || !state.id || Date.now() - (state.at || 0) > KEEP_MS) state = { id: randomId() };
    save();
    return state.id;
  }

  function addStyle() {
    if (document.getElementById("tc-staff-style")) return;
    var s = document.createElement("style");
    s.id = "tc-staff-style";
    s.textContent =
      ".tc-contact{margin:6px 0 10px;padding:12px;border:1px solid #d7dbd9;border-radius:12px;background:#f7f9fb;font-size:14px;color:#24303a;max-width:420px}" +
      ".tc-contact p{margin:0 0 8px;line-height:1.45}" +
      ".tc-contact a.tc-acc{display:inline-block;margin:0 0 10px;padding:8px 14px;border-radius:18px;background:#1d3557;color:#fff;text-decoration:none;font-weight:600}" +
      ".tc-contact input{display:block;width:100%;box-sizing:border-box;margin:0 0 6px;padding:9px 10px;border:1px solid #cfd5d2;border-radius:8px;font:inherit;font-size:16px}" +
      ".tc-contact .tc-row{display:flex;gap:8px;margin-top:4px}" +
      ".tc-contact button{height:36px;padding:0 14px;border-radius:18px;border:none;cursor:pointer;font:inherit;font-size:14px}" +
      ".tc-contact .tc-save{background:#1d3557;color:#fff;font-weight:600}.tc-contact .tc-skip{background:#e3e6e4;color:#333}" +
      ".tc-contact .tc-err{color:#b3261e;font-size:13px;margin:2px 0 6px}";
    document.head.appendChild(s);
  }

  function post(path, body) {
    return fetch(opts.api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j || {} }; }); });
  }

  // ---------- staff replies ----------
  function check() {
    if (!opts || document.hidden) return;
    post("/updates", { sessionId: state.id, after: state.last || undefined }).then(function (r) {
      (r.body.messages || []).forEach(function (m) {
        var text = m.text || "";
        if (m.picture) text += "\n(🖼️ Sign in to My Transco to see pictures: " + ACCOUNT_URL + ")";
        if (m.voice) text += "\n(🎤 Sign in to My Transco to play voice messages: " + ACCOUNT_URL + ")";
        opts.add("👤 Transco team: " + text);
        state.last = m.id;
        state.watch = true;
      });
      save();
    }).catch(function () { /* offline — try again next time */ });
  }
  function watch() {
    state.watch = true;
    save();
    if (!timer) timer = setInterval(check, CHECK_MS);
  }

  function start(o) {
    opts = o;
    // Coming back to a chat staff were on: show any replies since.
    if (state && state.watch) { check(); watch(); }
    document.addEventListener("visibilitychange", function () { if (!document.hidden && state.watch) check(); });
  }

  // ---------- My Transco invite + name/phone form ----------
  function contactForm(stage) {
    addStyle();
    var box = document.createElement("div");
    box.className = "tc-contact";
    var intro = document.createElement("p");
    intro.textContent = stage === "handover"
      ? "Our team will reply here soon. In case you leave this page, we can still reach you this way:"
      : "👋 Get our replies, bookings and tracking anytime with a free My Transco account:";
    var acc = document.createElement("a");
    acc.className = "tc-acc";
    acc.href = ACCOUNT_URL;
    acc.target = "_blank";
    acc.rel = "noopener";
    acc.textContent = "Create free account →";
    var or = document.createElement("p");
    or.textContent = "Or just leave your name and phone number:";
    var name = document.createElement("input");
    name.type = "text"; name.placeholder = "Your name"; name.autocomplete = "name"; name.maxLength = 80;
    var phone = document.createElement("input");
    phone.type = "tel"; phone.placeholder = "Phone number (e.g. 0412 345 678)"; phone.autocomplete = "tel"; phone.maxLength = 30;
    var err = document.createElement("div");
    err.className = "tc-err"; err.hidden = true;
    var row = document.createElement("div");
    row.className = "tc-row";
    var saveBtn = document.createElement("button");
    saveBtn.type = "button"; saveBtn.className = "tc-save"; saveBtn.textContent = "Save";
    var skip = document.createElement("button");
    skip.type = "button"; skip.className = "tc-skip"; skip.textContent = "Skip";
    row.appendChild(saveBtn); row.appendChild(skip);
    [intro, acc, or, name, phone, err, row].forEach(function (el) { box.appendChild(el); });

    function done(reply) {
      if (box.parentNode) box.parentNode.removeChild(box);
      if (reply) opts.add(reply);
    }
    saveBtn.addEventListener("click", function () {
      err.hidden = true;
      saveBtn.disabled = skip.disabled = true;
      post("/contact", { sessionId: state.id, name: name.value, phone: phone.value }).then(function (r) {
        if (!r.ok) { err.textContent = r.body.error || "Please check your details."; err.hidden = false; return; }
        done(r.body.reply);
        watch();
      }).catch(function () {
        err.textContent = "Couldn't save just now — please try again."; err.hidden = false;
      }).then(function () { saveBtn.disabled = skip.disabled = false; });
    });
    skip.addEventListener("click", function () {
      post("/contact", { sessionId: state.id, skip: true }).then(function (r) { done(r.body.reply); }).catch(function () { done(null); });
    });
    opts.list.appendChild(box);
    opts.list.scrollTop = opts.list.scrollHeight;
  }

  function afterReply(data) {
    if (!opts || !data) return;
    if (data.staffWillReply) watch();
    if (data.askContact) contactForm(data.askContact);
  }

  window.TranscoChatStaff = { sessionId: sessionId, start: start, afterReply: afterReply };
})();
