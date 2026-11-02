// Reads messages copied from WhatsApp (phone, Web or Desktop) or a chat
// export, e.g.
//   [10:15 am, 02/11/2026] Kamal Perera: How much for a TV?
//   [2/11/26, 10:15:32 AM] Kamal Perera: How much for a TV?
//   02/11/2026, 10:15 am - Kamal Perera: How much for a TV?
// Dates are day/month/year (Australian phones). Lines without a stamp
// belong to the message above (a message on several lines).

export interface PastedMessage {
  sender: string;
  text: string;
  /** ISO time, or null when the stamp couldn't be read. */
  at: string | null;
}

const BRACKET = /^\[([^\]]{6,40})\]\s*([^:]{1,60}?):\s?(.*)$/;
const DASH = /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[ap]\.?\s?m\.?)?)\s+[-–]\s+([^:]{1,60}?):\s?(.*)$/i;

function parseStamp(s: string): string | null {
  const d = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  const rest = d ? s.replace(d[0], " ") : s;
  const t = rest.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap])?\.?\s?m?\.?/i);
  if (!d || !t) return null;
  const day = Number(d[1]);
  const month = Number(d[2]);
  let year = Number(d[3]);
  if (year < 100) year += 2000;
  let hour = Number(t[1]);
  const ap = t[4]?.toLowerCase();
  if (ap === "p" && hour < 12) hour += 12;
  if (ap === "a" && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) return null;
  const when = new Date(year, month - 1, day, hour, Number(t[2]), t[3] ? Number(t[3]) : 0);
  return isNaN(when.getTime()) ? null : when.toISOString();
}

export function parseWhatsAppPaste(raw: string): PastedMessage[] {
  const out: PastedMessage[] = [];
  // WhatsApp adds invisible direction marks around names and stamps.
  const lines = raw.replace(/[‎‏‪-‮⁨⁩]/g, "").replace(/\r\n?/g, "\n").split("\n");
  for (const line of lines) {
    const m = line.match(BRACKET) || line.match(DASH);
    const at = m ? parseStamp(m[1] ?? "") : null;
    const prev = out[out.length - 1];
    if (m && at) {
      out.push({ sender: (m[2] ?? "").trim().replace(/^~\s*/, ""), text: m[3] ?? "", at });
    } else if (prev) {
      prev.text += "\n" + line;
    }
  }
  return out
    .map((m) => ({ ...m, text: m.text.replace(/\s*<This message was edited>\s*$/i, "").trim() }))
    .filter((m) => m.text);
}

/** "+61 412 345 678" as a sender = a number not saved in the phone. */
export const senderIsPhone = (sender: string) => /^\+?[\d\s()-]{8,}$/.test(sender);
