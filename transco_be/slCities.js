// Sri Lanka districts → main towns (like ikman.lk's location picker).
// One list for the backend (chat price menu) and the website, which
// serves this same file as /sl-cities.js for the booking and walk-in
// forms (see transco_agent_site/build.js). Also the door-delivery zone
// of each town (ZONES below, matched to the Flowise prompt's tier lists).
// To add a town: put it in its district and ZONES, and redeploy both.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SLCities = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DISTRICTS = [
    ['Colombo', ['Colombo 1–15', 'Dehiwala', 'Mount Lavinia', 'Kotte', 'Battaramulla', 'Rajagiriya', 'Angoda', 'Nugegoda', 'Maharagama', 'Kottawa', 'Pannipitiya', 'Boralesgamuwa', 'Piliyandala', 'Kesbewa', 'Moratuwa', 'Ratmalana', 'Malabe', 'Kaduwela', 'Athurugiriya', 'Kolonnawa', 'Wellampitiya', 'Homagama', 'Padukka', 'Hanwella', 'Avissawella']],
    ['Gampaha', ['Wattala', 'Kelaniya', 'Peliyagoda', 'Kiribathgoda', 'Kadawatha', 'Ragama', 'Kandana', 'Ja-Ela', 'Seeduwa', 'Katunayake', 'Negombo', 'Gampaha', 'Minuwangoda', 'Nittambuwa', 'Veyangoda', 'Mirigama', 'Divulapitiya', 'Delgoda', 'Ganemulla', 'Kirindiwela']],
    ['Kalutara', ['Panadura', 'Wadduwa', 'Kalutara', 'Beruwala', 'Aluthgama', 'Bandaragama', 'Horana', 'Ingiriya', 'Matugama', 'Agalawatta', 'Bulathsinhala']],
    ['Kandy', ['Kandy', 'Peradeniya', 'Katugastota', 'Kundasale', 'Digana', 'Gampola', 'Nawalapitiya', 'Pilimathalawa', 'Kadugannawa', 'Akurana', 'Wattegama', 'Galagedara', 'Gelioya']],
    ['Matale', ['Matale', 'Dambulla', 'Galewela', 'Sigiriya', 'Ukuwela', 'Rattota', 'Naula']],
    ['Nuwara Eliya', ['Nuwara Eliya', 'Hatton', 'Talawakele', 'Ginigathhena', 'Maskeliya', 'Kotagala', 'Walapane', 'Ragala']],
    ['Galle', ['Galle', 'Hikkaduwa', 'Ambalangoda', 'Elpitiya', 'Bentota', 'Baddegama', 'Karapitiya', 'Unawatuna', 'Ahangama', 'Koggala']],
    ['Matara', ['Matara', 'Weligama', 'Akuressa', 'Dikwella', 'Hakmana', 'Deniyaya', 'Kamburupitiya', 'Mirissa']],
    ['Hambantota', ['Hambantota', 'Tangalle', 'Beliatta', 'Ambalantota', 'Tissamaharama', 'Weeraketiya', 'Sooriyawewa']],
    ['Jaffna', ['Jaffna', 'Chavakachcheri', 'Point Pedro', 'Nallur', 'Chunnakam', 'Kopay', 'Karainagar', 'Velanai']],
    ['Kilinochchi', ['Kilinochchi', 'Pallai', 'Paranthan']],
    ['Mannar', ['Mannar', 'Madhu', 'Murunkan', 'Pesalai']],
    ['Vavuniya', ['Vavuniya', 'Cheddikulam', 'Nedunkerny']],
    ['Mullaitivu', ['Mullaitivu', 'Puthukudiyiruppu', 'Oddusuddan', 'Mallavi']],
    ['Batticaloa', ['Batticaloa', 'Kattankudy', 'Eravur', 'Valaichchenai', 'Kaluwanchikudy']],
    ['Ampara', ['Ampara', 'Kalmunai', 'Akkaraipattu', 'Sainthamaruthu', 'Pottuvil', 'Dehiattakandiya', 'Uhana']],
    ['Trincomalee', ['Trincomalee', 'Kinniya', 'Kantale', 'Mutur', 'Nilaveli']],
    ['Kurunegala', ['Kurunegala', 'Kuliyapitiya', 'Narammala', 'Pannala', 'Wariyapola', 'Mawathagama', 'Polgahawela', 'Alawwa', 'Nikaweratiya', 'Giriulla', 'Ibbagamuwa', 'Hettipola']],
    ['Puttalam', ['Puttalam', 'Chilaw', 'Wennappuwa', 'Marawila', 'Nattandiya', 'Dankotuwa', 'Anamaduwa', 'Kalpitiya']],
    ['Anuradhapura', ['Anuradhapura', 'Kekirawa', 'Medawachchiya', 'Thambuttegama', 'Eppawala', 'Mihintale', 'Galenbindunuwewa', 'Nochchiyagama']],
    ['Polonnaruwa', ['Polonnaruwa', 'Kaduruwela', 'Hingurakgoda', 'Medirigiriya', 'Dimbulagala']],
    ['Badulla', ['Badulla', 'Bandarawela', 'Haputale', 'Welimada', 'Mahiyanganaya', 'Hali-Ela', 'Ella', 'Passara', 'Diyatalawa']],
    ['Monaragala', ['Monaragala', 'Wellawaya', 'Bibile', 'Buttala', 'Kataragama', 'Siyambalanduwa']],
    ['Ratnapura', ['Ratnapura', 'Balangoda', 'Embilipitiya', 'Pelmadulla', 'Eheliyagoda', 'Kuruwita', 'Kahawatta', 'Rakwana']],
    ['Kegalle', ['Kegalle', 'Mawanella', 'Warakapola', 'Rambukkana', 'Ruwanwella', 'Yatiyantota', 'Dehiowita', 'Deraniyagala', 'Kitulgala']]
  ];

  // Door-delivery zone per town — road distance from Colombo Fort:
  // 1 = up to 20km, 2 = 21–100km, 3 = over 100km.
  // MUST match the Tier lists in the Flowise system prompt
  // (other/Flowise/system_prompt_LATEST.txt, "Delivery zones"). Towns
  // marked * are not in that list yet — add them there with the same tier.
  // Wattala has no zone: it's our warehouse (Flowise treats it as pickup).
  var ZONES = {
    'Colombo 1–15': 1, 'Kotte': 1, 'Battaramulla': 1, 'Rajagiriya': 1, 'Dehiwala': 1, 'Mount Lavinia': 1,
    'Kelaniya': 1, 'Peliyagoda': 1, 'Ratmalana': 1, 'Kolonnawa': 1, 'Wellampitiya': 1, 'Angoda': 1,
    'Malabe': 1, 'Maharagama': 1, 'Kaduwela': 1, 'Pannipitiya': 1, 'Moratuwa': 1, 'Piliyandala': 1,
    'Boralesgamuwa': 1, 'Kadawatha': 1, 'Ragama': 1, 'Nugegoda': 1,
    'Athurugiriya': 1, 'Kiribathgoda': 1, 'Kandana': 1, // *

    'Kottawa': 2, 'Ja-Ela': 2, 'Homagama': 2, 'Panadura': 2, 'Bandaragama': 2, 'Minuwangoda': 2,
    'Negombo': 2, 'Nittambuwa': 2, 'Veyangoda': 2, 'Kalutara': 2, 'Horana': 2, 'Hanwella': 2, 'Padukka': 2,
    'Ingiriya': 2, 'Bulathsinhala': 2, 'Wadduwa': 2, 'Divulapitiya': 2, 'Wennappuwa': 2, 'Marawila': 2,
    'Avissawella': 2, 'Matugama': 2, 'Beruwala': 2, 'Aluthgama': 2, 'Bentota': 2, 'Warakapola': 2,
    'Chilaw': 2, 'Ambalangoda': 2, 'Kegalle': 2, 'Mawanella': 2, 'Kesbewa': 2, 'Ratnapura': 2, 'Hikkaduwa': 2,
    // *
    'Seeduwa': 2, 'Katunayake': 2, 'Gampaha': 2, 'Mirigama': 2, 'Delgoda': 2, 'Ganemulla': 2, 'Kirindiwela': 2,
    'Agalawatta': 2, 'Elpitiya': 2, 'Nattandiya': 2, 'Dankotuwa': 2, 'Pannala': 2, 'Giriulla': 2, 'Alawwa': 2,
    'Polgahawela': 2, 'Narammala': 2, 'Kuliyapitiya': 2, 'Rambukkana': 2, 'Ruwanwella': 2, 'Yatiyantota': 2,
    'Dehiowita': 2, 'Deraniyagala': 2, 'Kitulgala': 2, 'Kuruwita': 2, 'Eheliyagoda': 2,

    'Kurunegala': 3, 'Gampola': 3, 'Hatton': 3, 'Kandy': 3, 'Nawalapitiya': 3, 'Matale': 3, 'Dambulla': 3,
    'Sigiriya': 3, 'Nuwara Eliya': 3, 'Bandarawela': 3, 'Ella': 3, 'Badulla': 3, 'Monaragala': 3,
    'Galle': 3, 'Matara': 3, 'Tangalle': 3, 'Hambantota': 3, 'Anuradhapura': 3, 'Polonnaruwa': 3,
    'Puttalam': 3, 'Jaffna': 3, 'Vavuniya': 3, 'Trincomalee': 3, 'Batticaloa': 3, 'Ampara': 3, 'Kalmunai': 3,
    'Kilinochchi': 3, 'Mannar': 3
  };
  // * Everything else in the list is over 100km → zone 3.
  DISTRICTS.forEach(function (d) {
    d[1].forEach(function (town) { if (!(town in ZONES) && town !== 'Wattala') ZONES[town] = 3; });
  });

  // Door delivery on top of the warehouse-pickup price, for the WHOLE
  // order (every box, TV or odd item counts): 1st item + each further
  // item. Same numbers as the Flowise pricing tool (PRICE_TABLE: zone
  // price minus pickup price) — e.g. 3 Tea Chests to Zone 1 = $150 + $100 = $250.
  var ZONE_RATES = { 1: [50, 25], 2: [70, 35], 3: [80, 40] };
  var ZONE_LABEL = { 1: 'up to 20km from Colombo Fort', 2: '21–100km from Colombo Fort', 3: 'over 100km from Colombo Fort' };

  function zoneOf(town) {
    var want = String(town || '').trim().toLowerCase();
    for (var k in ZONES) if (k.toLowerCase() === want) return ZONES[k];
    return null;
  }
  function deliveryCharge(zone, items) {
    var r = ZONE_RATES[zone];
    if (!r || !(items > 0)) return null;
    return r[0] + (items - 1) * r[1];
  }

  function districtOf(town) {
    var want = String(town || '').trim().toLowerCase();
    if (!want) return null;
    for (var i = 0; i < DISTRICTS.length; i++) {
      for (var j = 0; j < DISTRICTS[i][1].length; j++) {
        if (DISTRICTS[i][1][j].toLowerCase() === want) return DISTRICTS[i][0];
      }
    }
    return null;
  }

  // Browser only: puts District + Town dropdowns above an existing town
  // text box. The text box stays the real field (the forms read and check
  // it as before); it's hidden unless "Other" is picked or the saved town
  // isn't in the list.
  function attach(input, labels) {
    if (!input || typeof document === 'undefined' || input.getAttribute('data-sl-picker')) return;
    input.setAttribute('data-sl-picker', '1');
    var L = Object.assign({ district: 'District', town: 'Town / city', choose: 'Choose…', other: 'Other — type it below' }, labels || {});
    function el(tag, attrs, text) {
      var e = document.createElement(tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      if (text != null) e.textContent = text;
      return e;
    }
    function opt(value, text) { return el('option', { value: value }, text); }
    var cls = input.className || '';
    var dSel = el('select', { class: cls, 'aria-label': L.district });
    var tSel = el('select', { class: cls, 'aria-label': L.town });
    dSel.appendChild(opt('', L.district + ' — ' + L.choose));
    DISTRICTS.forEach(function (d) { dSel.appendChild(opt(d[0], d[0])); });
    var row = el('div', { class: 'sl-picker', style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px' });
    row.appendChild(dSel); row.appendChild(tSel);
    input.parentNode.insertBefore(row, input);

    function setText(v) {
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function fillTowns(district, selected) {
      tSel.innerHTML = '';
      tSel.appendChild(opt('', L.town + ' — ' + L.choose));
      var d = DISTRICTS.filter(function (x) { return x[0] === district; })[0];
      (d ? d[1] : []).forEach(function (t) { tSel.appendChild(opt(t, t)); });
      tSel.appendChild(opt('__other', L.other));
      tSel.disabled = !d;
      tSel.value = selected || '';
    }
    function showText(show) { input.style.display = show ? '' : 'none'; }

    var current = input.value.trim();
    var known = districtOf(current);
    if (known) {
      dSel.value = known; fillTowns(known, DISTRICTS.filter(function (x) { return x[0] === known; })[0][1].filter(function (t) { return t.toLowerCase() === current.toLowerCase(); })[0]);
      showText(false);
    } else {
      fillTowns('', '');
      showText(!!current);
    }
    dSel.addEventListener('change', function () { fillTowns(dSel.value, ''); setText(''); showText(false); });
    tSel.addEventListener('change', function () {
      if (tSel.value === '__other') { setText(''); showText(true); input.focus(); }
      else { setText(tSel.value); showText(false); }
    });
  }

  return { DISTRICTS: DISTRICTS, ZONES: ZONES, ZONE_LABEL: ZONE_LABEL, districtOf: districtOf, zoneOf: zoneOf, deliveryCharge: deliveryCharge, attach: attach };
});
