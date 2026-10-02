import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Check,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Smartphone,
  MessageSquare,
  Package,
  PenLine,
  Phone,
  Printer,
  Ship,
  ShieldCheck,
  ShieldQuestion,
  Unlock,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { assignBookingBl, setPortalPassword, updateBooking } from "@/lib/transco/api";
import { useConversations } from "@/lib/transco/store";
import { type DeclarationPerson } from "@/lib/transco/declaration-print";
import { PrintPreviewDialog } from "@/components/transco/forms-print";
import { ShipmentPicker } from "@/components/transco/shipment-picker";
import { Breadcrumbs, LoadingRows, StatusBadge as PageStatusBadge, type StatusTone as PageStatusTone } from "@/components/transco/page-kit";
import { BookingDetailsEditor } from "@/components/transco/booking-details-editor";
import { friendlyError, notify } from "@/lib/transco/notify";
import {
  changePortalPhone,
  CONTACT_LABELS,
  fetchPortalAccount,
  formatDate,
  formatPhone,
  LANGUAGE_LABELS,
  signOutPortalAccount,
  SOURCE_LABELS,
  unlockPortalAccount,
  updatePortalAccount,
  verifyPortalPhone,
  type PortalAccountDetail,
  type PortalAccountFull,
  type PortalBooking,
  type PortalStatus,
  type PortalStep,
  type StageStatus,
} from "@/lib/transco/my-transco";

export const Route = createFileRoute("/console/my-transco/$customerId")({
  component: MyTranscoProfilePage,
});

const TONE_BADGE: Record<string, string> = {
  pending: "bg-warning-soft text-warning-foreground",
  active: "bg-primary/15 text-primary",
  done: "bg-success-soft text-success-foreground",
  muted: "bg-secondary text-muted-foreground",
};

const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

