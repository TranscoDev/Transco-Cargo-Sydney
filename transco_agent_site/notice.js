/*
 * Website notice banner — closures and offers set in the console
 * (Notices page), shown just under the top menu on every page, with an
 * optional seasonal animation (snow, fireworks, lanterns …).
 * Loaded as <script src="/notice.js" data-api="<backend origin>" defer>.
 * Closures always show; offers/info can be closed (✕) and come back the
 * next day. Animations stop for people who prefer reduced motion.
 */
(function () {
  var me = document.currentScript;
  var API = (me && me.getAttribute("data-api")) || "https://transco-backend-production.up.railway.app";
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Look of each theme: background, text colour, icon, animation.
  var THEMES = {
    none:        { bg: null, fg: null, icon: null, fx: null },
    christmas:   { bg: "linear-gradient(90deg,#9b1c1c,#b42318 45%,#166534)", fg: "#fff", icon: "🎄", fx: "snow" },
    newyear:     { bg: "linear-gradient(90deg,#0b1430,#1d2a5c 50%,#0b1430)", fg: "#fff", icon: "🎆", fx: "fireworks" },
    avurudu:     { bg: "linear-gradient(90deg,#c2410c,#f59e0b 55%,#ca8a04)", fg: "#fff", icon: "🌞", fx: "petals" },
    vesak:       { bg: "linear-gradient(90deg,#1e1b4b,#312e81 50%,#1e1b4b)", fg: "#fff", icon: "🏮", fx: "lanterns" },
    deepavali:   { bg: "linear-gradient(90deg,#4c1d95,#7c2d12 60%,#4c1d95)", fg: "#fff", icon: "🪔", fx: "sparkles" },
    ramadan:     { bg: "linear-gradient(90deg,#064e3b,#065f46 50%,#064e3b)", fg: "#fff", icon: "🌙", fx: "stars" },
    offer:       { bg: "linear-gradient(90deg,#0c7d6b,#12a189 45%,#f0762e)", fg: "#fff", icon: "🏷️", fx: "shine" },
    celebration: { bg: "linear-gradient(90deg,#0c7d6b,#182233 50%,#f0762e)", fg: "#fff", icon: "🎉", fx: "confetti" }
  };
  // Without a theme: the colour says what kind of notice it is.
  var KIND = {
    closure: { bg: "#fff4d6", fg: "#5a3b00", icon: "📢", border: "#e0a100" },
    offer:   { bg: "#e7f7f3", fg: "#0b5c4f", icon: "🏷️", border: "#12a189" },
    info:    { bg: "#e8f0fb", fg: "#1d3b6a", icon: "ℹ️", border: "#5b8bd6" }
  };

  var CSS =
    ".tn-wrap{position:relative;z-index:400}" +
    ".tn{position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;gap:12px;padding:12px 48px 12px 16px;font:600 15px/1.45 Inter,system-ui,sans-serif;text-align:center;border-bottom:2px solid transparent}" +
    ".tn canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}" +
    ".tn-body{position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 14px;max-width:1100px}" +
    ".tn-ico{font-size:20px;line-height:1}" +
    ".tn-themed .tn-body{text-shadow:0 1px 3px rgba(0,0,0,.45)}" +
    ".tn-title{font-weight:800}" +
    ".tn-link{display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(255,255,255,.95);color:#182233;font-weight:700;font-size:14px;text-decoration:none;white-space:nowrap}" +
    ".tn-x{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:50%;background:rgba(0,0,0,.12);color:inherit;font-size:18px;cursor:pointer}" +
    ".tn-shine::after{content:'';position:absolute;top:0;bottom:0;left:-40%;width:30%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.35),transparent);animation:tn-shine 3.2s ease-in-out infinite;pointer-events:none}" +
    "@keyframes tn-shine{0%{left:-40%}60%,100%{left:120%}}" +
    ".tn-pop{animation:tn-pop .5s ease-out}" +
    "@keyframes tn-pop{from{transform:translateY(-100%);opacity:0}to{transform:none;opacity:1}}" +
    "@media (max-width:640px){.tn{font-size:14px;padding:10px 44px 10px 12px}.tn-ico{font-size:18px}}" +
    "@media (prefers-reduced-motion:reduce){.tn-shine::after,.tn-pop{animation:none}}";

  function lang() {
    try { var l = localStorage.getItem("transco_lang"); if (l === "si" || l === "ta") return l; } catch (e) {}
    return "en";
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function dismissed(id) { try { return localStorage.getItem("transco_notice_" + id) === today(); } catch (e) { return false; } }
  function dismiss(id) { try { localStorage.setItem("transco_notice_" + id, today()); } catch (e) {} }

  // ---------- animations (one small canvas per banner) ----------
  function animate(canvas, fx) {
    if (REDUCED || !fx || fx === "shine") return;
    var ctx = canvas.getContext("2d"), parts = [], W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2), t = 0;
    function size() { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size(); window.addEventListener("resize", size);
    var rnd = function (a, b) { return a + Math.random() * (b - a); };
    var COLORS = ["#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#ffffff", "#f78c6b"];
    var count = Math.max(14, Math.round(W / 28));
    function spawn(initial) {
      var p = { x: rnd(0, W), y: initial ? rnd(0, H) : -6, s: rnd(1.5, 3.5), v: rnd(0.3, 0.9), d: rnd(-0.3, 0.3), a: rnd(0, 6.28), c: COLORS[(Math.random() * COLORS.length) | 0] };
      if (fx === "lanterns") { p.y = initial ? rnd(0, H) : H + 10; p.v = -rnd(0.15, 0.4); p.s = rnd(4, 7); }
      if (fx === "sparkles" || fx === "stars") { p.y = rnd(0, H); p.v = 0; p.life = rnd(0, 6.28); }
      return p;
    }
    if (fx !== "fireworks") for (var i = 0; i < count; i++) parts.push(spawn(true));
    function burst() {
      var x = rnd(W * 0.08, W * 0.92), y = rnd(H * 0.2, H * 0.7), c = COLORS[(Math.random() * COLORS.length) | 0];
      for (var k = 0; k < 26; k++) { var ang = (k / 26) * 6.28; parts.push({ x: x, y: y, vx: Math.cos(ang) * rnd(0.6, 1.8), vy: Math.sin(ang) * rnd(0.6, 1.8), life: 1, c: c }); }
    }
    var visible = true;
    if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(canvas);
    function frame() {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      t += 1; ctx.clearRect(0, 0, W, H);
      if (fx === "fireworks") {
        if (t % 55 === 0 || parts.length === 0) burst();
        parts = parts.filter(function (p) { return p.life > 0; });
        parts.forEach(function (p) {
          p.x += p.vx; p.y += p.vy; p.vy += 0.025; p.life -= 0.018;
          ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, 6.28); ctx.fill();
        });
        ctx.globalAlpha = 1; return;
      }
      parts.forEach(function (p, idx) {
        if (fx === "snow") {
          p.y += p.v; p.x += Math.sin((t + idx * 20) / 40) * 0.3;
          ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.28); ctx.fill();
        } else if (fx === "petals" || fx === "confetti") {
          p.y += p.v; p.x += p.d; p.a += 0.05;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = fx === "petals" ? "rgba(255,236,179,.9)" : p.c;
          if (fx === "petals") { ctx.beginPath(); ctx.ellipse(0, 0, p.s * 1.6, p.s * 0.8, 0, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.s, -p.s / 2, p.s * 2, p.s);
          ctx.restore();
        } else if (fx === "lanterns") {
          p.y += p.v; p.x += Math.sin((t + idx * 30) / 60) * 0.2;
          var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s * 2.2);
          g.addColorStop(0, "rgba(255,214,102,.95)"); g.addColorStop(1, "rgba(255,140,0,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 2.2, 0, 6.28); ctx.fill();
        } else { // sparkles / stars: twinkle in place
          p.life += 0.05; var a = (Math.sin(p.life) + 1) / 2;
          ctx.fillStyle = fx === "stars" ? "rgba(255,244,200," + a + ")" : "rgba(255,200,80," + a + ")";
          ctx.beginPath(); ctx.arc(p.x, p.y, fx === "stars" ? 1.4 : 2.2, 0, 6.28); ctx.fill();
        }
        var out = p.v < 0 ? p.y < -12 : p.y > H + 8;
        if (fx !== "sparkles" && fx !== "stars" && out) parts[idx] = spawn(false);
      });
    }
    requestAnimationFrame(frame);
  }

  // ---------- banners ----------
  function render(list) {
    if (!list.length) return;
    if (!document.getElementById("tn-css")) {
      var st = document.createElement("style"); st.id = "tn-css"; st.textContent = CSS; document.head.appendChild(st);
    }
    var wrap = document.querySelector(".tn-wrap") || document.createElement("div");
    wrap.className = "tn-wrap"; wrap.innerHTML = "";
    var l = lang();
    list.forEach(function (n) {
      if (n.dismissible && dismissed(n.id)) return;
      var th = THEMES[n.theme] || THEMES.none, kind = KIND[n.kind] || KIND.info, plain = !th.bg;
      var el = document.createElement("div");
      el.className = "tn tn-pop" + (th.fx === "shine" ? " tn-shine" : "") + (plain ? "" : " tn-themed");
      el.setAttribute("role", n.kind === "closure" ? "alert" : "status");
      el.style.background = plain ? kind.bg : th.bg;
      el.style.color = plain ? kind.fg : th.fg;
      if (plain) el.style.borderBottomColor = kind.border;
      var canvas = document.createElement("canvas"); canvas.setAttribute("aria-hidden", "true"); el.appendChild(canvas);
      var body = document.createElement("div"); body.className = "tn-body";
      var ico = document.createElement("span"); ico.className = "tn-ico"; ico.setAttribute("aria-hidden", "true"); ico.textContent = th.icon || kind.icon; body.appendChild(ico);
      var text = document.createElement("span");
      if (n.title) { var b = document.createElement("span"); b.className = "tn-title"; b.textContent = n.title + " — "; text.appendChild(b); }
      text.appendChild(document.createTextNode((n.message && (n.message[l] || n.message.en)) || ""));
      body.appendChild(text);
      if (n.link && n.link.url) {
        var a = document.createElement("a"); a.className = "tn-link"; a.href = n.link.url; a.textContent = n.link.label;
        if (/^https?:/i.test(n.link.url)) { a.target = "_blank"; a.rel = "noopener"; }
        body.appendChild(a);
      }
      el.appendChild(body);
      if (n.dismissible) {
        var x = document.createElement("button"); x.className = "tn-x"; x.type = "button"; x.setAttribute("aria-label", "Close"); x.textContent = "✕";
        x.onclick = function () { dismiss(n.id); el.remove(); };
        el.appendChild(x);
      }
      wrap.appendChild(el);
      requestAnimationFrame(function () { animate(canvas, th.fx); });
    });
    if (!wrap.parentNode) {
      // Just under the top menu (or the page's own header).
      var anchor = document.getElementById("nav-mobile-panel") || document.querySelector("nav.nav") || document.querySelector("body > header");
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
      else document.body.insertBefore(wrap, document.body.firstChild);
    }
  }

  var current = [];
  function load() {
    fetch(API + "/api/public/notices").then(function (r) { return r.ok ? r.json() : { notices: [] }; })
      .then(function (d) { current = d.notices || []; render(current); })
      .catch(function () {});
  }
  window.addEventListener("transco:lang", function () { render(current); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load); else load();
})();
