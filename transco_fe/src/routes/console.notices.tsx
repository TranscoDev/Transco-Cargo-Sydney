import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Megaphone, PenLine, Plus, Trash2 } from "lucide-react";

import { PageHeader, PageShell, StatusBadge } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deleteNotice, fetchNotices, saveNotice, type Notice, type NoticeInput, type NoticeKind, type NoticeTheme } from "@/lib/transco/notices";
import { friendlyError, notify } from "@/lib/transco/notify";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/console/notices")({
  component: NoticesPage,
});

// Same looks as the website banner (transco_agent_site/notice.js).
const THEMES: { key: NoticeTheme; label: string; icon: string; bg: string; anim: string }[] = [
  { key: "none", label: "Plain", icon: "📢", bg: "", anim: "No animation" },
  { key: "christmas", label: "Christmas", icon: "🎄", bg: "linear-gradient(90deg,#9b1c1c,#b42318 45%,#166534)", anim: "Falling snow" },
  { key: "newyear", label: "New Year", icon: "🎆", bg: "linear-gradient(90deg,#0b1430,#1d2a5c 50%,#0b1430)", anim: "Fireworks" },
  { key: "avurudu", label: "Avurudu", icon: "🌞", bg: "linear-gradient(90deg,#c2410c,#f59e0b 55%,#ca8a04)", anim: "Falling petals" },
  { key: "vesak", label: "Vesak", icon: "🏮", bg: "linear-gradient(90deg,#1e1b4b,#312e81 50%,#1e1b4b)", anim: "Rising lanterns" },
  { key: "deepavali", label: "Deepavali", icon: "🪔", bg: "linear-gradient(90deg,#4c1d95,#7c2d12 60%,#4c1d95)", anim: "Sparkling lights" },
  { key: "ramadan", label: "Ramadan / Eid", icon: "🌙", bg: "linear-gradient(90deg,#064e3b,#065f46 50%,#064e3b)", anim: "Twinkling stars" },
  { key: "offer", label: "Offer", icon: "🏷️", bg: "linear-gradient(90deg,#0c7d6b,#12a189 45%,#f0762e)", anim: "Shine sweep" },
  { key: "celebration", label: "Celebration", icon: "🎉", bg: "linear-gradient(90deg,#0c7d6b,#182233 50%,#f0762e)", anim: "Confetti" },
];
const PLAIN: Record<NoticeKind, { bg: string; fg: string; icon: string; border: string }> = {
  closure: { bg: "#fff4d6", fg: "#5a3b00", icon: "📢", border: "#e0a100" },
  offer: { bg: "#e7f7f3", fg: "#0b5c4f", icon: "🏷️", border: "#12a189" },
  info: { bg: "#e8f0fb", fg: "#1d3b6a", icon: "ℹ️", border: "#5b8bd6" },
};
const KINDS: { key: NoticeKind; label: string; desc: string }[] = [
  { key: "closure", label: "Closure", desc: "We're closed — always shown" },
  { key: "offer", label: "Offer", desc: "A deal — customers can close it" },
  { key: "info", label: "Info", desc: "General news" },
];

// Ready-made starting points (staff change the dates and wording).
function presets(): { label: string; value: Partial<NoticeInput> }[] {
  const y = new Date().getFullYear();
  return [
    { label: "🎄 Christmas closure", value: { kind: "closure", theme: "christmas", pauseBot: true, blockDates: true, message: { en: `🎄 We're closed from 24 December to 2 January. Bookings, drop-offs and pickups start again on 3 January. Merry Christmas and a happy New Year!`, si: "", ta: "" }, startsAt: `${y}-12-24T00:00`, endsAt: `${y + 1}-01-03T00:00` } },
    { label: "🎆 New Year greeting", value: { kind: "info", theme: "newyear", message: { en: `🎆 Happy New Year from all of us at Transco Cargo! Thank you for shipping with us.`, si: "", ta: "" }, startsAt: `${y}-12-31T18:00`, endsAt: `${y + 1}-01-07T00:00` } },
    { label: "🌞 Avurudu closure", value: { kind: "closure", theme: "avurudu", pauseBot: false, blockDates: true, message: { en: "🌞 Happy Avurudu! We're closed on 13–14 April and open again on 15 April.", si: "සුභ අලුත් අවුරුද්දක් වේවා! අප්‍රේල් 13–14 වසා තිබේ. අප්‍රේල් 15 නැවත විවෘතයි.", ta: "" }, startsAt: `${y}-04-13T00:00`, endsAt: `${y}-04-15T00:00` } },
    { label: "🏮 Vesak greeting", value: { kind: "info", theme: "vesak", message: { en: "🏮 Wishing you a peaceful Vesak from Transco Cargo.", si: "සාමකාමී වෙසක් මංගල්‍යයක් වේවා!", ta: "" } } },
    { label: "🏷️ Special offer", value: { kind: "offer", theme: "offer", message: { en: "🏷️ Special offer: 10% off Tea Chests to Sri Lanka this month!", si: "", ta: "" }, link: { label: "Book now", url: "/account.html#/book" } } },
  ];
}

