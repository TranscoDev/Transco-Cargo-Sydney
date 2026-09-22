// Shared phone-number normalization — used by the live WhatsApp webhook
// path (where numbers already arrive digits-only, e.g. "61422077885") and
// the historical Excel importer (where numbers arrive in every format
// imaginable: "0420 502 368", "+61 412 345 678", "61452651471",
// "(+61)412168222"). Both need to land on the exact same digits-only
// international format or a customer will silently get imported as a
// second, unmatched record instead of merging with their real one.
//
// Returns null (never throws, never guesses) when the input can't be
// confidently normalized — e.g. Excel's scientific-notation corruption
// ("9.19248E+11") or a too-short number — so the caller can route it to a
// review queue instead of silently matching the wrong person.

function normalizePhoneNumber(raw, defaultCountryCode = '61') {
  if (raw === null || raw === undefined) return null;

  const str = String(raw).trim();
  if (!str) return null;

  // Scientific notation is unrecoverable data loss (Excel mangled the
  // original digits away) — never guess at what it used to say.
  if (/e\+?\d+$/i.test(str)) return null;

  // Strip everything but digits — handles "+61 412 345 678",
  // "(+61)412168222", "0420-502-368", "0777 205 906", etc. in one pass.
  let digits = str.replace(/\D/g, '');
  if (!digits) return null;

  // A mobile number's core is 9 significant digits after any leading
  // trunk/country prefix (true for both AU "4xxxxxxxx" and LK
  // "7xxxxxxxx" mobiles) — too short to be a real number at all.
  if (digits.length < 9) return null;

  // Local trunk-prefixed format, e.g. "0420502368" -> "61420502368".
  if (digits.length === 10 && digits.startsWith('0')) {
    digits = defaultCountryCode + digits.slice(1);
  }

  // Bare 9-digit local number with no trunk zero, e.g. "420502368".
  if (digits.length === 9) {
    digits = defaultCountryCode + digits;
  }

  // Already has a country code (61.../94.../91...) — leave as-is.
  // Reject anything still an implausible length either way (a mistyped
  // landline fragment, a partial paste, etc.) rather than importing junk.
  if (digits.length < 10 || digits.length > 12) return null;

  return digits;
}

module.exports = { normalizePhoneNumber };
