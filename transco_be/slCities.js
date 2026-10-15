// Sri Lanka districts → main towns (like ikman.lk's location picker).
// One list for the backend (chat price menu) and the website, which
// serves this same file as /sl-cities.js for the booking and walk-in
// forms (see transco_agent_site/build.js). No zones here on purpose —
// the town is passed on and the pricing works out the zone, as before.
// To add a town: put it in its district below and redeploy both.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SLCities = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var DISTRICTS = [
    ['Colombo', ['Colombo 1–15', 'Dehiwala', 'Mount Lavinia', 'Kotte', 'Battaramulla', 'Nugegoda', 'Maharagama', 'Kottawa', 'Pannipitiya', 'Boralesgamuwa', 'Piliyandala', 'Kesbewa', 'Moratuwa', 'Ratmalana', 'Malabe', 'Kaduwela', 'Athurugiriya', 'Kolonnawa', 'Wellampitiya', 'Homagama', 'Padukka', 'Hanwella', 'Avissawella']],
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

  return { DISTRICTS: DISTRICTS, districtOf: districtOf, attach: attach };
});
