import { useEffect, useMemo, useState, type ReactNode } from "react";
import { History, Minus, Package, Plus, Truck, UserRound, Users } from "lucide-react";

import { ErrorState, LoadingRows } from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DeclarationPerson } from "@/lib/transco/declaration-print";
import {
  FieldError,
  fetchBookingForEdit,
  saveBookingDetails,
  type BookingDetailsUpdate,
  type BookingEditData,
} from "@/lib/transco/my-transco";
import { friendlyError, notify } from "@/lib/transco/notify";

/**
 * Staff edit a booking after it was made — the customer brought different
 * boxes to drop-off, a name is misspelt, the receiver changed. Covers the
 * declaration (sender + receiver), the box list, delivery and notes; only
 * the sections actually changed are sent. The printout uses the new
 * details straight away, and every save is recorded with who made it.
 */
export function BookingDetailsEditor({
  bookingId,
  open,
  onOpenChange,
  onSaved,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<BookingEditData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    setData(null);
    fetchBookingForEdit(bookingId)
      .then(setData)
      .catch(() => setFailed(true));
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookingId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-4 pr-12">
          <SheetTitle>Edit booking {data?.bookingCode ?? ""}</SheetTitle>
          <SheetDescription>
            Change what the customer brought or fix their details. The declaration printout updates straight away.
          </SheetDescription>
        </SheetHeader>
        {failed ? (
          <div className="p-6">
            <ErrorState compact title="Couldn't load this booking" onRetry={load} />
          </div>
        ) : !data ? (
          <div className="p-6">
            <LoadingRows rows={5} />
          </div>
        ) : (
          <EditorForm
            key={data.bookingId}
            data={data}
            onCancel={() => onOpenChange(false)}
            onSaved={() => {
              onOpenChange(false);
              onSaved?.();
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

const EMPTY_PERSON: DeclarationPerson = { fullName: "", address: "", mobile: "", email: "", town: "", idNumber: "" };

function EditorForm({ data, onCancel, onSaved }: { data: BookingEditData; onCancel: () => void; onSaved: () => void }) {
  const initialQty = useMemo(() => Object.fromEntries(data.items.map((i) => [i.type, i.qty])), [data]);
  const [qty, setQty] = useState<Record<string, number>>(initialQty);
  const [delivery, setDelivery] = useState(data.deliveryType ?? "");
  const [sender, setSender] = useState<DeclarationPerson>({ ...EMPTY_PERSON, ...(data.sender ?? {}) });
  const [receiver, setReceiver] = useState<DeclarationPerson>({ ...EMPTY_PERSON, ...(data.receiver ?? {}) });
  const [notes, setNotes] = useState(data.notes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; field: string | null } | null>(null);

  const items = data.itemTypes.map((t) => ({ type: t.key, qty: qty[t.key] ?? 0 })).filter((i) => i.qty > 0);
  const totalBoxes = items.reduce((n, i) => n + i.qty, 0);

  const personDiffers = (a: DeclarationPerson, b: DeclarationPerson | null, withId: boolean) => {
    const keys: (keyof DeclarationPerson)[] = withId ? ["fullName", "address", "town", "mobile", "email", "idNumber"] : ["fullName", "address", "mobile", "email"];
    return keys.some((k) => (a[k] ?? "").trim() !== ((b?.[k] ?? "") as string).trim());
  };

  const update: BookingDetailsUpdate = {};
  if (data.country && JSON.stringify(items) !== JSON.stringify(data.itemTypes.map((t) => ({ type: t.key, qty: initialQty[t.key] ?? 0 })).filter((i) => i.qty > 0))) {
    update.items = items;
  }
  if (delivery && delivery !== (data.deliveryType ?? "")) update.deliveryType = delivery;
  if (personDiffers(sender, data.sender, false)) {
    update.sender = { fullName: sender.fullName.trim(), address: sender.address.trim(), mobile: sender.mobile.trim(), email: sender.email.trim() };
  }
  if (personDiffers(receiver, data.receiver, true)) {
    update.receiver = {
      fullName: receiver.fullName.trim(),
      address: receiver.address.trim(),
      town: (receiver.town ?? "").trim(),
      mobile: receiver.mobile.trim(),
      email: receiver.email.trim(),
      idNumber: (receiver.idNumber ?? "").replace(/\s/g, "").toUpperCase(),
    };
  }
  if (notes.trim() !== data.notes.trim()) update.notes = notes;
  const dirty = Object.keys(update).length > 0;

  const save = async () => {
    if (update.items && totalBoxes === 0) {
      setError({ message: "Please keep at least one box on the booking.", field: "items" });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { changed } = await saveBookingDetails(data.bookingId, update);
      notify.success("Booking updated", changed.length ? `Changed: ${changed.join(", ")}. The declaration printout now shows the new details.` : undefined);
      onSaved();
    } catch (err) {
      const field = err instanceof FieldError ? err.field : null;
      setError({ message: friendlyError(err, "Couldn't save the changes. Nothing was changed."), field });
      const el = field ? document.getElementById(`edit-${field.replace(".", "-")}`) : null;
      el?.focus();
      el?.scrollIntoView({ block: "center" });
    } finally {
      setSaving(false);
    }
  };

  const bad = (f: string) => error?.field === f;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-6">
          {/* Boxes */}
          <EditSection icon={Package} title="Boxes" hint={data.country ? `${totalBoxes} box${totalBoxes === 1 ? "" : "es"} · ${data.countryLabel}` : undefined}>
            {data.country ? (
              <ul className="divide-y rounded-lg border" id="edit-items">
                {data.itemTypes.map((t) => {
                  const n = qty[t.key] ?? 0;
                  return (
                    <li key={t.key} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className={cn("text-sm", n > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>{t.label}</span>
                      <span className="inline-flex items-center gap-1">
                        <StepButton label={`Remove one ${t.label}`} disabled={n === 0} onClick={() => setQty((q) => ({ ...q, [t.key]: Math.max(0, n - 1) }))}>
                          <Minus className="h-4 w-4" />
                        </StepButton>
                        <output className="w-8 text-center text-base font-semibold tabular-nums" aria-live="polite">
                          {n}
                        </output>
                        <StepButton label={`Add one ${t.label}`} disabled={n >= 30} onClick={() => setQty((q) => ({ ...q, [t.key]: Math.min(30, n + 1) }))}>
                          <Plus className="h-4 w-4" />
                        </StepButton>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="rounded-lg bg-secondary px-3 py-2 text-sm text-muted-foreground">
                Booked in the chat: “{data.boxSummary || "no box details"}”. Change this text with <strong>Edit booking</strong> in the Bookings list.
              </p>
            )}
          </EditSection>

          {/* Delivery */}
          <EditSection icon={Truck} title="Delivery">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" id="edit-deliveryType">
              {data.deliveryTypes.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  role="radio"
                  aria-checked={delivery === d.key}
                  onClick={() => setDelivery(d.key)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    delivery === d.key ? "border-primary bg-accent/50 font-medium text-foreground" : "border-border hover:border-primary/40",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </EditSection>

          {/* Sender */}
          <EditSection icon={UserRound} title="Sender" hint={data.sender && !data.senderIsAccountHolder ? "Someone else, on behalf of the account holder" : undefined}>
            <PersonFields prefix="sender" person={sender} onChange={setSender} bad={bad} />
          </EditSection>

          {/* Receiver */}
          <EditSection icon={Users} title="Receiver">
            <PersonFields prefix="receiver" person={receiver} onChange={setReceiver} bad={bad} withId />
          </EditSection>

          {/* Notes */}
          <EditSection title="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the team should know" maxLength={300} rows={2} />
          </EditSection>

          {data.staffEdits.length > 0 && (
            <div className="rounded-lg bg-secondary/60 px-3 py-2.5">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <History className="h-3.5 w-3.5" aria-hidden /> Earlier changes
              </p>
              <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                {data.staffEdits.map((e, i) => (
                  <li key={i}>
                    {new Date(e.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {e.by} ·{" "}
                    {e.changed.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="border-t bg-card px-6 py-3">
        {error && <p className="mb-2 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">{error.message}</p>}
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm text-muted-foreground">{dirty ? "Unsaved changes" : "No changes yet"}</span>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </>
  );
}

function EditSection({ icon: Icon, title, hint, children }: { icon?: typeof Package; title: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />}
          {title}
        </h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-lg border text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function PersonFields({
  prefix,
  person,
  onChange,
  bad,
  withId = false,
}: {
  prefix: "sender" | "receiver";
  person: DeclarationPerson;
  onChange: (p: DeclarationPerson) => void;
  bad: (field: string) => boolean;
  withId?: boolean;
}) {
  const set = (k: keyof DeclarationPerson) => (e: { target: { value: string } }) => onChange({ ...person, [k]: e.target.value });
  const field = (k: keyof DeclarationPerson, label: string, props: Record<string, string> = {}) => {
    const id = `edit-${prefix}-${k}`;
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input id={id} value={(person[k] as string) ?? ""} onChange={set(k)} aria-invalid={bad(`${prefix}.${k}`) || undefined} {...props} />
      </div>
    );
  };
  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border px-3 py-3 sm:grid-cols-2">
      <div className="sm:col-span-2">{field("fullName", "Full name (as on passport or NIC)", { maxLength: "80" })}</div>
      <div className="sm:col-span-2">{field("address", "Address", { maxLength: "200" })}</div>
      {withId && field("town", "Town or city", { maxLength: "60" })}
      {withId && field("idNumber", "Passport or NIC number", { maxLength: "20", autoCapitalize: "characters" })}
      {field("mobile", "Mobile (with country code)", { type: "tel", maxLength: "24" })}
      {field("email", "Email", { type: "email", maxLength: "120" })}
    </div>
  );
}
