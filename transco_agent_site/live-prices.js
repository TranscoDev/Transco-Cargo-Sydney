/*
 * Live prices — the console's Prices & Promotions page (the same prices the
 * chat bot quotes), loaded from /api/public/prices.
 * Loaded as <script src="/live-prices.js" data-api="<backend origin>">.
 *
 * - Any element with data-price="<key>" gets "$<price>". Keys are the
 *   Prices page keys (tea_chest, in_general_1, …) plus two worked out here:
 *   sl_tea_N  = N Tea Chests to Sri Lanka, Wattala pickup (3rd free while
 *               the free-third promotion is on)
 *   sl_zZ_N   = the same N Tea Chests with zone Z door delivery
 * - Booking/drop-off forms hand their price lists to TranscoPrices.useIn()
 *   and those lists are updated in place.
 * The numbers already in the page stay if this can't load.
 */
(function () {
  var me = document.currentScript;
  var API = (me && me.getAttribute("data-api")) || "https://transco-backend-production.up.railway.app";
  try {
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem("transco_dev_api_origin")) {
      API = localStorage.getItem("transco_dev_api_origin");
    }
  } catch (e) {}

  var TV_KEY = { upto35: "tv_35", "36to45": "tv_45", "46to55": "tv_55", "60to65": "tv_65", "66to75": "tv_75" };
  var forms = [];
  var P = window.TranscoPrices = {
    values: null,
    teaFreeThird: true,
    // { box: BOX_PRICE, india: INDIA_PRICE, tv: TV_SIZES } — any of them.
    useIn: function (lists) { forms.push(lists); if (P.values) applyTo(lists); }
  };

  function num(k) { var n = P.values && P.values[k]; return typeof n === "number" && isFinite(n) ? n : null; }

  function applyTo(f) {
    if (f.box) ["tea_chest", "gift_box", "wine_box", "quarter_cbm"].forEach(function (k) { if (num(k) !== null) f.box[k] = num(k); });
    if (f.india) {
      [["general", "in_general_"], ["tea_chest", "in_tea_"], ["quarter_cbm", "in_quarter_"]].forEach(function (m) {
        var a = [num(m[1] + 1), num(m[1] + 2), num(m[1] + 3)];
        if (f.india[m[0]] && a.every(function (n) { return n !== null; })) f.india[m[0]] = a;
      });
    }
    if (f.tv) f.tv.forEach(function (s) { var k = TV_KEY[s.key]; if (k && num(k) !== null) s.price = num(k); });
  }

  function teaChests(n) {
    var t = 0;
    for (var i = 1; i <= n; i++) t += P.teaFreeThird && i % 3 === 0 ? 0 : num("tea_chest");
    return t;
  }
  function priceOf(key) {
    var m;
    if ((m = /^sl_tea_(\d+)$/.exec(key))) return num("tea_chest") === null ? null : teaChests(+m[1]);
    if ((m = /^sl_z([123])_(\d+)$/.exec(key))) {
      var first = num("z" + m[1] + "_first"), extra = num("z" + m[1] + "_extra"), n = +m[2];
      return first === null || extra === null || num("tea_chest") === null ? null : teaChests(n) + first + (n - 1) * extra;
    }
    return num(key);
  }

  function fillPage() {
    if (!P.values) return;
    var els = document.querySelectorAll("[data-price]");
    for (var i = 0; i < els.length; i++) {
      var v = priceOf(els[i].getAttribute("data-price"));
      if (v !== null) els[i].textContent = "$" + v;
    }
  }

  fetch(API + "/api/public/prices")
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      if (!data || !data.values) return;
      P.values = data.values;
      P.teaFreeThird = (data.promotions || []).some(function (p) {
        return p.type === "free_third" && /^(tea_chest|all_boxes|any)$/.test(p.items) && p.country !== "india" && p.mode !== "air";
      });
      forms.forEach(applyTo);
      if (window.SLCities && SLCities.setRates) {
        SLCities.setRates({ 1: [num("z1_first"), num("z1_extra")], 2: [num("z2_first"), num("z2_extra")], 3: [num("z3_first"), num("z3_extra")] });
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillPage); else fillPage();
      try { window.dispatchEvent(new CustomEvent("transco:prices", { detail: data })); } catch (e) {}
    })
    .catch(function () {});
  // A language switch rewrites translated blocks — put the live prices back.
  window.addEventListener("transco:lang", fillPage);
})();