// <input type="datetime-local"> ⇄ ISO, in the browser's (Sydney) time.
const toLocal = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : "");
const fmt = (iso: string) => new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function blank(): NoticeInput {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 7 * 86400000);
  return { kind: "closure", title: "", message: { en: "", si: "", ta: "" }, theme: "none", startsAt: start.toISOString(), endsAt: end.toISOString(), enabled: true, link: null, pauseBot: false, blockDates: false };
}

/** The banner as customers will see it (without the animation). */
function BannerPreview({ n }: { n: Pick<NoticeInput, "kind" | "theme" | "title" | "message" | "link"> }) {
  const th = THEMES.find((t) => t.key === n.theme) ?? THEMES[0]!;
  const plain = PLAIN[n.kind];
  const styled = n.theme !== "none";
  return (
    <div
      className="relative flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-md px-4 py-2.5 text-center text-sm font-semibold"
      style={styled ? { background: th.bg, color: "#fff" } : { background: plain.bg, color: plain.fg, borderBottom: `2px solid ${plain.border}` }}
    >
      <span aria-hidden>{styled ? th.icon : plain.icon}</span>
      <span>
        {n.title && <b>{n.title} — </b>}
        {n.message.en || "Your message…"}
      </span>
      {n.link?.label && <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-[#182233]">{n.link.label}</span>}
      {n.kind !== "closure" && <span className="absolute right-2 text-base opacity-70">✕</span>}
    </div>
  );
}

function NoticesPage() {
  const [list, setList] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; value: NoticeInput } | null>(null);

  const load = () =>
    fetchNotices()
      .then((n) => { setList(n); setError(null); })
      .catch((e) => setError(friendlyError(e, "Couldn't load notices.")));
  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => {
    const now = Date.now();
    const all = list ?? [];
    const live = (n: Notice) => n.enabled && new Date(n.startsAt).getTime() <= now && new Date(n.endsAt).getTime() > now;
    return [
      { title: "Showing now", items: all.filter(live) },
      { title: "Scheduled", items: all.filter((n) => !live(n) && new Date(n.endsAt).getTime() > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt)) },
      { title: "Ended", items: all.filter((n) => new Date(n.endsAt).getTime() <= now) },
    ];
  }, [list]);

  const toggle = async (n: Notice) => {
    try {
      await saveNotice(n.id, { ...n, enabled: !n.enabled });
      void load();
    } catch (e) {
      notify.error(friendlyError(e, "Couldn't change it."));
    }
  };
  const remove = async (n: Notice) => {
    if (!window.confirm("Delete this notice?")) return;
    try {
      await deleteNotice(n.id);
      void load();
    } catch (e) {
      notify.error(friendlyError(e, "Couldn't delete it."));
    }
  };

  return (
    <PageShell width="narrow">
      <PageHeader
        icon={Megaphone}
        title="Website notices"
        description="Banners at the top of the website — closures and offers, with seasonal animations. Schedule them ahead; they appear and disappear on their own."
        actions={
          <Button type="button" onClick={() => setEditing({ id: null, value: blank() })} className="gap-1.5">
            <Plus className="h-4 w-4" /> New notice
          </Button>
        }
      />
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {!list ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        groups.map((g) => (
          <section key={g.title} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {g.title} · {g.items.length}
            </h2>
            {g.items.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {g.items.map((n) => (
                  <li key={n.id} className={cn("rounded-xl border bg-card p-3 shadow-xs", !n.enabled && "opacity-60")}>
                    <BannerPreview n={n} />
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge tone={n.kind === "closure" ? "pending" : n.kind === "offer" ? "success" : "info"}>
                        {KINDS.find((k) => k.key === n.kind)?.label}
                      </StatusBadge>
                      <span>{fmt(n.startsAt)} → {fmt(n.endsAt)}</span>
                      {n.pauseBot && <span>· 🤖 pauses the bot</span>}
                      {n.blockDates && <span>· 📅 blocks drop-off days</span>}
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={n.enabled} onCheckedChange={() => void toggle(n)} aria-label="On or off" />
                        {n.enabled ? "On" : "Off"}
                      </label>
                      <Button type="button" size="sm" variant="outline" className="ml-auto gap-1.5" onClick={() => setEditing({ id: n.id, value: { ...n } })}>
                        <PenLine className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button type="button" size="sm" variant="ghost" aria-label="Delete" onClick={() => void remove(n)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
      {editing && (
        <NoticeEditor
          id={editing.id}
          initial={editing.value}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </PageShell>
  );
}

function NoticeEditor({ id, initial, onClose, onSaved }: { id: string | null; initial: NoticeInput; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<NoticeInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<NoticeInput>) => setV((s) => ({ ...s, ...patch }));
  const setMsg = (lang: "en" | "si" | "ta", text: string) => setV((s) => ({ ...s, message: { ...s.message, [lang]: text } }));

  const save = async () => {
    setError(null);
    if (v.message.en.trim().length < 5) return setError("Write the message in English.");
    if (!v.startsAt || !v.endsAt || new Date(v.endsAt) <= new Date(v.startsAt)) return setError("Check the dates — the end must be after the start.");
    setSaving(true);
    try {
      await saveNotice(id, { ...v, link: v.link?.label && v.link.url ? v.link : null, pauseBot: v.kind === "closure" && v.pauseBot, blockDates: v.kind === "closure" && v.blockDates });
      notify.success(id ? "Notice saved" : "Notice created");
      onSaved();
    } catch (e) {
      setError(friendlyError(e, "Couldn't save the notice."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{id ? "Edit notice" : "New notice"}</DialogTitle>
        </DialogHeader>

        {!id && (
          <div className="flex flex-wrap gap-1.5">
            {presets().map((p) => (
              <button
                key={p.label}
                type="button"
                className="rounded-full border px-2.5 py-1 text-xs hover:bg-secondary"
                onClick={() => set({ ...p.value, startsAt: p.value.startsAt ? fromLocal(p.value.startsAt) : v.startsAt, endsAt: p.value.endsAt ? fromLocal(p.value.endsAt) : v.endsAt })}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <div>
            <Label className="mb-1.5 block">What is it?</Label>
            <div className="grid grid-cols-3 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => set({ kind: k.key })}
                  className={cn("rounded-md border p-2 text-left text-sm", v.kind === k.key ? "border-primary bg-primary/5" : "border-border")}
                >
                  <span className="block font-medium">{k.label}</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">{k.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Look &amp; animation</Label>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => set({ theme: t.key })}
                  className={cn("overflow-hidden rounded-md border text-left text-xs", v.theme === t.key ? "ring-2 ring-primary" : "")}
                >
                  <span className="block h-5" style={{ background: t.bg || PLAIN[v.kind].bg }} />
                  <span className="block px-2 py-1">
                    <span className="font-medium">{t.icon} {t.label}</span>
                    <span className="block text-[10px] text-muted-foreground">{t.anim}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">Preview</Label>
            <BannerPreview n={v} />
            <p className="mt-1 text-[11px] text-muted-foreground">The animation plays on the website.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="n-title">Short title (optional)</Label>
            <Input id="n-title" value={v.title} maxLength={80} placeholder="e.g. Holiday closure" onChange={(e) => set({ title: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="n-en">Message (English)</Label>
            <Textarea id="n-en" value={v.message.en} maxLength={400} rows={3} onChange={(e) => setMsg("en", e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="n-si">Sinhala (optional)</Label>
              <Textarea id="n-si" value={v.message.si} maxLength={400} rows={2} onChange={(e) => setMsg("si", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="n-ta">Tamil (optional)</Label>
              <Textarea id="n-ta" value={v.message.ta} maxLength={400} rows={2} onChange={(e) => setMsg("ta", e.target.value)} />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground">Customers who chose Sinhala or Tamil see that text; if it's blank they see the English.</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="n-start">Starts</Label>
              <Input id="n-start" type="datetime-local" value={toLocal(v.startsAt)} onChange={(e) => set({ startsAt: fromLocal(e.target.value) })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="n-end">Ends</Label>
              <Input id="n-end" type="datetime-local" value={toLocal(v.endsAt)} onChange={(e) => set({ endsAt: fromLocal(e.target.value) })} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="n-ll">Button text (optional)</Label>
              <Input id="n-ll" value={v.link?.label ?? ""} maxLength={40} placeholder="e.g. Book now" onChange={(e) => set({ link: { label: e.target.value, url: v.link?.url ?? "" } })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="n-lu">Button link</Label>
              <Input id="n-lu" value={v.link?.url ?? ""} maxLength={300} placeholder="/account.html#/book" onChange={(e) => set({ link: { label: v.link?.label ?? "", url: e.target.value } })} />
            </div>
          </div>

          {v.kind === "closure" && (
            <div className="flex flex-col gap-2 rounded-lg bg-secondary/50 p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-1" checked={v.pauseBot} onChange={(e) => set({ pauseBot: e.target.checked })} />
                <span>
                  <span className="font-medium">Pause the chat bot during these dates</span>
                  <span className="block text-xs text-muted-foreground">WhatsApp and website chat reply with this message instead (all three languages). The bot comes back by itself when the notice ends.</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" className="mt-1" checked={v.blockDates} onChange={(e) => set({ blockDates: e.target.checked })} />
                <span>
                  <span className="font-medium">Block drop-off days during these dates</span>
                  <span className="block text-xs text-muted-foreground">The online booking form won't offer any drop-off day inside this period.</span>
                </span>
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.enabled} onCheckedChange={(on) => set({ enabled: on })} />
            {v.enabled ? "On — shows between the dates above" : "Off — saved but not shown"}
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : id ? "Save notice" : "Create notice"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