function MyTranscoProfilePage() {
  const { customerId } = Route.useParams();
  const [data, setData] = useState<PortalAccountFull | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    return fetchPortalAccount(customerId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load account"));
  }, [customerId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // Every action: run it, show a short confirmation, reload the profile.
  const act = useCallback(
    async (fn: () => Promise<unknown>, message: string) => {
      await fn();
      if (message) notify.success(message);
      await load();
    },
    [load],
  );

  const c = data?.customer;
  const [tab, setTab] = useState("bookings");
  // Bookings open in the list; ones with work to do start expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  if (data && expandedFor !== customerId) {
    setExpandedFor(customerId);
    setExpanded(new Set(data.bookings.filter((b) => isStaffWork(nextStepFor(b), b)).map((b) => b.id)));
  }
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const openBooking = (id: string) => {
    setTab("bookings");
    setExpanded((prev) => new Set(prev).add(id));
    setTimeout(() => document.getElementById(`booking-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const todo: { key: string; label: string; text: string; action: string; run: () => void }[] = [];
  if (data && c) {
    for (const b of data.bookings) {
      const n = nextStepFor(b);
      if (!isStaffWork(n, b) || !n) continue;
      todo.push({
        key: b.id,
        label: b.code ?? "Booking",
        text: n.kind === "declaration" ? "Check the declaration" : n.kind === "bl" ? "Assign the BL" : "Mark the boxes as received",
        action: n.kind === "declaration" ? "Mark checked" : "Open",
        run:
          n.kind === "declaration"
            ? () => void act(() => updateBooking(b.id, { declarationStatus: "received" }), `${b.code ?? "Booking"}: declaration checked`)
            : () => openBooking(b.id),
      });
    }
    if (!c.phoneVerified) todo.push({ key: "verify", label: "Account", text: "Number not verified — they only see what they booked online", action: "Review", run: () => setTab("account") });
    if (c.locked) todo.push({ key: "locked", label: "Account", text: `Locked out until ${formatDate(c.lockedUntil, true)}`, action: "Review", run: () => setTab("account") });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 md:px-8 md:py-7">
        <Breadcrumbs items={[{ label: "Online Accounts", to: "/console/my-transco" }, { label: data?.customer.name || "Customer" }]} />

        {error && <p className="rounded-lg bg-attention-soft px-4 py-3 text-sm text-attention-foreground">{error}</p>}
        {!data && !error && <LoadingRows rows={4} />}

        {data && c && (
          <>
            {/* Who — one calm line */}
            <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">{c.name || "(no name yet)"}</h1>
                  <span className="text-sm tabular-nums text-muted-foreground">{c.customerCode}</span>
                  {c.phoneVerified ? (
                    <ShieldCheck className="h-4 w-4 text-success" aria-label="Number verified" />
                  ) : (
                    <PageStatusBadge tone="neutral">Number not verified</PageStatusBadge>
                  )}
                  {c.locked && <PageStatusBadge tone="attention">Locked out</PageStatusBadge>}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                    {formatPhone(c.phoneNumber)}
                  </span>
                  {c.email && (
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" aria-hidden />
                      {c.email}
                    </span>
                  )}
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/console/customers/$customerId" params={{ customerId: c.id }}>
                  Customer profile
                </Link>
              </Button>
            </header>

            {/* The only "attention" area: what to do for this customer. */}
            {todo.length > 0 && (
              <section className="mb-6 rounded-xl border bg-card shadow-xs">
                <h2 className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">To do for {c.name?.split(/\s+/)[0] || "this customer"}</h2>
                <ul className="mt-2 divide-y">
                  {todo.map((t) => (
                    <li key={t.key} className="flex items-center gap-3 px-5 py-3">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden />
                      <span className="w-24 shrink-0 text-sm font-medium tabular-nums text-foreground">{t.label}</span>
                      <span className="min-w-0 flex-1 text-sm text-foreground">{t.text}</span>
                      <Button type="button" size="sm" variant={t.action === "Mark checked" ? "default" : "outline"} onClick={t.run}>
                        {t.action}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="bookings">Bookings ({data.bookings.length})</TabsTrigger>
                <TabsTrigger value="shipments">Shipments ({data.shipments.length})</TabsTrigger>
                <TabsTrigger value="account">Account</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="bookings" className="mt-4">
                {data.bookings.length === 0 ? (
                  <EmptyState icon={Package} text="No bookings yet. Bookings made online or through the chat bot will appear here." />
                ) : (
                  <ul className="overflow-hidden rounded-xl border bg-card shadow-xs">
                    {data.bookings.map((b, i) => {
                      const open = expanded.has(b.id);
                      const st = staffStatus(b.status);
                      const work = isStaffWork(nextStepFor(b), b);
                      return (
                        <li key={b.id} id={`booking-${b.id}`} className={cn(i > 0 && "border-t")}>
                          <button
                            type="button"
                            onClick={() => toggle(b.id)}
                            aria-expanded={open}
                            className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent/30"
                          >
                            <span className="w-2 shrink-0">{work && <span className="block h-2 w-2 rounded-full bg-warning" aria-label="Needs work" />}</span>
                            <span className="w-24 shrink-0 text-sm font-semibold tabular-nums text-foreground">{b.code ?? "Booking"}</span>
                            <span className="hidden w-36 shrink-0 text-sm text-muted-foreground sm:block">
                              {b.dropOff ? `${formatDate(b.dropOff.date)}${b.dropOff.time ? `, ${b.dropOff.time}` : ""}` : "—"}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{b.items || "—"}</span>
                            <PageStatusBadge tone={st.tone}>{st.label}</PageStatusBadge>
                            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
                          </button>
                          {open && (
                            <div className="border-t bg-background/60 p-3">
                              <BookingPanel booking={b} act={act} />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="shipments" className="mt-4">
                {data.shipments.length === 0 ? (
                  <EmptyState icon={Ship} text="No shipments yet. A shipment appears when a BL is assigned to one of this customer's bookings." />
                ) : (
                  <ul className="overflow-hidden rounded-xl border bg-card shadow-xs">
                    {data.shipments.map((s, i) => {
                      const st = staffStatus(s.status);
                      return (
                        <li key={s.id} className={cn(i > 0 && "border-t")}>
                          <Link
                            to="/console/shipments/$shipmentId"
                            params={{ shipmentId: s.id }}
                            className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/30"
                          >
                            <span className="w-28 shrink-0 text-sm font-semibold text-foreground">{s.batchLabel || (s.blNumber ? `BL ${s.blNumber}` : "Shipment")}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                              {[s.blNumber ? `BL ${s.blNumber}` : null, s.items, s.destination].filter(Boolean).join(" · ")}
                            </span>
                            <PageStatusBadge tone={st.tone}>{st.label}</PageStatusBadge>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="account" className="mt-4 flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Joined {formatDate(c.joinedAt)} · Last sign-in {formatDate(c.lastSignInAt, true)}
                </p>
                <AccountActions customer={c} act={act} />
                <OverviewTab customer={c} act={act} />
              </TabsContent>

              <TabsContent value="activity" className="mt-4">
                <ActivityTab data={data} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

/** Work a staff member can do now (not just "waiting for the customer"). */
function isStaffWork(n: Next, b: PortalBooking): boolean {
  if (!n) return false;
  if (n.kind === "declaration" || n.kind === "bl") return true;
  // Boxes: only once the drop-off day has come.
  if (n.kind === "boxes") return !!b.dropOff?.date && b.dropOff.date <= new Date().toISOString().slice(0, 10);
  return false;
}

/** Status in staff words (the customer-facing label says "your drop-off"). */
function staffStatus(status: PortalStatus): { label: string; tone: PageStatusTone } {
  const map: Record<string, { label: string; tone: PageStatusTone }> = {
    pending: { label: "Waiting for drop-off", tone: "neutral" },
    confirmed: { label: "Confirmed", tone: "neutral" },
    warehouse_received: { label: "Boxes received", tone: "info" },
    cancelled: { label: "Cancelled", tone: "neutral" },
    delivered: { label: "Delivered", tone: "success" },
  };
  return map[status.key] ?? { label: status.label, tone: status.tone === "done" ? "success" : "info" };
}

// ---------------------------------------------------------------
// Account actions (password / verify / sign out / unlock)
// ---------------------------------------------------------------
type Act = (fn: () => Promise<unknown>, message: string) => Promise<void>;

function AccountActions({ customer: c, act }: { customer: PortalAccountDetail; act: Act }) {
  const [mode, setMode] = useState<null | "password" | "verify" | "signout" | "phone">(null);
  const [password, setPassword] = useState("");
  const [newPhone, setNewPhone] = useState({ countryCode: "61", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await act(fn, message);
      setMode(null);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Account</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>Password: <strong className="text-foreground">{c.hasPassword ? "set" : "not set (signs in with WhatsApp codes)"}</strong></span>
          {c.passwordSetByStaff && <span>Last set by staff ({c.passwordSetByStaff})</span>}
          <span>Came from: <strong className="text-foreground">{c.source ? SOURCE_LABELS[c.source] ?? c.source : "—"}</strong></span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant={mode === "password" ? "default" : "outline"} onClick={() => setMode(mode === "password" ? null : "password")}>
            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> {c.hasPassword ? "Reset password" : "Set password"}
          </Button>
          {!c.phoneVerified && (
            <Button type="button" size="sm" variant={mode === "verify" ? "default" : "outline"} onClick={() => setMode(mode === "verify" ? null : "verify")}>
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Verify number
            </Button>
          )}
          {c.locked && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => unlockPortalAccount(c.id), "Account unlocked — the customer can sign in again.")}>
              <Unlock className="mr-1.5 h-3.5 w-3.5" /> Unlock
            </Button>
          )}
          <Button type="button" size="sm" variant={mode === "phone" ? "default" : "outline"} onClick={() => setMode(mode === "phone" ? null : "phone")}>
            <Smartphone className="mr-1.5 h-3.5 w-3.5" /> Change phone number
          </Button>
          <Button type="button" size="sm" variant={mode === "signout" ? "default" : "outline"} onClick={() => setMode(mode === "signout" ? null : "signout")}>
            <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out everywhere
          </Button>
        </div>

        {mode === "password" && (
          <div className="mt-3 rounded-md border border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Only after confirming you're speaking to this customer (e.g. they called from {formatPhone(c.phoneNumber)}).
              This also verifies their number and signs out their other sessions. Give them the password
              by phone — they can change it in their profile.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Temporary password (8+ characters)" autoComplete="off" className="max-w-xs" />
              <Button
                type="button"
                size="sm"
                disabled={busy || password.length < 8}
                onClick={() => run(() => setPortalPassword(c.id, password), `Password set. The customer signs in with ${formatPhone(c.phoneNumber)} and the new password.`)}
              >
                Save password
              </Button>
            </div>
          </div>
        )}

        {mode === "phone" && (
          <div className="mt-3 rounded-md border border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              For a customer who has a new number — only after confirming it's them (e.g. they called, or
              signed in with their email). Their bookings, BLs and chats stay on this account; the new number
              becomes their sign-in and WhatsApp match. Current: {formatPhone(c.phoneNumber)}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Select value={newPhone.countryCode} onValueChange={(v) => setNewPhone((s) => ({ ...s, countryCode: v }))}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="61">+61 AU</SelectItem>
                  <SelectItem value="94">+94 LK</SelectItem>
                  <SelectItem value="91">+91 IN</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={newPhone.phone}
                onChange={(e) => setNewPhone((s) => ({ ...s, phone: e.target.value }))}
                placeholder="New mobile number"
                inputMode="tel"
                autoComplete="off"
                className="max-w-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || newPhone.phone.replace(/\D/g, "").length < 8}
                onClick={() =>
                  run(async () => {
                    const r = await changePortalPhone(c.id, newPhone.countryCode, newPhone.phone);
                    setNewPhone({ countryCode: "61", phone: "" });
                    return r;
                  }, "Phone number changed. The customer signs in with the new number (or their email) from now on.")
                }
              >
                Save new number
              </Button>
            </div>
          </div>
        )}

        {mode === "verify" && (
          <ConfirmBox
            text={`Confirm ${formatPhone(c.phoneNumber)} belongs to this customer? Their full history on this number (WhatsApp bookings, shipments, BLs) will then show in their account.`}
            confirmLabel="Yes, verify number"
            busy={busy}
            onConfirm={() => run(() => verifyPortalPhone(c.id), "Number verified — the customer now sees their full history.")}
            onCancel={() => setMode(null)}
          />
        )}

        {mode === "signout" && (
          <ConfirmBox
            text="Sign this customer out on every phone and computer? They'll need their password or a WhatsApp code to sign in again."
            confirmLabel="Yes, sign out everywhere"
            busy={busy}
            onConfirm={() => run(() => signOutPortalAccount(c.id), "Signed out everywhere.")}
            onCancel={() => setMode(null)}
          />
        )}

        {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ConfirmBox({ text, confirmLabel, busy, onConfirm, onCancel }: { text: string; confirmLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-border p-3">
      <p className="mb-2 text-xs text-foreground">{text}</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Overview (details, editable)
// ---------------------------------------------------------------
function OverviewTab({ customer: c, act }: { customer: PortalAccountDetail; act: Act }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => toForm(c));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await act(
        () =>
          updatePortalAccount(c.id, {
            name: form.name,
            email: form.email,
            address: { line1: form.line1, suburb: form.suburb, state: form.state, postcode: form.postcode },
            preferredLanguage: form.preferredLanguage,
            contactPreference: form.contactPreference,
          }),
        "Details saved.",
      );
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    const a = c.address;
    const addressText = [a.line1, a.suburb, [a.state, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between p-4 pb-2">
            <CardTitle className="text-sm">Customer details</CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={() => { setForm(toForm(c)); setEditing(true); }}>
              <PenLine className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs">
            <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2">
              <Dt>Customer number</Dt><Dd>{c.customerCode}</Dd>
              <Dt>Name</Dt><Dd>{c.name}</Dd>
              <Dt>Mobile</Dt><Dd>{formatPhone(c.phoneNumber)}</Dd>
              <Dt>Email</Dt><Dd>{c.email ? `${c.email}${c.hasPassword ? " (can sign in with it)" : ""}` : null}</Dd>
              <Dt>Address</Dt><Dd>{addressText}</Dd>
              <Dt>Language</Dt><Dd>{LANGUAGE_LABELS[c.preferredLanguage] ?? c.preferredLanguage}</Dd>
              <Dt>Contact by</Dt><Dd>{CONTACT_LABELS[c.contactPreference] ?? c.contactPreference}</Dd>
              {c.staffNotes && (<><Dt>Staff notes</Dt><Dd>{c.staffNotes}</Dd></>)}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm">Account history</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2">
              <Dt>Customer since</Dt><Dd>{formatDate(c.createdAt)}</Dd>
              <Dt>Online account</Dt><Dd>{formatDate(c.joinedAt)}</Dd>
              <Dt>Last sign-in</Dt><Dd>{formatDate(c.lastSignInAt, true)}</Dd>
              <Dt>Number verified</Dt><Dd>{c.phoneVerified ? (c.phoneVerifiedAt ? formatDate(c.phoneVerifiedAt) : "Yes") : "No"}</Dd>
              <Dt>Password changed</Dt><Dd>{formatDate(c.passwordUpdatedAt)}</Dd>
              <Dt>Details updated</Dt><Dd>{formatDate(c.profileUpdatedAt)}</Dd>
              <Dt>Channels</Dt><Dd>{c.sources.join(", ")}</Dd>
              {c.previousPhoneNumbers.length > 0 && (
                <>
                  <Dt>Previous numbers</Dt>
                  <Dd>{c.previousPhoneNumbers.map((n) => `${formatPhone(n.phoneNumber)} (until ${formatDate(n.changedAt)})`).join(", ")}</Dd>
                </>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>
    );
  }

  const field = (key: keyof typeof form, label: string, props: Record<string, string> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`f-${key}`}>{label}</Label>
      <Input id={`f-${key}`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </div>
  );

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Edit customer details</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field("name", "Name")}
          {field("email", "Email", { type: "email" })}
          {field("line1", "Street address")}
          {field("suburb", "Suburb")}
          <div className="flex flex-col gap-1.5">
            <Label>State</Label>
            <Select value={form.state || "none"} onValueChange={(v) => setForm((f) => ({ ...f, state: v === "none" ? "" : v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not set</SelectItem>
                {AU_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {field("postcode", "Postcode", { inputMode: "numeric", maxLength: "4" })}
          <div className="flex flex-col gap-1.5">
            <Label>Language</Label>
            <Select value={form.preferredLanguage} onValueChange={(v) => setForm((f) => ({ ...f, preferredLanguage: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(LANGUAGE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Contact by</Label>
            <Select value={form.contactPreference} onValueChange={(v) => setForm((f) => ({ ...f, contactPreference: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CONTACT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">The mobile number is the customer's sign-in and can't be changed here.</p>
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save details"}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function toForm(c: PortalAccountDetail) {
  return {
    name: c.name ?? "",
    email: c.email ?? "",
    line1: c.address.line1,
    suburb: c.address.suburb,
    state: c.address.state,
    postcode: c.address.postcode,
    preferredLanguage: c.preferredLanguage || "en",
    contactPreference: c.contactPreference || "whatsapp",
  };
}

// ---------------------------------------------------------------
// Bookings — one clear next step, the booking and its declaration side by
// side, and "Change boxes or details" for when the customer changes things
// at drop-off. Stage undo and the customer's view sit quietly at the bottom.
// ---------------------------------------------------------------
type Next =
  | { kind: "declaration"; text: string }
  | { kind: "boxes"; text: string }
  | { kind: "bl"; text: string }
  | { kind: "done"; text: string }
  | null;

function nextStepFor(b: PortalBooking): Next {
  if (b.status.key === "cancelled") return null;
  const boxesIn = b.warehouseStatus === "received" || b.rawStatus === "completed";
  if (b.declarationSubmittedAt && b.declarationStatus !== "received") {
    return { kind: "declaration", text: "Check the declaration with the customer (names, NIC, what's in the boxes)." };
  }
  if (!boxesIn) {
    const when = b.dropOff ? `${formatDate(b.dropOff.date)}${b.dropOff.time ? `, ${b.dropOff.time}` : ""}` : null;
    return { kind: "boxes", text: when ? `Waiting for the boxes — drop-off ${when}.` : "Waiting for the boxes to arrive." };
  }
  if (!b.blNumber) return { kind: "bl", text: "Boxes are in — give this booking its BL." };
  return { kind: "done", text: `All set — BL ${b.blNumber} assigned.` };
}

function BookingPanel({ booking: b, act, embedded = true }: { booking: PortalBooking; act: Act; embedded?: boolean }) {
  const [bl, setBl] = useState("");
  const [shipmentNo, setShipmentNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const cancelled = b.status.key === "cancelled";
  const next = nextStepFor(b);
  const boxesIn = b.warehouseStatus === "received" || b.rawStatus === "completed";

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    try {
      await act(fn, message);
    } catch (err) {
      setError(friendlyError(err, "Couldn't save that. Nothing was changed — please try again."));
    } finally {
      setBusy(false);
    }
  };

  const setStage = (field: "declarationStatus" | "warehouseStatus", value: StageStatus) =>
    run(
      () => updateBooking(b.id, { [field]: value }),
      field === "declarationStatus"
        ? value === "received" ? "Declaration checked" : "Declaration marked as not checked"
        : value === "received" ? "Boxes marked as received" : "Boxes marked as not received",
    );

  const saveBl = async () => {
    const hbl = bl.trim();
    if (!/^[A-Za-z0-9-]{1,32}$/.test(hbl)) {
      setError("Enter the BL number (letters, numbers or hyphens).");
      return;
    }
    const num = shipmentNo.trim() === "" ? null : Number(shipmentNo);
    if (num !== null && (!Number.isInteger(num) || num < 1)) {
      setError("The shipment number must be a whole number, e.g. 57.");
      return;
    }
    await run(() => assignBookingBl(b.id, hbl, num), `BL ${hbl} assigned — the customer can see it now`);
    setBl("");
    setShipmentNo("");
  };

  // Every print goes through a preview first.
  const [previewAll, setPreviewAll] = useState(false);
  const print = () => setPreviewAll(true);

  const channel = b.channel === "portal" ? "Booked online" : b.channel === "website" ? "Website chat" : b.channel === "whatsapp" ? "WhatsApp" : null;

  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card", !embedded && "shadow-xs", cancelled && "opacity-65")}>
      {/* Header — hidden inside the list, whose row already shows code + status */}
      {embedded ? (
        <p className="px-5 pt-3 text-xs text-muted-foreground">{channelNote(b)}Made {formatDate(b.createdAt, true)}</p>
      ) : (
      <header className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <h3 className="text-base font-semibold tabular-nums text-foreground">{b.code ?? "Booking"}</h3>
        <PageStatusBadge tone={toneOf(b.status.tone)}>{b.status.label}</PageStatusBadge>
        {channel && <span className="text-sm text-muted-foreground">· {channel}</span>}
        <span className="ml-auto text-xs text-muted-foreground">Made {formatDate(b.createdAt, true)}</span>
      </header>
      )}

      {/* Next step */}
      {next && (
        <div
          className={cn(
            "mx-5 mt-3 rounded-lg px-4 py-3",
            next.kind === "done" ? "bg-success-soft" : next.kind === "boxes" ? "bg-info-soft" : "bg-warning-soft",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              className={cn(
                "text-sm",
                next.kind === "done" ? "text-success-foreground" : next.kind === "boxes" ? "text-info-foreground" : "text-warning-foreground",
              )}
            >
              <span className="font-semibold">{next.kind === "done" ? "✓ " : "Next step: "}</span>
              {next.text}
            </p>
            {next.kind === "declaration" && (
              <Button type="button" size="sm" disabled={busy} onClick={() => void setStage("declarationStatus", "received")}>
                <Check className="mr-1.5 h-4 w-4" /> Mark declaration checked
              </Button>
            )}
            {next.kind === "boxes" && (
              <Button type="button" size="sm" disabled={busy} onClick={() => void setStage("warehouseStatus", "received")}>
                <Package className="mr-1.5 h-4 w-4" /> Mark boxes received
              </Button>
            )}
            {next.kind === "done" && b.shipmentId && (
              <Button asChild type="button" size="sm" variant="outline" className="bg-card">
                <Link to="/console/shipments/$shipmentId" params={{ shipmentId: b.shipmentId }}>
                  <Ship className="mr-1.5 h-4 w-4" /> Open shipment
                </Link>
              </Button>
            )}
          </div>
          {next.kind === "bl" && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_auto]">
              <Input className="bg-card" value={bl} onChange={(e) => { setBl(e.target.value); setError(""); }} placeholder="BL number, e.g. 203115" autoComplete="off" aria-label="BL number" />
              <ShipmentPicker value={shipmentNo} onChange={setShipmentNo} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground" />
              <Button type="button" onClick={saveBl} disabled={busy}>Assign BL</Button>
            </div>
          )}
        </div>
      )}
      {error && <p className="mx-5 mt-2 rounded-lg bg-attention-soft px-3 py-2 text-sm text-attention-foreground">{error}</p>}

      {/* Booking + declaration */}
      <div className="grid grid-cols-1 gap-6 px-5 py-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Booking</h4>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <Dt>Boxes</Dt><Dd>{b.items}</Dd>
            <Dt>Service</Dt><Dd>{b.service}</Dd>
            <Dt>Destination</Dt><Dd>{[b.destination, b.country].filter(Boolean).join(", ")}</Dd>
            <Dt>Delivery</Dt><Dd>{b.delivery}</Dd>
            <Dt>Drop-off</Dt><Dd>{b.dropOff ? `${formatDate(b.dropOff.date)}${b.dropOff.time ? ` · ${b.dropOff.time}` : ""}` : null}</Dd>
            <Dt>BL</Dt><Dd>{b.blNumber}</Dd>
            {b.notes && (<><Dt>Customer note</Dt><Dd>{b.notes}</Dd></>)}
            {b.staffNotes && (<><Dt>Staff notes</Dt><Dd>{b.staffNotes}</Dd></>)}
          </dl>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Declaration</h4>
            {b.declarationStatus === "received" ? (
              <PageStatusBadge tone="success">Checked</PageStatusBadge>
            ) : b.declarationSubmittedAt ? (
              <PageStatusBadge tone="info">Filled online · to check</PageStatusBadge>
            ) : (
              <PageStatusBadge tone="neutral">Not filled online</PageStatusBadge>
            )}
          </div>
          {b.sender || b.receiver ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <PersonSummary title={b.sender && !b.senderIsAccountHolder ? "Sender (someone else)" : "Sender"} person={b.sender} />
              <PersonSummary title="Receiver" person={b.receiver} withId />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No sender or receiver details yet — add them with Change details, or fill in the printed form.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {!cancelled && (
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                <PenLine className="mr-1.5 h-4 w-4" /> Change boxes or details
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={print}>
              <Printer className="mr-1.5 h-4 w-4" /> Print forms
            </Button>
            {previewAll && <PrintPreviewDialog bookingId={b.id} form={{ key: "all", title: "All forms" }} onClose={() => setPreviewAll(false)} />}
          </div>
        </div>
      </div>

      {/* Quiet footer: undo stages + the customer's view */}
      {!cancelled && (
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t bg-secondary/30 px-5 py-2.5 text-sm">
          <StageToggle label="Declaration" done={b.declarationStatus === "received"} doneText="Checked" todoText="Not checked" busy={busy} onChange={(v) => void setStage("declarationStatus", v)} />
          <StageToggle label="Boxes" done={boxesIn} doneText="Received" todoText="Not received" busy={busy || b.rawStatus === "completed"} onChange={(v) => void setStage("warehouseStatus", v)} />
          {b.blNumber && next?.kind !== "bl" && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Change BL</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <Input className="h-8 w-40" value={bl} onChange={(e) => setBl(e.target.value)} placeholder="New BL number" aria-label="New BL number" />
                <ShipmentPicker value={shipmentNo} onChange={setShipmentNo} className="h-8 w-44 rounded-md border border-input bg-card px-2 text-sm text-foreground" />
                <Button type="button" size="sm" className="h-8" onClick={saveBl} disabled={busy}>Save BL</Button>
              </div>
            </details>
          )}
          <details className="ml-auto text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What the customer sees</summary>
            <div className="mt-2">
              <StepList steps={b.steps} />
            </div>
          </details>
        </footer>
      )}

      <BookingDetailsEditor bookingId={b.id} open={editing} onOpenChange={setEditing} onSaved={() => void act(async () => undefined, "")} />
    </section>
  );
}

/** "Declaration: Checked ✓ · Undo" — a quiet way to change a stage back. */
function StageToggle({
  label,
  done,
  doneText,
  todoText,
  busy,
  onChange,
}: {
  label: string;
  done: boolean;
  doneText: string;
  todoText: string;
  busy: boolean;
  onChange: (v: StageStatus) => void;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("font-medium", done ? "text-success-foreground" : "text-muted-foreground")}>{done ? `✓ ${doneText}` : todoText}</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange(done ? "not_received" : "received")}
        className="text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:no-underline"
      >
        {done ? "Undo" : `Mark ${doneText.toLowerCase()}`}
      </button>
    </span>
  );
}

function PersonSummary({ title, person, withId = false }: { title: string; person: DeclarationPerson | null; withId?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-3 py-2.5 text-sm">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {person ? (
        <>
          <p className="font-semibold text-foreground">{person.fullName}</p>
          <p className="text-muted-foreground">{[person.address, person.town].filter(Boolean).join(", ")}</p>
          <p className="text-muted-foreground">
            {formatPhone(person.mobile)}
            {person.email ? ` · ${person.email}` : ""}
          </p>
          {withId && person.idNumber && <p className="mt-0.5 text-foreground">Passport / NIC: <span className="font-medium tabular-nums">{person.idNumber}</span></p>}
        </>
      ) : (
        <p className="text-muted-foreground">—</p>
      )}
    </div>
  );
}

function channelNote(b: PortalBooking) {
  return b.channel === "portal" ? "Booked online · " : b.channel === "website" ? "Booked in website chat · " : b.channel === "whatsapp" ? "Booked on WhatsApp · " : "";
}

function toneOf(tone: string): PageStatusTone {
  return tone === "done" ? "success" : tone === "active" ? "info" : tone === "pending" ? "pending" : "neutral";
}

// ---------------------------------------------------------------
// Activity
// ---------------------------------------------------------------
function ActivityTab({ data }: { data: PortalAccountFull }) {
  const navigate = useNavigate();
  const { selectConversation } = useConversations();
  const c = data.customer;

  const events = [
    { at: c.createdAt, text: "First became a Transco customer" },
    { at: c.joinedAt, text: `Created their My Transco account (${c.source ? SOURCE_LABELS[c.source] ?? c.source : "unknown source"})` },
    { at: c.phoneVerifiedAt, text: "Number verified" },
    { at: c.passwordUpdatedAt, text: c.passwordSetByStaff ? `Password set by staff (${c.passwordSetByStaff})` : "Password changed" },
    { at: c.profileUpdatedAt, text: "Details updated" },
    { at: c.lastSignInAt, text: "Last signed in" },
    ...data.bookings.map((b) => ({ at: b.createdAt, text: `Booking ${b.code ?? ""} made (${b.channel === "portal" ? "online" : b.channel ?? "—"})` })),
  ]
    .filter((e): e is { at: string; text: string } => Boolean(e.at))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const openChat = (id: string) => {
    selectConversation(id);
    void navigate({ to: "/console/conversations" });
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Timeline</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <ol className="flex flex-col gap-2 text-xs">
            {events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{formatDate(e.at, true)}</span>
                <span className="text-foreground">{e.text}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Website chats while signed in</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 text-xs">
          {data.chatSessions.length === 0 ? (
            <p className="text-muted-foreground">No signed-in website chats yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.chatSessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {s.messageCount} messages · last {formatDate(s.lastMessageAt, true)}
                  </span>
                  <button type="button" onClick={() => openChat(s.id)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    <MessageSquare className="h-3 w-3" /> Open chat
                  </button>
                </li>
              ))}
            </ul>
          )}
          {c.hasWhatsAppConversation && (
            <button type="button" onClick={() => openChat(c.id)} className="mt-3 inline-flex items-center gap-1 font-medium text-primary hover:underline">
              <MessageSquare className="h-3 w-3" /> Open WhatsApp conversation
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------
function StatusBadge({ status }: { status: PortalStatus }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", TONE_BADGE[status.tone] ?? TONE_BADGE["muted"])}>
      {status.label}
    </Badge>
  );
}

function StepList({ steps }: { steps: PortalStep[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {steps.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
              s.done && "border-success bg-success text-white",
              !s.done && s.attention && "border-warning bg-warning-soft text-warning-foreground",
              !s.done && !s.attention && s.current && "border-primary text-primary",
              !s.done && !s.attention && !s.current && "border-border text-transparent",
            )}
            aria-hidden="true"
          >
            {s.done ? "✓" : s.attention ? "!" : "•"}
          </span>
          <span className={cn(s.done ? "text-foreground" : s.attention ? "font-medium text-warning-foreground" : s.current ? "font-medium text-foreground" : "text-muted-foreground")}>
            {s.label}
            {s.attention && " — still needed"}
            {s.current && !s.done && !s.attention && " (next)"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof UserRound; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
      <Icon className="h-5 w-5" />
      {text}
    </div>
  );
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="text-muted-foreground">{children}</dt>;
}

function Dd({ children }: { children: React.ReactNode }) {
  return <dd className="min-w-0 break-words font-medium text-foreground">{children || "—"}</dd>;
}
