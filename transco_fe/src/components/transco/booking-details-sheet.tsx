import { CostingCard } from "@/components/transco/costing-card";
import { HandoverTags } from "@/components/transco/handover-tags";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Mail, PenLine, Plus, Printer, ShipIcon, UserRound, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchDeclaration,
  sendFormsEmail,
  type DeclarationPerson,
  type DeclarationPrintData,
} from "@/lib/transco/declaration-print";
import { finaliseWalkIn } from "@/lib/transco/api";
import { formatDate } from "@/lib/transco/my-transco";
import { friendlyError, notify } from "@/lib/transco/notify";
import { BookingDetailsEditor } from "@/components/transco/booking-details-editor";
import { FormsCard, PrintPreviewDialog } from "@/components/transco/forms-print";
import { AirFreightCard } from "@/components/transco/air-freight-card";
import { ShipmentPicker } from "@/components/transco/shipment-picker";
import { MoveShipmentControl } from "@/components/transco/move-shipment";
import { Breadcrumbs, PageShell, StatusBadge } from "@/components/transco/page-kit";
import { formatPhone } from "@/lib/transco/phone";

/**
 * Everything staff need about one booking in one place — customer,
 * sender, receiver and boxes, as filled in the online declaration — with
 * Print at the top. Opened by clicking a booking on the Bookings page.
 * Loads from the same staff endpoint the printout uses, so what's on
 * screen is exactly what prints.
 *
 * Walk-ins (the form a customer filled on their phone at the counter)
 * also show what's inside, their insurance answer and signature, and the
 * Finalise step: staff check the boxes, add weight/CBM/office-use
 * charges, and finalise — which links the customer and emails their copy.
 */
export function BookingDetailsSheet({
  bookingId,
  open,
  onOpenChange,
  onAssignBl,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the "Weights, price & BL" sheet — offered once a walk-in is finalised. */
  onAssignBl?: () => void;
}) {
  const [data, setData] = useState<DeclarationPrintData | null>(null);
  const [error, setError] = useState("");
  const [previewAll, setPreviewAll] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    setError("");
    fetchDeclaration(bookingId)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load the booking"));
  }, [bookingId]);

  // Fresh every time it opens — staff may have just changed something.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Every print goes through a preview first.
  const print = () => setPreviewAll(true);

  const d = data && data.bookingId === bookingId ? data : null;
  const walkIn = d?.walkIn ?? null;
  const confirm = d?.confirm ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-6">
          <SheetTitle className="tabular-nums">{d?.bookingCode ?? "Booking"}</SheetTitle>
          <SheetDescription>
            {d ? [d.customer.name ?? d.sender?.fullName ?? "No name", d.itemsText].filter(Boolean).join(" · ") : "Loading booking details…"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-2 flex flex-col gap-5 text-sm">
          <div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={print} disabled={!d} variant={confirm?.status === "submitted" ? "outline" : "default"}>
                <Printer className="mr-2 h-4 w-4" />
                Print forms
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={!d}>
                <PenLine className="mr-2 h-4 w-4" />
                Change details
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-lg bg-attention-soft p-3 text-sm">
              <p className="font-medium text-attention-foreground">{error}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2 h-7" onClick={load}>
                Try again
              </Button>
            </div>
          ) : !d ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <>
              {confirm && <FinaliseSection key={`${d.bookingId}-${confirm.status}`} data={d} onDone={load} onAssignBl={onAssignBl} />}
              {d.blNumber && <SendFormsEmail data={d} onSent={load} />}
              <FormsCard key={`${d.bookingId}-${d.serviceKey}-${d.dangerousGoods?.lithium ? "li" : ""}`} bookingId={d.bookingId} />

              <BookingInfo d={d} />
            </>
          )}
        </div>
      </SheetContent>
      <BookingDetailsEditor bookingId={bookingId} open={editing} onOpenChange={setEditing} onSaved={load} />
      {previewAll && <PrintPreviewDialog bookingId={bookingId} form={{ key: "all", title: "All forms" }} onClose={() => setPreviewAll(false)} />}
    </Sheet>
  );
}

/**
 * One booking as a full page — where staff do the drop-off work: the
 * Confirm area (BL, what's inside with values, insurance, weight/CBM,
 * charges) on the left, and everything to check against (forms, send
 * email, customer, sender, receiver, shipment) on the right.
 */
