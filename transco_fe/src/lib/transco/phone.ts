/**
 * Phone numbers the way people read them (Transco is in Sydney):
 *   Australian mobile    → 0402 750 571   (4-3-3)
 *   Australian landline  → 02 9600 1234
 *   Sri Lanka            → +94 76 107 2332
 *   India                → +91 98400 12345
 *   anything else        → +<digits>, or as typed
 * Accepts stored numbers ("61402750571"), "+61 …" or local ("0402750571").
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = String(raw).trim();
  // Not a phone number (e.g. a website chat visitor's id) — leave it alone.
  if (!/^\+?[\d\s()-]+$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  if (!digits) return text;

  // Australia → shown the local way.
  // A local number is only treated as Australian when it's a mobile (04…):
  // Sri Lankan receivers also type 10 digits starting 0 (077 …).
  let au: string | null = null;
  if (/^61[2-9]\d{8}$/.test(digits)) au = `0${digits.slice(2)}`;
  else if (/^04\d{8}$/.test(digits)) au = digits;
  else if (digits.startsWith("0")) return text;
  if (au) {
    return au.startsWith("04")
      ? `${au.slice(0, 4)} ${au.slice(4, 7)} ${au.slice(7)}`
      : `${au.slice(0, 2)} ${au.slice(2, 6)} ${au.slice(6)}`;
  }
  if (/^94\d{9}$/.test(digits)) return `+94 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  if (/^91\d{10}$/.test(digits)) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return digits.length >= 9 ? `+${digits}` : text;
}

/** Search: does the typed text (e.g. "0402 750") appear in this stored number? */
export function phoneMatches(raw: string | null | undefined, query: string): boolean {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let q = query.replace(/[\s()+-]/g, "");
  if (!digits || !/^\d+$/.test(q)) return false;
  if (q.startsWith("0")) q = `61${q.slice(1)}`;
  const local = digits.startsWith("61") ? `0${digits.slice(2)}` : digits;
  return digits.includes(q) || local.includes(query.replace(/\D/g, ""));
}

/** For tel: links — always the full international number. */
export function telHref(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (/^04\d{8}$/.test(digits)) return `tel:+61${digits.slice(1)}`;
  if (digits.startsWith("0")) return `tel:${digits}`;
  return digits ? `tel:+${digits}` : "";
}
