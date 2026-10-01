import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, ExternalLink, History, PenLine, Plane, Plus, Ship, Trash2 } from "lucide-react";

import { EmptyState, ErrorState, LoadingRows, PageShell, PageHeader, SectionHeading, StatusBadge } from "@/components/transco/page-kit";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { friendlyError, notify } from "@/lib/transco/notify";
import {
  ScheduleError,
  createScheduleDate,
  deleteScheduleDate,
  fetchSchedule,
  updateScheduleDate,
  type ScheduleCountry,
  type ScheduleDate,
} from "@/lib/transco/schedule";

export const Route = createFileRoute("/console/schedule")({
  component: SchedulePage,
});

const COUNTRIES: { key: ScheduleCountry; label: string; page: string }[] = [
  { key: "sri_lanka", label: "🇱🇰 Sri Lanka", page: "/sri-lanka.html" },
  { key: "india", label: "🇮🇳 India", page: "/india.html" },
];
const WEBSITE = "https://transco-agent-site.transcocargo.workers.dev";

/**
 * Staff keep the shipping calendar up to date here: each cutoff date (the
 * last day to hand boxes over in Sydney) with its sea and air arrival. The
 * website's Sri Lanka / India pages show the upcoming ones straight away.
 */
function SchedulePage() {
  const [country, setCountry] = useState<ScheduleCountry>("sri_lanka");
  const [dates, setDates] = useState<ScheduleDate[] | null>(null);
  const [today, setToday] = useState("");
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScheduleDate | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    setDates(null);
    fetchSchedule(country)
      .then((r) => {
        setDates(r.dates);
        setToday(r.today);
      })
      .catch(() => setFailed(true));
  }, [country]);

  useEffect(() => {
    load();
    setAdding(false);
    setEditing(null);
  }, [load]);

  const upcoming = (dates ?? []).filter((d) => d.cutoff >= today);
  const past = (dates ?? []).filter((d) => d.cutoff < today).reverse();
  const current = COUNTRIES.find((c) => c.key === country)!;

  const remove = async () => {
    if (!deleting) return;
    const d = deleting;
    setDeleting(null);
    try {
      await deleteScheduleDate(d.id);
      notify.success("Cutoff date removed", `${fmtLong(d.cutoff)} no longer shows on the website.`);
      load();
    } catch (err) {
      notify.error("Couldn't remove that date", friendlyError(err, "Nothing was changed — please try again."));
    }
  };

  return (
    <PageShell width="narrow">
      <PageHeader
        icon={CalendarDays}
        title="Shipping calendar"
        description="The cutoff dates customers see on the website — the last day to hand boxes over in Sydney, with when sea and air shipments arrive."
        actions={
          <Button type="button" onClick={() => { setAdding(true); setEditing(null); }} disabled={adding}>
            <Plus className="mr-1.5 h-4 w-4" /> Add a cutoff date
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-lg bg-secondary p-1" role="tablist" aria-label="Destination">
          {COUNTRIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={country === c.key}
              onClick={() => setCountry(c.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                country === c.key ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <a href={`${WEBSITE}${current.page}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          See it on the website <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>

      {adding && (
        <DateForm
          key={`new-${country}`}
          country={country}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      {failed ? (
        <ErrorState title="Couldn't load the calendar" onRetry={load} />
      ) : !dates ? (
        <LoadingRows rows={3} />
      ) : (
        <>
          <SectionHeading>Upcoming · shown on the website</SectionHeading>
          {upcoming.length === 0 ? (
            <div className="rounded-xl border bg-card">
              <EmptyState
                icon={CalendarDays}
                title="No upcoming dates"
                description="The website says the next dates are being confirmed. Add the next cutoff date so customers can plan."
                action={
                  !adding ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
                      <Plus className="mr-1.5 h-4 w-4" /> Add a cutoff date
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {upcoming.map((d, i) =>
                editing === d.id ? (
                  <li key={d.id}>
                    <DateForm
                      country={country}
                      existing={d}
                      onCancel={() => setEditing(null)}
                      onSaved={() => {
                        setEditing(null);
                        load();
                      }}
                    />
                  </li>
                ) : (
                  <DateCard key={d.id} date={d} next={i === 0} onEdit={() => { setEditing(d.id); setAdding(false); }} onDelete={() => setDeleting(d)} />
                ),
              )}
            </ul>
          )}

          {past.length > 0 && (
            <details className="group mt-8">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                <History className="h-4 w-4" aria-hidden /> Recent past cutoffs ({past.length}) — no longer on the website
              </summary>
              <ul className="mt-3 flex flex-col gap-2 opacity-75">
                {past.map((d) => (
                  <DateCard key={d.id} date={d} past onEdit={() => setEditing(d.id)} onDelete={() => setDeleting(d)} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this cutoff date?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${fmtLong(deleting.cutoff)} will disappear from the website straight away.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void remove()}>
              Remove date
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/** One cutoff, laid out like the website card so staff see what customers see. */
function DateCard({ date: d, next = false, past = false, onEdit, onDelete }: { date: ScheduleDate; next?: boolean; past?: boolean; onEdit: () => void; onDelete: () => void }) {
  const c = new Date(`${d.cutoff}T00:00:00`);
  return (
    <li className={cn("flex items-center gap-4 rounded-xl border bg-card px-4 py-3 shadow-xs", next && "border-warning bg-warning-soft/40")}>
      <div className="w-14 shrink-0 text-center">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{c.toLocaleDateString("en-AU", { month: "short" })}</p>
        <p className="text-3xl font-bold leading-none tabular-nums text-foreground">{String(c.getDate()).padStart(2, "0")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{c.toLocaleDateString("en-AU", { weekday: "short" })}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {next && <StatusBadge tone="pending">Next cutoff</StatusBadge>}
          {past && <StatusBadge tone="neutral">Past</StatusBadge>}
          {d.note && <span className="text-sm text-muted-foreground">{d.note}</span>}
        </div>
        <p className="flex items-center gap-2 text-sm">
          <Ship className="h-4 w-4 text-info" aria-hidden />
          <span className="w-24 font-medium text-info-foreground">Sea freight</span>
          <span className="tabular-nums text-foreground">{d.seaArrival ? fmtShort(d.seaArrival) : "To be confirmed"}</span>
        </p>
        <p className="flex items-center gap-2 text-sm">
          <Plane className="h-4 w-4 text-success" aria-hidden />
          <span className="w-24 font-medium text-success-foreground">Air freight</span>
          <span className="tabular-nums text-foreground">{d.airArrival ? fmtShort(d.airArrival) : "To be confirmed"}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="icon" onClick={onEdit} aria-label="Edit this date" title="Edit">
          <PenLine className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={onDelete} aria-label="Remove this date" title="Remove">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

function DateForm({ country, existing, onCancel, onSaved }: { country: ScheduleCountry; existing?: ScheduleDate; onCancel: () => void; onSaved: () => void }) {
  const [cutoff, setCutoff] = useState(existing?.cutoff ?? "");
  const [sea, setSea] = useState(existing?.seaArrival ?? "");
  const [air, setAir] = useState(existing?.airArrival ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cutoff) {
      setError({ message: "Enter the cutoff date.", field: "cutoff" });
      return;
    }
    setSaving(true);
    setError(null);
    const input = { country, cutoff, seaArrival: sea || null, airArrival: air || null, note: note.trim() || null };
    try {
      if (existing) await updateScheduleDate(existing.id, input);
      else await createScheduleDate(input);
      notify.success(existing ? "Cutoff date updated" : "Cutoff date added", "The website shows it straight away.");
      onSaved();
    } catch (err) {
      setError({ message: friendlyError(err, "Couldn't save — please try again."), field: err instanceof ScheduleError ? err.field : null });
    } finally {
      setSaving(false);
    }
  };

  const bad = (f: string) => error?.field === f || undefined;

  return (
    <form onSubmit={save} className="mb-4 rounded-xl border border-primary/40 bg-card p-4 shadow-xs">
      <p className="mb-3 text-sm font-semibold text-foreground">{existing ? "Edit cutoff date" : "New cutoff date"}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cutoff">Cutoff (hand over by)</Label>
          <Input id="cutoff" type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} aria-invalid={bad("cutoff")} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sea">Sea freight arrives</Label>
          <Input id="sea" type="date" value={sea} min={cutoff || undefined} onChange={(e) => setSea(e.target.value)} aria-invalid={bad("seaArrival")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="air">Air freight arrives</Label>
          <Input id="air" type="date" value={air} min={cutoff || undefined} onChange={(e) => setAir(e.target.value)} aria-invalid={bad("airArrival")} />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. Christmas shipment — book early" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Leave an arrival empty if it isn't known yet — the website shows “To be confirmed”.</p>
      {error && <p className="mt-3 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">{error.message}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : existing ? "Save changes" : "Add date"}
        </Button>
      </div>
    </form>
  );
}

function fmtShort(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function fmtLong(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
}