export function BookingWorkspace({ bookingId }: { bookingId: string }) {
  const [data, setData] = useState<DeclarationPrintData | null>(null);
  const [error, setError] = useState("");
  const [previewAll, setPreviewAll] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    setError("");
    fetchDeclaration(bookingId)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load the booking"));
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  const d = data && data.bookingId === bookingId ? data : null;
  const confirm = d?.confirm ?? null;
  const name = d ? d.customer.name ?? d.sender?.fullName ?? "No name" : "";

  return (
    <PageShell width="full" className="max-w-350">
      <header className="mb-5">
        <Breadcrumbs items={[{ label: "Bookings", to: "/console/bookings" }, { label: d?.bookingCode ?? "Booking" }]} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight text-foreground">
              <span className="tabular-nums">{d?.bookingCode ?? "Booking"}</span>
              {d?.blNumber && <span className="text-base font-semibold text-primary tabular-nums">BL {d.blNumber}</span>}
              {d && (
                <span className="text-base font-normal">
                  <HandoverTags booking={{ handover: d.handover, deliveryType: d.deliveryKey === "door" ? "door" : null, pickupNote: d.pickupNote }} />
                </span>
              )}
              {confirm &&
                (confirm.status === "finalised" ? (
                  <StatusBadge tone="success">Confirmed</StatusBadge>
                ) : (
                  <StatusBadge tone="attention">To confirm</StatusBadge>
                ))}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{d ? [name, d.itemsText, [d.destination, d.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ") : "Loading…"}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={!d}>
              <PenLine className="mr-2 h-4 w-4" /> Change details
            </Button>
            <Button type="button" onClick={() => setPreviewAll(true)} disabled={!d}>
              <Printer className="mr-2 h-4 w-4" /> Print forms
            </Button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-lg bg-attention-soft p-4 text-sm">
          <p className="font-medium text-attention-foreground">{error}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={load}>
            Try again
          </Button>
        </div>
      ) : !d ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Skeleton className="h-120 w-full" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* Left: the work. */}
          <div className="flex flex-col gap-5 text-sm">
            {confirm ? (
              // Re-reads after a costing save, which fills the office-use boxes.
              <FinaliseSection key={`${d.bookingId}-${confirm.status}-${d.costing?.updatedAt ?? ""}`} data={d} onDone={load} />
            ) : (
              <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                This booking has no online declaration to confirm (it was made in the chat). Record weights, price and the BL from
                the booking's ⋯ menu on the Bookings page, and fill the printed forms by hand.
              </section>
            )}
            <CostingCard key={`${d.bookingId}-${d.costing?.updatedAt ?? "new"}`} data={d} onSaved={load} />
            {d.shipmentId && (
              <MoveShipmentControl
                key={`${d.shipmentId}-${d.batchNumber ?? "none"}`}
                shipmentId={d.shipmentId}
                currentBatchNumber={d.batchNumber}
                blNumber={d.blNumber}
                customerName={d.customer.name ?? d.sender?.fullName}
                onMoved={load}
              />
            )}
            {d.serviceKey === "air" && <AirFreightCard key={`${d.bookingId}-air`} data={d} onSaved={load} />}
            {d.blNumber && <SendFormsEmail data={d} onSent={load} />}
          </div>
          {/* Right: what to check against. */}
          <div className="flex flex-col gap-5 text-sm lg:sticky lg:top-4">
            <FormsCard key={`${d.bookingId}-${d.serviceKey}-${d.dangerousGoods?.lithium ? "li" : ""}`} bookingId={d.bookingId} />
            <BookingInfo d={d} />
          </div>
        </div>
      )}

      <BookingDetailsEditor bookingId={bookingId} open={editing} onOpenChange={setEditing} onSaved={load} />
      {previewAll && <PrintPreviewDialog bookingId={bookingId} form={{ key: "all", title: "All forms" }} onClose={() => setPreviewAll(false)} />}
    </PageShell>
  );
}

