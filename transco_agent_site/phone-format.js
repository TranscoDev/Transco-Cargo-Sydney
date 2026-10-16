// Australian mobile numbers, the way people read them: 0402 750 571 (4-3-3).
// Any phone box (type="tel") on the page tidies itself as the customer
// types, but only for Australian mobiles (04…) — a Sri Lankan or Indian
// number is left exactly as typed. The backend reads digits only, so the
// spaces never matter when saving.
(function () {
  function auMobile(value) {
    var digits = String(value || "").replace(/\D/g, "");
    if (/^614\d{8}$/.test(digits)) digits = "0" + digits.slice(2);
    if (!/^04\d{0,8}$/.test(digits)) return null;
    return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7)].filter(Boolean).join(" ");
  }
  window.formatAuPhone = function (value) {
    var text = String(value || "").trim();
    return (/^\+?[\d\s()-]+$/.test(text) && auMobile(text)) || text;
  };
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!el || el.tagName !== "INPUT" || el.type !== "tel" || el.readOnly) return;
    // Only while typing at the end, so editing the middle never jumps the caret.
    if (el.selectionStart !== el.value.length) return;
    if (/^\+/.test(el.value.trim())) return;
    if (el.hasAttribute("data-pf-local")) return; // country-code boxes tidy themselves
    var tidy = auMobile(el.value);
    if (tidy && tidy !== el.value) el.value = tidy;
  });

  // ---------- One phone box everywhere: 🇦🇺 +61 ▾ | number ----------
  // PhoneField.attach(input, { code: "61" }) turns a phone box into a
  // country dropdown + number box (same as sign-in). The original box
  // stays the real field the form reads — it's hidden and always holds
  // the full number, saved one way everywhere: "+94 77 123 4567".
  var CODES = [["61", "🇦🇺 +61"], ["94", "🇱🇰 +94"], ["91", "🇮🇳 +91"]];

  function parse(value, defCode) {
    var text = String(value || "").trim(), d = text.replace(/\D/g, "");
    if (!d) return { code: defCode, local: "" };
    for (var i = 0; i < CODES.length; i++) {
      var c = CODES[i][0];
      if (d.indexOf(c) === 0 && (text.charAt(0) === "+" || d.length >= c.length + 9)) return { code: c, local: d.slice(c.length).replace(/^0/, "") };
    }
    if (/^04\d{8}$/.test(d)) return { code: "61", local: d.slice(1) };
    if (/^07\d{8}$/.test(d) && defCode !== "61") return { code: "94", local: d.slice(1) };
    return { code: defCode, local: d.replace(/^0/, "") };
  }
  function group(code, local) {
    if (code === "61" && local.length === 9) return local.slice(0, 3) + " " + local.slice(3, 6) + " " + local.slice(6);
    if (code === "94" && local.length === 9) return local.slice(0, 2) + " " + local.slice(2, 5) + " " + local.slice(5);
    if (code === "91" && local.length === 10) return local.slice(0, 5) + " " + local.slice(5);
    return local;
  }
  function compose(code, local) {
    local = String(local || "").replace(/\D/g, "").replace(/^0/, "");
    return local ? "+" + code + " " + group(code, local) : "";
  }
  // A mobile that fits its country: AU 4XX XXX XXX, LK 7X XXX XXXX, IN 6–9 + 9 digits.
  function validMobile(value) {
    var p = parse(value, "61");
    return p.code === "61" ? /^4\d{8}$/.test(p.local) : p.code === "94" ? /^7\d{8}$/.test(p.local) : /^[6-9]\d{9}$/.test(p.local);
  }
  function validPhone(value) {
    var p = parse(value, "61");
    return p.local.length >= 7 && p.local.length <= 12;
  }

  function attach(input, opts) {
    if (!input || input.getAttribute("data-pf")) return;
    input.setAttribute("data-pf", "1");
    var start = parse(input.value, (opts && opts.code) || "61");
    var cls = input.className || "";
    var row = document.createElement("div");
    row.className = "pf-row";
    row.style.cssText = "display:flex;gap:8px;align-items:stretch";
    var sel = document.createElement("select");
    sel.className = cls;
    sel.style.cssText = "flex:0 0 auto;width:auto;min-width:104px";
    sel.setAttribute("aria-label", "Country code");
    CODES.forEach(function (c) { var o = document.createElement("option"); o.value = c[0]; o.textContent = c[1]; sel.appendChild(o); });
    sel.value = start.code;
    var num = document.createElement("input");
    num.className = cls;
    num.type = "tel";
    num.setAttribute("inputmode", "tel");
    num.setAttribute("autocomplete", input.getAttribute("autocomplete") || "off");
    num.setAttribute("maxlength", "16");
    num.setAttribute("data-pf-local", "1");
    num.style.cssText = "flex:1 1 auto;min-width:0";
    num.value = group(start.code, start.local);
    // The label and the form's error highlighting find the visible box by id.
    if (input.id) { num.id = input.id; input.id = input.id + "-full"; }
    if (input.getAttribute("aria-describedby")) num.setAttribute("aria-describedby", input.getAttribute("aria-describedby"));
    num.placeholder = sel.value === "61" ? "4XX XXX XXX" : sel.value === "94" ? "7X XXX XXXX" : "XXXXX XXXXX";
    input.style.display = "none";
    input.parentNode.insertBefore(row, input);
    row.appendChild(sel); row.appendChild(num);

    function sync() {
      // A pasted full number (+94…) switches the country by itself.
      var p = parse(num.value, sel.value);
      if (/^\s*\+/.test(num.value) || p.code !== sel.value && String(num.value).replace(/\D/g, "").length > 10) { sel.value = p.code; num.value = group(p.code, p.local); }
      num.placeholder = sel.value === "61" ? "4XX XXX XXX" : sel.value === "94" ? "7X XXX XXXX" : "XXXXX XXXXX";
      input.value = compose(sel.value, num.value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      num.removeAttribute("aria-invalid");
    }
    num.addEventListener("input", sync);
    num.addEventListener("blur", function () { var p = parse(input.value, sel.value); if (p.local) num.value = group(sel.value, p.local); });
    sel.addEventListener("change", sync);
    // Keep the saved value in the one format even if the user never edits it.
    if (input.value && input.value !== compose(start.code, start.local)) {
      input.value = compose(start.code, start.local);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  window.PhoneField = { attach: attach, parse: parse, compose: compose, validMobile: validMobile, validPhone: validPhone };
})();
