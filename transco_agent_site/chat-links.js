/*
 * Chat message formatting shared by every Transco Agent chat window.
 *
 * Turns a bot reply into safe HTML: *bold* like WhatsApp, our own site
 * links become a tappable button ("📝 Book now →") instead of a long
 * address to copy, other web links become plain links, and Australian
 * phone numbers become tap-to-call. Everything else is escaped text.
 *
 * Usage: <script src="/chat-links.js"></script>, then
 *   el.innerHTML = TranscoChatLinks.html(text);
 */
(function () {
  var LABELS = {
    en: { book: "Book now", track: "Track my shipment", profile: "Open my profile", account: "Open My Transco", dropoff: "Open the drop-off form", boxes: "See boxes & prices", privacy: "Read the privacy policy", contact: "Contact us", whatsapp: "Open WhatsApp", open: "Open" },
    si: { book: "දැන් book කරන්න", track: "මගේ shipment එක බලන්න", profile: "මගේ profile එක", account: "My Transco open කරන්න", dropoff: "Drop-off form එක open කරන්න", boxes: "Boxes සහ මිල ගණන්", privacy: "Privacy policy කියවන්න", contact: "අපව අමතන්න", whatsapp: "WhatsApp open කරන්න", open: "Open" },
    ta: { book: "இப்போது book செய்யுங்கள்", track: "என் shipment ஐப் பார்க்க", profile: "என் profile", account: "My Transco திறக்க", dropoff: "Drop-off form திறக்க", boxes: "Boxes மற்றும் விலைகள்", privacy: "Privacy policy படிக்க", contact: "எங்களைத் தொடர்புகொள்ள", whatsapp: "WhatsApp திறக்க", open: "திறக்க" }
  };
  var ICONS = { book: "📝", track: "📦", profile: "👤", account: "👤", dropoff: "📝", boxes: "📦", privacy: "🔒", contact: "📞", whatsapp: "💬", open: "🔗" };
  var SITE_HOSTS = /^(my\.|www\.)?transcosydney\.com\.au$|^transco-site\.pages\.dev$|(^|\.)transco-agent-site\.transcocargo\.workers\.dev$|^localhost$/;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function label(key) {
    var lang = (document.documentElement.lang || "en").slice(0, 2);
    return (LABELS[lang] || LABELS.en)[key] || LABELS.en[key];
  }

  // Which button a link becomes. Our own pages get a relative href so they
  // stay on whichever address the customer is using.
  function describe(raw) {
    var u;
    try { u = new URL(raw); } catch (e) { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (/^(wa\.me|api\.whatsapp\.com)$/.test(u.hostname)) return { href: u.href, key: "whatsapp", external: true };
    if (!SITE_HOSTS.test(u.hostname)) return { href: u.href, text: u.hostname.replace(/^www\./, ""), external: true };
    var href = u.pathname + u.search + u.hash;
    var page = u.pathname.replace(/^\/+/, "") || "index.html";
    var hash = u.hash || "";
    var key = "open";
    if (page === "account.html") {
      key = /^#\/book/.test(hash) ? "book"
        : /^#\/(shipments|track)/.test(hash) ? "track"
        : /^#\/profile/.test(hash) ? "profile"
        : "account";
    } else if (page === "dropoff.html") key = "dropoff";
    else if (page === "box-info.html") key = "boxes";
    else if (page === "privacy.html") key = "privacy";
    else if (page === "contact.html") key = "contact";
    return { href: href, key: key };
  }

  function button(info) {
    var text = info.key ? ICONS[info.key] + " " + label(info.key) + " →" : info.text + " ↗";
    return '<a class="tc-linkbtn tc-' + (info.key || "open") + '" href="' + esc(info.href) + '"' +
      (info.external ? ' target="_blank" rel="noopener"' : "") + ">" + esc(text) + "</a>";
  }

  var URL_RE = /https?:\/\/[^\s<>"']+/g;
  var PHONE_RE = /(^|[^\d])(0[2-478](?: ?\d){8})(?!\d)/g;

  function textHtml(s) {
    return esc(s)
      .replace(/\*([^*\n]+?)\*/g, "<strong>$1</strong>")
      .replace(PHONE_RE, function (m, pre, num) {
        return pre + '<a class="tc-tel" href="tel:' + num.replace(/ /g, "") + '">' + num + "</a>";
      });
  }

  function html(text) {
    var s = String(text || "");
    var out = "", last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(s))) {
      var raw = m[0], trail = "";
      // Sentence punctuation after a link isn't part of it.
      while (/[.,;:!?)\]]$/.test(raw)) { trail = raw.slice(-1) + trail; raw = raw.slice(0, -1); }
      var info = describe(raw);
      out += textHtml(s.slice(last, m.index));
      out += info ? button(info) : esc(raw);
      out += textHtml(trail);
      last = m.index + m[0].length;
      // The button sits on its own line with its own spacing, so line
      // breaks right after it would only add empty space.
      if (info && !trail) while (s.charAt(last) === "\n") last++;
    }
    return out + textHtml(s.slice(last));
  }

  if (!document.getElementById("tc-linkbtn-css")) {
    var css = document.createElement("style");
    css.id = "tc-linkbtn-css";
    css.textContent =
      // Soft tinted buttons, one colour per kind, each on its own line.
      ".tc-linkbtn{--bg:#e6f6f2;--fg:#0b6b5c;--bd:#a8dfd2;display:flex;width:fit-content;align-items:center;gap:4px;margin:8px 0 14px;padding:8px 14px;border-radius:12px;" +
      "background:var(--bg);color:var(--fg) !important;border:1.5px solid var(--bd);font-weight:700;font-size:15px;line-height:1.25;text-decoration:none !important;" +
      "white-space:normal;word-break:normal;max-width:100%;transition:filter .15s,transform .15s}" +
      ".tc-linkbtn:hover{filter:brightness(.96)}.tc-linkbtn:active{transform:scale(.98)}.tc-linkbtn:focus-visible{outline:3px solid var(--bd);outline-offset:2px}" +
      ".tc-book{--bg:#e6f6f2;--fg:#0b6b5c;--bd:#a8dfd2}" +
      ".tc-dropoff{--bg:#fff4e0;--fg:#9a5a00;--bd:#f5cf8e}" +
      ".tc-account,.tc-profile{--bg:#eaf1ff;--fg:#2450a8;--bd:#b9cdf5}" +
      ".tc-track,.tc-boxes{--bg:#f2ecff;--fg:#5b3aa8;--bd:#d3c4f5}" +
      ".tc-whatsapp{--bg:#e7f8ec;--fg:#1a7a3c;--bd:#a9e2bd}" +
      ".tc-contact{--bg:#fdecef;--fg:#a8324a;--bd:#f3bdc8}" +
      ".tc-privacy,.tc-open{--bg:#f1f3f5;--fg:#3d4a57;--bd:#d5dbe1}" +
      ".tc-tel{color:inherit;font-weight:700;text-decoration:underline;white-space:nowrap}";
    (document.head || document.documentElement).appendChild(css);
  }

  window.TranscoChatLinks = { html: html };
})();