/** The booking's reference details: customer, declaration, sender, receiver, shipment, items, signature. */
function BookingInfo({ d }: { d: DeclarationPrintData }) {
  const walkIn = d.walkIn;
  return (
    <>
  <Section title="Customer">
    <Rows
      rows={[
        ["Name", d.customer.name ?? (walkIn?.status === "submitted" ? d.sender?.fullName : null)],
        ["Customer no.", d.customer.customerCode],
        ["Phone", d.customer.phoneNumber ? formatPhone(d.customer.phoneNumber) : null],
      ]}
    />
    {d.customer.id ? (
      <CustomerLink customerId={d.customer.id} myTransco={d.channel === "portal"} />
    ) : walkIn?.status === "submitted" ? (
      <p className="mt-2 text-xs text-muted-foreground">Linked to the customer's profile by phone number when you finalise.</p>
    ) : null}
  </Section>

  <div className="flex flex-wrap items-center gap-2">
    <span className="text-xs font-semibold text-foreground">Declaration</span>
    {walkIn ? (
      <Badge variant="secondary" className="text-xs">Filled on the customer's phone</Badge>
    ) : d.declarationSubmittedAt ? (
      <Badge variant="secondary" className="text-xs">Filled online</Badge>
    ) : (
      <Badge variant="outline" className="text-xs">Not filled online — fill in on the printout</Badge>
    )}
    {d.declarationStatus === "received" && <Badge className="text-xs">Checked</Badge>}
  </div>

  <PersonSection
    title={d.sender && !d.senderIsAccountHolder ? "Sender (someone else)" : "Sender"}
    person={d.sender}
    showId={!!d.sender?.idNumber}
  />
  <PersonSection title="Receiver" person={d.receiver} showId />

  <Section title="Shipment">
    <Rows
      rows={[
        ["Boxes", d.itemsText || d.items.map((i) => `${i.qty} × ${i.label}`).join(", ")],
        ["Service", d.service],
        ["Destination", [d.destination, d.country].filter(Boolean).join(", ")],
        ["Delivery", d.delivery],
        d.handover === "pickup"
          ? ["Home pickup", ["Customer calls Sajith to arrange", d.pickupNote].filter(Boolean).join(" · ")]
          : [walkIn ? "Came in" : "Drop-off", d.dropOff ? [d.dropOff.date ? formatDate(d.dropOff.date) : null, d.dropOff.time].filter(Boolean).join(" · ") : null],
        ["Insurance", d.insurance === null ? null : d.insurance ? "Yes — wants insurance" : "No"],
        ["BL number", d.blNumber],
        ["Customer note", d.notes],
      ]}
    />
  </Section>

  {d.contents.length > 0 && <ContentsSection contents={d.contents} />}

  {d.signature && (
    <Section title="Signed">
      <p className="text-xs font-medium text-foreground">{d.signature.name}</p>
      {d.signature.image ? (
        <img src={d.signature.image} alt={`Signature of ${d.signature.name ?? "the sender"}`} className="mt-2 h-16 w-auto rounded border bg-white p-1" />
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">Not drawn — they sign the printout by pen.</p>
      )}
    </Section>
  )}
    </>
  );
}

// ---------- walk-in finalise ----------

const OFFICE_FIELDS = [
  { key: "freight", label: "Freight" },
  { key: "pickup", label: "Pickup" },
  { key: "doorToDoor", label: "D to D" },
  { key: "discount", label: "Discount" },
] as const;

type OfficeKey = (typeof OFFICE_FIELDS)[number]["key"] | "total";

type ItemRow = { description: string; condition: "new" | "used"; qty: string; value: string };

