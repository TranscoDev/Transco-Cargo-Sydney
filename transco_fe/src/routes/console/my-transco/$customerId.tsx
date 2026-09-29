import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
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
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  active: "bg-primary/15 text-primary",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  muted: "bg-secondary text-muted-foreground",
};

const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

function MyTranscoProfilePage() {
  const { customerId } = Route.useParams();
  const [data, setData] = useState<PortalAccountFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice(message);
      await load();
    },
    [load],
  );

  const c = data?.customer;
  const needsDeclaration = data?.bookings.filter(
    (b) => b.status.key !== "cancelled" && b.declarationStatus !== "received" && !b.blNumber,
  ).length ?? 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <Link
        to="/console/my-transco"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to My Transco accounts
      </Link>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      )}
      {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && c && (
        <>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-foreground">{c.name || "(no name yet)"}</h1>
                <span className="rounded-md border border-border bg-panel px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
                  {c.customerCode}
                </span>
                {c.phoneVerified ? (
                  <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="mr-1 h-3 w-3" /> Number verified
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                    <ShieldQuestion className="mr-1 h-3 w-3" /> Number not verified
                  </Badge>
                )}
                {c.locked && (
                  <Badge variant="secondary" className="bg-destructive/15 text-destructive">
                    <Lock className="mr-1 h-3 w-3" /> Locked out
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {formatPhone(c.phoneNumber)}
                </span>
                {c.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {c.email}
                  </span>
                )}
                <span>Joined {formatDate(c.joinedAt)}</span>
                <span>Last sign-in {formatDate(c.lastSignInAt, true)}</span>
              </div>
            </div>
            <Link
              to="/console/customers/$customerId"
              params={{ customerId: c.id }}
              className="text-xs font-medium text-primary hover:underline"
            >
              Open full CRM record →
            </Link>
          </div>

          {notice && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" />
              {notice}
              <button type="button" className="ml-auto underline" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}

          {(needsDeclaration > 0 || !c.phoneVerified || c.locked) && (
            <div className="mb-4 flex flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" /> Needs attention
              </p>
              {needsDeclaration > 0 && <p>• {needsDeclaration} booking(s) still waiting for the declaration form.</p>}
              {!c.phoneVerified && (
                <p>
                  • Number not verified — the customer only sees what they booked online. Verify it once
                  you've confirmed it's them to show their full history.
                </p>
              )}
              {c.locked && <p>• Locked out after too many wrong passwords (until {formatDate(c.lockedUntil, true)}).</p>}
            </div>
          )}

          <AccountActions customer={c} act={act} />

          <div className="mb-5 mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniStat label="Bookings" value={data.bookings.length} />
            <MiniStat label="Open bookings" value={data.bookings.filter((b) => ["pending", "confirmed"].includes(b.rawStatus ?? "")).length} />
            <MiniStat label="BLs" value={data.shipments.filter((s) => s.blNumber).length} />
            <MiniStat label="Website chats" value={data.chatSessions.length} />
          </div>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="bookings">Bookings ({data.bookings.length})</TabsTrigger>
              <TabsTrigger value="shipments">Shipments ({data.shipments.length})</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4">
              <OverviewTab customer={c} act={act} />
            </TabsContent>

            <TabsContent value="bookings" className="mt-4">
              {data.bookings.length === 0 ? (
                <EmptyState icon={Package} text="No bookings yet. Bookings made online or through the chat bot will appear here." />
              ) : (
                <div className="flex flex-col gap-3">
                  {data.bookings.map((b) => (
                    <BookingPanel key={b.id} booking={b} act={act} />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="shipments" className="mt-4">
              {data.shipments.length === 0 ? (
                <EmptyState icon={Ship} text="No shipments yet. A shipment is created when a BL is assigned to one of this customer's bookings." />
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {data.shipments.map((s) => (
                    <Card key={s.id}>
                      <CardHeader className="p-4 pb-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <CardTitle className="text-sm tabular-nums">{s.blNumber ? `BL ${s.blNumber}` : "Shipment (no BL yet)"}</CardTitle>
                          <StatusBadge status={s.status} />
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 p-4 pt-0 text-xs">
                        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
                          <Dt>Items</Dt><Dd>{s.items}</Dd>
                          <Dt>Destination</Dt><Dd>{s.destination}</Dd>
                          <Dt>Receiver</Dt><Dd>{s.receiverName}</Dd>
                          <Dt>Group shipment</Dt><Dd>{s.batchLabel}</Dd>
                          <Dt>Booking</Dt><Dd>{s.bookingCode}</Dd>
                          <Dt>Last updated</Dt><Dd>{formatDate(s.updatedAt, true)}</Dd>
                        </dl>
                        <StepList steps={s.steps} />
                        <Link
                          to="/console/shipments/$shipmentId"
                          params={{ shipmentId: s.id }}
                          className="inline-block font-medium text-primary hover:underline"
                        >
                          Open shipment to change status →
                        </Link>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="activity" className="mt-4">
              <ActivityTab data={data} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
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
            <p className="mb-2 text-[11px] text-muted-foreground">
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
            <p className="mb-2 text-[11px] text-muted-foreground">
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

        {error && <p className="mt-2 text-[11px] font-medium text-destructive">{error}</p>}
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
        <p className="text-[11px] text-muted-foreground">The mobile number is the customer's sign-in and can't be changed here.</p>
        {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}
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
// Bookings (progress + stage controls + BL)
// ---------------------------------------------------------------
function BookingPanel({ booking: b, act }: { booking: PortalBooking; act: Act }) {
  const [bl, setBl] = useState("");
  const [batch, setBatch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelled = b.status.key === "cancelled";

  const setStage = async (field: "declarationStatus" | "warehouseStatus", value: StageStatus) => {
    setBusy(true);
    setError("");
    try {
      await act(() => updateBooking(b.id, { [field]: value }), `${b.code ?? "Booking"}: ${field === "declarationStatus" ? "declaration" : "boxes"} marked ${value === "received" ? "received" : "not received"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  };

  const saveBl = async () => {
    const hbl = bl.trim();
    if (!/^[A-Za-z0-9-]{1,32}$/.test(hbl)) {
      setError("Enter the BL number (letters, numbers or hyphens).");
      return;
    }
    const batchNumber = batch.trim() === "" ? null : Number(batch);
    if (batchNumber !== null && (!Number.isInteger(batchNumber) || batchNumber < 1)) {
      setError("Batch number must be a whole number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await act(() => assignBookingBl(b.id, hbl, batchNumber), `BL ${hbl} saved on ${b.code ?? "the booking"} — the customer can see it now.`);
      setBl("");
      setBatch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign BL");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={cn(cancelled && "opacity-60")}>
      <CardHeader className="p-4 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm tabular-nums">{b.code ?? "Booking"}</CardTitle>
          <StatusBadge status={b.status} />
          <Badge variant="secondary" className="text-[10px] uppercase">
            {b.channel === "portal" ? "Booked online" : b.channel === "website" ? "Website chat" : b.channel === "whatsapp" ? "WhatsApp" : b.channel ?? "—"}
          </Badge>
          <span className="ml-auto text-[11px] text-muted-foreground">Made {formatDate(b.createdAt, true)}</span>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 p-4 pt-0 text-xs lg:grid-cols-3">
        <dl className="grid grid-cols-[6.5rem_1fr] content-start gap-x-3 gap-y-1">
          <Dt>Items</Dt><Dd>{b.items}</Dd>
          <Dt>Service</Dt><Dd>{b.service}</Dd>
          <Dt>Destination</Dt><Dd>{[b.destination, b.country].filter(Boolean).join(", ")}</Dd>
          <Dt>Delivery</Dt><Dd>{b.delivery}</Dd>
          <Dt>Drop-off</Dt><Dd>{b.dropOff ? `${formatDate(b.dropOff.date)} · ${b.dropOff.time ?? ""}` : null}</Dd>
          <Dt>BL</Dt><Dd>{b.blNumber}</Dd>
          {b.notes && (<><Dt>Customer note</Dt><Dd>{b.notes}</Dd></>)}
          {b.staffNotes && (<><Dt>Staff notes</Dt><Dd>{b.staffNotes}</Dd></>)}
        </dl>

        <div>
          <p className="mb-2 font-semibold text-foreground">What the customer sees</p>
          <StepList steps={b.steps} />
        </div>

        {!cancelled && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Declaration</Label>
                <Select value={b.declarationStatus} onValueChange={(v) => void setStage("declarationStatus", v as StageStatus)} disabled={busy}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_received">Not received</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Boxes at warehouse</Label>
                <Select value={b.warehouseStatus} onValueChange={(v) => void setStage("warehouseStatus", v as StageStatus)} disabled={busy}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_received">Not received</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-[11px]">{b.blNumber ? "Change BL number" : "Assign BL number"}</Label>
              <div className="mt-1 grid grid-cols-[1fr_4.5rem_auto] gap-2">
                <Input className="h-8 text-xs" value={bl} onChange={(e) => { setBl(e.target.value); setError(""); }} placeholder="BL e.g. 203115" autoComplete="off" />
                <Input className="h-8 text-xs" type="number" min="1" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Batch" aria-label="Batch number (optional)" />
                <Button type="button" size="sm" className="h-8" onClick={saveBl} disabled={busy}>Save BL</Button>
              </div>
            </div>
            {b.shipmentId && (
              <Link to="/console/shipments/$shipmentId" params={{ shipmentId: b.shipmentId }} className="font-medium text-primary hover:underline">
                Open shipment →
              </Link>
            )}
            {error && <p className="text-[11px] font-medium text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
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
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold",
              s.done && "border-emerald-600 bg-emerald-600 text-white",
              !s.done && s.attention && "border-amber-500 bg-amber-500/15 text-amber-700",
              !s.done && !s.attention && s.current && "border-primary text-primary",
              !s.done && !s.attention && !s.current && "border-border text-transparent",
            )}
            aria-hidden="true"
          >
            {s.done ? "✓" : s.attention ? "!" : "•"}
          </span>
          <span className={cn(s.done ? "text-foreground" : s.attention ? "font-medium text-amber-700 dark:text-amber-400" : s.current ? "font-medium text-foreground" : "text-muted-foreground")}>
            {s.label}
            {s.attention && " — still needed"}
            {s.current && !s.done && !s.attention && " (next)"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-panel px-3 py-2">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
    </div>
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
