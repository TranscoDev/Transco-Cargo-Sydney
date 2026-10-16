// Transco Agent's friendly face on the floating chat button (.chat-fab).
// Replaces the old robot picture with a small illustrated person who
// blinks and waves now and then, an "AI" tag and a green "online" dot,
// plus a short greeting bubble once per visit. Always labelled as an AI
// assistant — the face makes it friendlier, it never pretends to be staff.
// Placeholder art: swap FACE_SVG for the final illustration later.
// Everything stays still for visitors who ask for reduced motion.
(function () {
  var FACE_SVG =
    '<svg class="af-svg" viewBox="0 0 64 64" aria-hidden="true">' +
      '<rect width="64" height="64" fill="#e6f4f1"/>' +
      '<g class="af-head">' +
        '<path d="M9 66c2-12 11-18 23-18s21 6 23 18z" fill="#0c7d6b"/>' +
        '<path d="M26.5 48.5l5.5 6.5 5.5-6.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>' +
        // long hair falling behind the shoulders
        '<path d="M15.5 30c0-11.5 7.4-18.5 16.5-18.5S48.5 18.5 48.5 30v15.5c0 3-2.2 5-5 5h-23c-2.8 0-5-2-5-5z" fill="#2b1d16"/>' +
        '<rect x="28" y="39" width="8" height="10" rx="3" fill="#b9784f"/>' +
        '<circle cx="32" cy="29" r="13.5" fill="#c68a5e"/>' +
        // side-swept fringe
        '<path d="M18.3 30c-.8-10.6 5.6-17 13.7-17s14.4 6.4 13.7 17c-1.6-4.4-4.2-7.4-8.2-8.6-3.4 3.6-9.6 6.4-19.2 8.6z" fill="#2b1d16"/>' +
        '<circle cx="18.6" cy="33.5" r="1.3" fill="#f2c14e"/><circle cx="45.4" cy="33.5" r="1.3" fill="#f2c14e"/>' +
        '<g class="af-eyes" fill="#2b1d16"><circle cx="27" cy="30" r="1.9"/><circle cx="37" cy="30" r="1.9"/></g>' +
        '<circle cx="24.5" cy="34.5" r="2.2" fill="#e8806a" opacity=".35"/><circle cx="39.5" cy="34.5" r="2.2" fill="#e8806a" opacity=".35"/>' +
        '<path d="M27.5 35.5q4.5 4 9 0" fill="none" stroke="#a0453a" stroke-width="1.9" stroke-linecap="round"/>' +
      '</g>' +
    '</svg>';

  var WORDS = {
    en: { tag: "Transco Agent · AI assistant", hi: "👋 Hi! Need a price or want to book a drop-off? Ask me anything.",
          sl: "👋 Sending to Sri Lanka? I can tell you the price in seconds.", in: "👋 Sending to India? Ask me for a price or the next shipping date.", close: "Close" },
    si: { tag: "Transco Agent · AI සහායක", hi: "👋 ආයුබෝවන්! මිලක් දැනගන්න හෝ drop-off එකක් book කරන්න ඕනද? මගෙන් අහන්න.",
          sl: "👋 ලංකාවට යවනවද? මිල තත්පර කිහිපයකින් කියන්නම්.", in: "👋 ඉන්දියාවට යවනවද? මිල හෝ ඊළඟ shipping දවස මගෙන් අහන්න.", close: "වසන්න" },
    ta: { tag: "Transco Agent · AI உதவியாளர்", hi: "👋 வணக்கம்! விலை அல்லது drop-off booking வேண்டுமா? என்னிடம் கேளுங்கள்.",
          sl: "👋 இலங்கைக்கு அனுப்புகிறீர்களா? சில நொடிகளில் விலையைச் சொல்கிறேன்.", in: "👋 இந்தியாவுக்கு அனுப்புகிறீர்களா? விலை அல்லது அடுத்த shipping தேதியைக் கேளுங்கள்.", close: "மூடு" }
  };

  var CSS =
    ".af{background:#e6f4f1!important;border:3px solid var(--fab-ring,#0c7d6b)!important;width:64px!important;height:64px!important;padding:0;overflow:visible;" +
      "box-shadow:0 8px 24px rgba(24,34,51,.28),0 0 0 4px rgba(255,255,255,.85)!important}" +
    // The home page button (.ask-fab) shows/hides itself with its own fade, so only the others pop in.
    ".chat-fab.af{animation:afPop .6s cubic-bezier(.3,1.5,.5,1) both;animation-delay:.8s}" +
    ".af-clip{position:absolute;inset:0;border-radius:50%;overflow:hidden}" +
    ".af-svg{display:block!important;width:100%!important;height:100%!important}" +
    ".af-eyes circle{transform-box:fill-box;transform-origin:center;animation:afBlink 4.5s infinite}" +
    ".af-head{transform-origin:32px 44px;animation:afTilt 9s 3s infinite}" +
    ".af-dot{position:absolute;right:1px;bottom:3px;width:13px;height:13px;border-radius:50%;background:#22c55e;border:2px solid #fff}" +
    ".af-dot::after{content:'';position:absolute;inset:-2px;border-radius:50%;border:2px solid #22c55e;animation:afPulse 2.4s infinite}" +
    ".af-wave{position:absolute;top:-10px;right:-8px;font-size:20px;opacity:0;transform-origin:70% 80%;animation:afWave 9s 3s infinite;pointer-events:none}" +
    ".af-greet{position:fixed;right:16px;bottom:calc(98px + env(safe-area-inset-bottom));z-index:901;max-width:min(270px,calc(100vw - 32px));background:#fff;color:#182233;" +
      "border-radius:16px 16px 4px 16px;box-shadow:0 12px 32px rgba(24,34,51,.22);padding:12px 34px 12px 14px;font:15px/1.4 system-ui,sans-serif;cursor:pointer;transform-origin:100% 100%;animation:afIn .55s cubic-bezier(.3,1.3,.5,1) both}" +
    ".af-greet small{display:block;margin-top:6px;color:#6b7480;font-size:12px}" +
    ".af-greet button{position:absolute;top:6px;right:6px;width:26px;height:26px;border:0;border-radius:50%;background:transparent;color:#6b7480;font-size:16px;cursor:pointer}" +
    ".af-greet.out{animation:afOut .25s ease-in both}" +
    // While the Transco Agent chat is open, the bubble and greeting step aside.
    "body.chat-open .af,body.chat-open .af-greet{display:none!important}" +
    "@keyframes afPop{0%{transform:scale(0)}100%{transform:scale(1)}}" +
    "@keyframes afBlink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}" +
    "@keyframes afTilt{0%,82%,100%{transform:rotate(0)}86%{transform:rotate(-7deg)}90%{transform:rotate(5deg)}94%{transform:rotate(-3deg)}}" +
    "@keyframes afWave{0%,80%,100%{opacity:0;transform:rotate(0)}83%{opacity:1;transform:rotate(-20deg)}87%{opacity:1;transform:rotate(15deg)}91%{opacity:1;transform:rotate(-15deg)}95%{opacity:0;transform:rotate(0)}}" +
    "@keyframes afPulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.2);opacity:0}}" +
    // Grows out of the chat bubble (bottom-right corner) with a little bounce.
    "@keyframes afIn{0%{opacity:0;transform:translate(14px,40px) scale(.2)}70%{opacity:1;transform:scale(1.04)}100%{opacity:1;transform:none}}" +
    "@keyframes afOut{to{opacity:0;transform:translateY(8px)}}" +
    "@media (prefers-reduced-motion:reduce){.af,.af-eyes circle,.af-head,.af-dot::after,.af-wave,.af-greet{animation:none!important}.af-wave{display:none}}";

  function lang() {
    var l = (document.documentElement.lang || "en").slice(0, 2);
    return WORDS[l] ? l : "en";
  }
  // Greeting every time someone opens the website (once per visit — not
  // again on each page they click to in the same visit).
  function store(get) {
    try {
      if (get) return sessionStorage.getItem("af-greeted") === "1";
      sessionStorage.setItem("af-greeted", "1");
    } catch (e) {}
    return false;
  }

  function setup() {
    var fabs = document.querySelectorAll(".chat-fab, .ask-fab");
    if (!fabs.length) return;
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    var w = WORDS[lang()];
    Array.prototype.forEach.call(fabs, function (fab) {
      fab.classList.remove("fab-has-bot");
      var shownClass = fab.classList.contains("show");
      fab.classList.add("af");
      if (shownClass) fab.classList.add("show");
      fab.innerHTML = '<span class="af-clip">' + FACE_SVG + '</span><span class="af-dot"></span><span class="af-wave" aria-hidden="true">👋</span>';
      fab.setAttribute("aria-label", w.tag);
      fab.setAttribute("title", w.tag);
    });

    // Greeting: once per visit, a few seconds in, gone after 12s — and only
    // while the button itself is showing (the home page hides it while its
    // chat is on screen, and every page while the chat is open).
    if (store(true)) return;
    var fab = fabs[0];
    function fabShowing() {
      var s = getComputedStyle(fab);
      return !document.body.classList.contains("chat-open") && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.5;
    }
    var tries = 0;
    setTimeout(function waitThenGreet() {
      if (!fabShowing()) { if (++tries < 30) setTimeout(waitThenGreet, 1000); return; }
      var path = location.pathname;
      var text = /sri-lanka/.test(path) ? w.sl : /india/.test(path) ? w.in : w.hi;
      var bubble = document.createElement("div");
      bubble.className = "af-greet";
      bubble.setAttribute("role", "status");
      bubble.innerHTML = '<span></span><small></small><button type="button">✕</button>';
      bubble.firstChild.textContent = text;
      bubble.querySelector("small").textContent = w.tag;
      bubble.querySelector("button").setAttribute("aria-label", w.close);
      document.body.appendChild(bubble);
      store(false);
      function hide() {
        if (!bubble.parentNode) return;
        bubble.classList.add("out");
        setTimeout(function () { bubble.remove(); }, 260);
      }
      bubble.addEventListener("click", function (e) {
        hide();
        if (!e.target.closest("button")) fab.click();
      });
      fab.addEventListener("click", hide);
      setTimeout(hide, 12000);
      var watch = setInterval(function () {
        if (!bubble.parentNode) return clearInterval(watch);
        if (!fabShowing()) { clearInterval(watch); hide(); }
      }, 400);
    }, 4000);
  }

  // Example questions that rotate in the chat's "Type your question" box
  // (only while it's empty), so customers see what they can ask. Picks
  // a set for the page; checks every few seconds so chat boxes added
  // later (e.g. My Transco's chat panel) get them too.
  var EXAMPLES = {
    sl: ["I want to send 3 boxes to Kandy", "How much is a Tea Chest to Colombo?", "When is the next shipment to Sri Lanka?", "Can you pick up boxes from my home?"],
    in: ["How much to send 2 boxes to Chennai?", "When is the next shipment to India?", "Do you deliver to the door in India?"],
    box: ["Which box fits a 32\" TV?", "How big is a Tea Chest?", "How much is a Quarter CBM box?"],
    acct: ["Where are my boxes?", "What's my BL number?", "I want to send 3 boxes to Kandy"],
    home: ["I want to send 3 boxes to Kandy", "When is the next shipment?", "How much is a Tea Chest?", "Where is your warehouse?"],
    si: ["මට Kandy වලට boxes 3ක් යවන්න ඕන", "Tea Chest එකක් කීයද?", "ඊළඟ shipment එක කවදද?"],
    ta: ["Kandy க்கு 3 பெட்டிகள் அனுப்ப வேண்டும்", "ஒரு Tea Chest எவ்வளவு?", "அடுத்த shipment எப்போது?"]
  };
  var EG = { en: "e.g. ", si: "උදා: ", ta: "உதா: " };
  function exampleSet() {
    var l = lang();
    if (l !== "en") return EXAMPLES[l];
    var p = location.pathname;
    return /sri-lanka/.test(p) ? EXAMPLES.sl : /india/.test(p) ? EXAMPLES.in : /box-info/.test(p) ? EXAMPLES.box
      : /account/.test(p) ? EXAMPLES.acct : EXAMPLES.home;
  }
  var QUESTION_BOX = /Type your question|ප්‍රශ්නය|கேள்வி/;
  var turn = 0;
  function rotateExamples() {
    var set = exampleSet(), prefix = EG[lang()] || EG.en;
    Array.prototype.forEach.call(document.querySelectorAll("input[type=text], input:not([type]), textarea"), function (el) {
      if (!el.dataset.afEx) {
        if (!QUESTION_BOX.test(el.placeholder || "")) return;
        el.dataset.afEx = "1";
      }
      if (!el.value) el.placeholder = prefix + set[turn % set.length];
    });
    turn++;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup);
  else setup();
  setInterval(rotateExamples, 6000);
  setTimeout(rotateExamples, 600);
})();