function asText(n: number | null | undefined) {
  return typeof n === "number" ? String(n) : "";
}
function asNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function FinaliseSection({
  data,
  onDone,
  onAssignBl,
}: {
  data: DeclarationPrintData;
  onDone: () => void;
  onAssignBl?: (() => void) | undefined;
}) {
  const finalised = data.confirm?.status === "finalised";
  const isWalkIn = !!data.walkIn;
  const hasBl = !!data.blNumber;
  const [bl, setBl] = useState("");
  const [batch, setBatch] = useState("");
  const [weight, setWeight] = useState(asText(data.weight));
  const [cbm, setCbm] = useState(asText(data.cbm));
  const [office, setOffice] = useState<Record<OfficeKey, string>>({
    freight: asText(data.officeUse?.freight),
    pickup: asText(data.officeUse?.pickup),
    doorToDoor: asText(data.officeUse?.doorToDoor),
    discount: asText(data.officeUse?.discount),
    total: asText(data.officeUse?.total),
  });
  const [centre, setCentre] = useState(data.collectionCentre ?? "");
  // What's inside — staff value every item (the customer never enters
  // values), and can add/remove/change items when the customer does at
  // the counter.
  const [rows, setRows] = useState<ItemRow[]>(() =>
    data.contents.map((c) => ({ description: c.description, condition: c.condition, qty: String(c.qty), value: asText(c.value) })),
  );
  const [badRows, setBadRows] = useState<Set<number>>(() => new Set());
  const [insurance, setInsurance] = useState<boolean | null>(data.insurance);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const valueTotal = rows.reduce((s, r) => {
    const v = asNumber(r.value);
    return s + (v !== null && !Number.isNaN(v) ? v : 0);
  }, 0);
  const updateRow = (i: number, patch: Partial<ItemRow>) => {
    setRows((s) => s.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    if (badRows.has(i)) setBadRows((s) => new Set([...s].filter((j) => j !== i)));
  };

  const n = (k: OfficeKey) => asNumber(office[k]);
  const anyCharge = OFFICE_FIELDS.some((f) => f.key !== "discount" && office[f.key].trim());
  const autoTotal = anyCharge ? (n("freight") || 0) + (n("pickup") || 0) + (n("doorToDoor") || 0) - (n("discount") || 0) : null;

  const submit = async () => {
    setFormError("");
    const blNumber = bl.trim();
    if (!hasBl && !blNumber) {
      setFormError("Enter the BL number — the declaration is confirmed once its BL is assigned.");
      return;
    }
    if (blNumber && !/^[A-Za-z0-9-]{1,32}$/.test(blNumber)) {
      setFormError("The BL number can only have letters, numbers and hyphens.");
      return;
    }
    const batchNumber = batch.trim() === "" ? null : Number(batch);
    if (batchNumber !== null && (!Number.isInteger(batchNumber) || batchNumber < 1)) {
      setFormError("The shipment number must be a whole number, e.g. 57.");
      return;
    }
    if (!rows.length) {
      setFormError("Add at least one item that is inside the boxes.");
      return;
    }
    const bad = new Set<number>();
    const contents = rows.map((r, i) => {
      const qty = Number(r.qty);
      const value = asNumber(r.value);
      if (r.description.trim().length < 2 || !Number.isInteger(qty) || qty < 1 || qty > 999 || value === null || Number.isNaN(value)) bad.add(i);
      return { description: r.description.trim(), condition: r.condition, qty, value: value ?? 0 };
    });
    setBadRows(bad);
    if (bad.size) {
      setFormError(`Check the item${bad.size === 1 ? "" : "s"} marked in red — each needs a description, how many, and a value (0 is fine).`);
      return;
    }
    const values = { weight: asNumber(weight), cbm: asNumber(cbm), freight: n("freight"), pickup: n("pickup"), doorToDoor: n("doorToDoor"), discount: n("discount"), total: n("total") };
    if (Object.values(values).some((v) => Number.isNaN(v))) {
      setFormError("Numbers only, please (0 or more).");
      return;
    }
    setSaving(true);
    try {
      const result = await finaliseWalkIn(data.bookingId, {
        ...(blNumber ? { hblNumber: blNumber, batchNumber } : {}),
        contents,
        ...(insurance !== null ? { insurance } : {}),
        weight: values.weight,
        cbm: values.cbm,
        officeUse: { freight: values.freight, pickup: values.pickup, doorToDoor: values.doorToDoor, discount: values.discount, total: values.total },
        collectionCentre: centre.trim() || null,
      });
      notify.success(
        finalised ? "Saved" : `BL ${result.hblNumber ?? ""} assigned — declaration confirmed`,
        finalised ? undefined : isWalkIn ? "Linked to the customer's My Transco account. Use “Send email” to send the forms to the office." : "Use “Send email” to send the forms to the office.",
      );
      onDone();
    } catch (err) {
      setFormError(friendlyError(err, "Could not finalise. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={finalised ? "@container rounded-lg border bg-panel p-3" : "@container rounded-lg border-2 border-primary/40 bg-card p-3"}>
      {finalised ? (
        <div className="mb-3 flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-foreground" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Confirmed{data.blNumber ? <> · BL <span className="tabular-nums">{data.blNumber}</span></> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {[data.confirm?.finalisedAt ? formatDate(data.confirm.finalisedAt) : null, data.confirm?.finalisedBy ? `by ${data.confirm.finalisedBy}` : null].filter(Boolean).join(" ")}
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <p className="text-sm font-semibold text-foreground">{isWalkIn ? "Confirm this walk-in" : "Confirm the drop-off"}</p>
          <p className="text-xs text-muted-foreground">
            {isWalkIn
              ? "Check the boxes with the customer, value each item, then assign the BL number — that confirms the declaration and sets up their My Transco account."
              : "The customer filled the declaration when booking. Check the boxes, value each item, then assign the BL number."}
          </p>
        </div>
      )}

      {hasBl ? (
        <p className="mb-3 text-xs text-muted-foreground">To change the BL or shipment number, use “Weights, price &amp; BL” on the booking.</p>
      ) : (
        <div className="mb-4 grid grid-cols-[1fr_11rem] gap-3">
          <Field id="fin-bl" label="BL number" value={bl} onChange={setBl} inputMode="text" hint="Required — the customer's main reference." />
          <div className="flex flex-col gap-1">
            <Label htmlFor="fin-batch" className="text-xs">Shipment</Label>
            <ShipmentPicker id="fin-batch" value={batch} onChange={setBatch} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground" />
          </div>
        </div>
      )}

      <div className="mb-4">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What's inside · value of each item ($) required</p>
        <ul className="divide-y rounded-md border bg-card">
          {rows.map((r, i) => {
            const bad = badRows.has(i);
            return (
              <li key={i} className={`grid grid-cols-[minmax(0,1fr)_5.5rem_3.5rem_5rem_1.75rem] items-center gap-1.5 px-2 py-1.5 ${bad ? "bg-attention-soft/40" : ""}`}>
                <Input
                  aria-label={`Item ${i + 1}`}
                  value={r.description}
                  placeholder="Item"
                  onChange={(e) => updateRow(i, { description: e.target.value })}
                  className="h-8 text-xs"
                />
                <select
                  aria-label={`Item ${i + 1}: new or used`}
                  value={r.condition}
                  onChange={(e) => updateRow(i, { condition: e.target.value as "new" | "used" })}
                  className="h-8 rounded-md border border-input bg-card px-1.5 text-xs text-foreground"
                >
                  <option value="new">New</option>
                  <option value="used">Used</option>
                </select>
                <Input
                  aria-label={`Item ${i + 1}: how many`}
                  value={r.qty}
                  inputMode="numeric"
                  onChange={(e) => updateRow(i, { qty: e.target.value })}
                  className="h-8 px-1.5 text-center text-xs tabular-nums"
                />
                <Input
                  aria-label={`Item ${i + 1}: value in dollars`}
                  value={r.value}
                  inputMode="decimal"
                  placeholder="$"
                  aria-invalid={bad || undefined}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                  className="h-8 px-1.5 text-right text-xs tabular-nums"
                />
                <button
                  type="button"
                  aria-label={`Remove item ${i + 1}`}
                  onClick={() => {
                    setRows((s) => s.filter((_, j) => j !== i));
                    setBadRows(new Set());
                  }}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-attention-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
          <li className="flex items-center justify-between gap-2 px-2.5 py-1.5">
            <button
              type="button"
              onClick={() => setRows((s) => [...s, { description: "", condition: "new", qty: "1", value: "" }])}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add item
            </button>
            <span className="text-xs font-semibold tabular-nums text-foreground">Total value ${Math.round(valueTotal * 100) / 100}</span>
          </li>
        </ul>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-foreground">Insurance wanted?</span>
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => setInsurance(v)}
            aria-pressed={insurance === v}
            className={`rounded-md border px-3 py-1 font-medium ${insurance === v ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:text-foreground"}`}
          >
            {v ? "Yes" : "No"}
          </button>
        ))}
        {insurance === true && <span className="text-muted-foreground">Contact Supun on 03 9357 7228 for cover.</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <Field id="fin-weight" label="Weight (kg)" value={weight} onChange={setWeight} />
        <Field id="fin-cbm" label="CBM" value={cbm} onChange={setCbm} />
      </div>

      <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Office use · charges ($)</p>
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3">
        {OFFICE_FIELDS.map((f) => (
          <Field key={f.key} id={`fin-${f.key}`} label={f.key === "discount" ? "Discount (−)" : f.label} value={office[f.key]} onChange={(v) => setOffice((s) => ({ ...s, [f.key]: v }))} />
        ))}
        <Field
          id="fin-total"
          label="Total due"
          value={office.total}
          placeholder={autoTotal !== null && !Number.isNaN(autoTotal) ? String(Math.round(autoTotal * 100) / 100) : ""}
          onChange={(v) => setOffice((s) => ({ ...s, total: v }))}
          hint={office.total.trim() ? undefined : autoTotal !== null ? "Worked out for you" : undefined}
        />
        <Field id="fin-centre" label="Collection centre" value={centre} onChange={setCentre} inputMode="text" />
      </div>

      {formError && <p className="mt-3 text-xs font-medium text-attention-foreground">{formError}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={submit} disabled={saving} className="flex-1">
          {saving ? "Saving…" : finalised ? "Save changes" : "Assign BL & confirm"}
        </Button>
        {finalised && !hasBl && onAssignBl && (
          <Button type="button" variant="outline" onClick={onAssignBl}>
            <ShipIcon className="mr-1.5 h-4 w-4" aria-hidden /> Assign BL
          </Button>
        )}
      </div>
    </section>
  );
}

/** "Send email" — the filled forms to the office inbox, once the BL is assigned. */
function SendFormsEmail({ data, onSent }: { data: DeclarationPrintData; onSent: () => void }) {
  const [sending, setSending] = useState(false);
  const last = data.formEmails[data.formEmails.length - 1];
  const send = async () => {
    setSending(true);
    try {
      const r = await sendFormsEmail(data.bookingId);
      notify.success("Forms emailed to the office", r.to ? `Sent to ${r.to} with the forms attached.` : undefined);
      onSent();
    } catch (err) {
      notify.error("Couldn't send the email", friendlyError(err, "Please try again."));
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="rounded-lg border bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Email the forms to the office</p>
          <p className="text-xs text-muted-foreground">
            {last
              ? `Last sent ${formatDate(last.at)}${last.by ? ` by ${last.by}` : ""}${data.formEmails.length > 1 ? ` · sent ${data.formEmails.length} times` : ""}`
              : "Sends every filled form (PDFs) to the office inbox. Never to the customer."}
          </p>
        </div>
        <Button type="button" variant={last ? "outline" : "default"} onClick={send} disabled={sending}>
          <Mail className="mr-2 h-4 w-4" aria-hidden />
          {sending ? "Sending…" : last ? "Send again" : "Send email"}
        </Button>
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  inputMode = "decimal",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
  hint?: string | undefined;
  inputMode?: "decimal" | "text";
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} className="h-9 tabular-nums" />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function ContentsSection({ contents }: { contents: DeclarationPrintData["contents"] }) {
  const total = contents.reduce((s, c) => s + (c.value || 0), 0);
  const allValued = contents.every((c) => typeof c.value === "number");
  return (
    <Section title={`What's inside · ${contents.length} item${contents.length === 1 ? "" : "s"}`}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="pb-1 font-medium">Item</th>
            <th className="pb-1 text-center font-medium">Qty</th>
            <th className="pb-1 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {contents.map((c, i) => (
            <tr key={i} className="border-t">
              <td className="py-1 pr-2 font-medium text-foreground">
                {c.description} <span className="font-normal text-muted-foreground">· {c.condition}</span>
              </td>
              <td className="py-1 text-center tabular-nums">{c.qty}</td>
              <td className="py-1 text-right tabular-nums">{typeof c.value === "number" ? `${c.value}` : "—"}</td>
            </tr>
          ))}
          <tr className="border-t font-semibold text-foreground">
            <td className="pt-1">Total value</td>
            <td />
            <td className="pt-1 text-right tabular-nums">{allValued ? `${Math.round(total * 100) / 100}` : "Staff add values at Confirm"}</td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

function CustomerLink({ customerId, myTransco }: { customerId: string; myTransco: boolean }) {
  const className = "mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline";
  return myTransco ? (
    <Link to="/console/my-transco/$customerId" params={{ customerId }} className={className}>
      <UserRound className="h-3.5 w-3.5" /> Open customer profile →
    </Link>
  ) : (
    <Link to="/console/customers/$customerId" params={{ customerId }} className={className}>
      <UserRound className="h-3.5 w-3.5" /> Open customer profile →
    </Link>
  );
}

function PersonSection({ title, person, showId = false }: { title: string; person: DeclarationPerson | null; showId?: boolean }) {
  return (
    <Section title={title}>
      {person ? (
        <Rows
          rows={[
            ["Full name", person.fullName],
            ["Address", [person.address, person.town].filter(Boolean).join(", ")],
            ["Mobile", formatPhone(person.mobile)],
            ...(person.homePhone ? ([["Home phone", person.homePhone]] as [string, string | null][]) : []),
            ["Email", person.email],
            ...(showId ? ([["Passport / NIC", person.idNumber ?? null]] as [string, string | null][]) : []),
          ]}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Not given online — the customer fills this in on the printed form.</p>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-panel p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words font-medium text-foreground">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
