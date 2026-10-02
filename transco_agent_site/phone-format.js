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
    var tidy = auMobile(el.value);
    if (tidy && tidy !== el.value) el.value = tidy;
  });
})();
