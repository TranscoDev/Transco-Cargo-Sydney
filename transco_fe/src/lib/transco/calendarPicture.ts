import type { ScheduleCountry, ScheduleDate } from "@/lib/transco/schedule";

/**
 * Draws a 1080×1080 "Next shipping dates" picture for staff to send on
 * WhatsApp, straight from the shipping calendar. Runs only in the browser —
 * nothing is saved or sent anywhere; it just downloads a PNG.
 *
 *  - one country  → its next 3 cutoffs, stacked
 *  - both         → Sri Lanka's next 2 and India's next 2
 */

export type PictureSection = { country: ScheduleCountry; dates: ScheduleDate[] };

const NAVY = "#0b2545";
const TEAL = "#0f8b8d";
const ORANGE = "#f28c28";
const GREY = "#5b6575";
const SOFT = "#ffffff"; // card face — white on the tinted background
const FONT = 'Inter, "Segoe UI", Arial, sans-serif';
const NAME: Record<ScheduleCountry, string> = { sri_lanka: "Sri Lanka", india: "India" };
const S = 1080;

export async function downloadCalendarPicture(sections: PictureSection[]) {
  const [logo] = await Promise.all([loadImage("/transco-logo.png"), document.fonts?.ready]);
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const g = cv.getContext("2d")!;
  // Soft background, same as the other WhatsApp pictures: light teal tint + faint circles.
  g.fillStyle = "#f3f9f9";
  g.fillRect(0, 0, S, S);
  circle(g, 1010, 50, 250, "#e2f2f2");
  circle(g, 5, 985, 225, "#fdeede");
  circle(g, 1050, 660, 120, "#e7f4f4");

  // Real logo, side by side: mark + "Transco CARGO" wordmark (white made see-through).
  const lg = transparentWhite(logo);
  g.drawImage(lg, 190, 25, 370, 366, 50, 34, 96, 95);
  g.drawImage(lg, 115, 396, 535, 202, 158, 49, 186, 70);

  const first = sections[0]!;
  const single = sections.length === 1;
  text(g, "Next shipping dates", S - 50, 92, `800 52px ${FONT}`, NAVY, "right");
  text(g, single ? `Sydney → ${NAME[first.country]}` : "Sydney → Sri Lanka & India", S - 50, 134, `600 30px ${FONT}`, TEAL, "right");

  if (single) {
    const { country, dates } = first;
    dates.slice(0, 3).forEach((d, i) => card(g, d, country, 60, 190 + i * 205, S - 120, 180, true));
  } else {
    let y = 178;
    for (const { country, dates } of sections) {
      text(g, NAME[country], 62, y + 34, `800 34px ${FONT}`, NAVY);
      g.fillStyle = TEAL;
      g.fillRect(62 + g.measureText(NAME[country]).width + 20, y + 22, S - 124 - g.measureText(NAME[country]).width - 20, 3);
      const two = dates.slice(0, 2);
      const w = (S - 120 - 30) / 2;
      two.forEach((d, i) => card(g, d, country, 60 + i * (w + 30), y + 56, w, 230, false));
      if (two.length === 0) text(g, "New dates coming soon", 62, y + 150, `600 30px ${FONT}`, GREY);
      y += 320;
    }
  }

  pill(g, "Book before the cut-off date", 60, 840, S - 120, 88, ORANGE, `800 40px ${FONT}`);
  pill(g, "my.transcosydney.com.au", 60, 946, S - 120, 88, TEAL, `800 40px ${FONT}`);

  const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  a.download = single ? `Transco-dates-${NAME[first.country].replace(" ", "-")}-${today}.png` : `Transco-dates-${today}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** One cutoff: teal date tile on the left, arrival dates on the right. */
function card(g: CanvasRenderingContext2D, d: ScheduleDate, country: ScheduleCountry, x: number, y: number, w: number, h: number, wide: boolean) {
  const c = new Date(`${d.cutoff}T00:00:00`);
  g.save();
  g.shadowColor = "rgba(11, 37, 69, 0.10)";
  g.shadowBlur = 18;
  g.shadowOffsetY = 4;
  round(g, x, y, w, h, 24, SOFT);
  g.restore();
  const tw = wide ? 170 : 150;
  round(g, x, y, tw, h, 24, TEAL);
  const cx = x + tw / 2;
  text(g, "CUT-OFF", cx, y + (wide ? 38 : 42), `700 ${wide ? 20 : 20}px ${FONT}`, "#d8f1f1", "center");
  text(g, String(c.getDate()).padStart(2, "0"), cx, y + (wide ? 112 : 130), `800 ${wide ? 76 : 80}px ${FONT}`, "#ffffff", "center");
  const wd = c.toLocaleDateString("en-AU", { weekday: "short" });
  const mo = c.toLocaleDateString("en-AU", { month: "short" });
  text(g, `${wd} · ${mo}`.toUpperCase(), cx, y + (wide ? 152 : 180), `700 ${wide ? 24 : 24}px ${FONT}`, "#ffffff", "center");

  const tx = x + tw + 28;
  const lines: [string, string | null, string][] = [["Sea", d.seaArrival, TEAL]];
  if (country !== "india") lines.push(["Air", d.airArrival, ORANGE]);
  const top = y + (wide ? 50 : 56);
  text(g, `Arrives in ${NAME[country]}`, tx, top, `600 ${wide ? 26 : 24}px ${FONT}`, GREY);
  lines.forEach(([label, iso, col], i) => {
    const ly = top + (wide ? 50 : 54) + i * (wide ? 46 : 54);
    round(g, tx, ly - 28, 72, 36, 18, col);
    text(g, label, tx + 36, ly - 1, `800 22px ${FONT}`, "#ffffff", "center");
    // Shrink the font if it would run past the card's right edge.
    const s = iso ? fmt(iso) : "To be confirmed";
    let px = wide ? 36 : 32;
    g.font = `800 ${px}px ${FONT}`;
    while (px > 18 && g.measureText(s).width > x + w - 20 - (tx + 88)) g.font = `800 ${--px}px ${FONT}`;
    text(g, s, tx + 88, ly + 2, `800 ${px}px ${FONT}`, NAVY);
  });
  if (wide && d.note) text(g, d.note, x + w - 28, y + 50, `600 22px ${FONT}`, GREY, "right");
}

function fmt(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left") {
  g.font = font;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(s, x, y);
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = color;
  g.fill();
}

function pill(g: CanvasRenderingContext2D, s: string, x: number, y: number, w: number, h: number, color: string, font: string) {
  round(g, x, y, w, h, h / 2, color);
  text(g, s, x + w / 2, y + h / 2 + 14, font, "#ffffff", "center");
}

function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
}

/** Copy of the logo with its white background made transparent, so it sits on the tint. */
function transparentWhite(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d")!;
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const m = Math.min(p[i]!, p[i + 1]!, p[i + 2]!);
    if (m > 215) p[i + 3] = Math.min(p[i + 3]!, Math.round(((255 - m) * 255) / 40));
  }
  x.putImageData(data, 0, 0);
  return c;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}
