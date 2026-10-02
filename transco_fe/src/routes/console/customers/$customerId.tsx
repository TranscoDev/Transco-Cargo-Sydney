import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Copy,
  History,
  KeyRound,
  Mail,
  MessageCircle,
  Phone,
  Ship,
  StickyNote,
  UserRoundCheck,
} from "lucide-react";

import {
  EmptyState,
  ErrorState,
  PageShell,
  SectionHeading,
  StatusBadge,
  Breadcrumbs,
} from "@/components/transco/page-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchCustomerProfile, setPortalPassword } from "@/lib/transco/api";
import { notify, friendlyError } from "@/lib/transco/notify";
import { bookingStatus, SENDER_LABEL, shipmentStatus } from "@/lib/transco/status";
import { useConversations } from "@/lib/transco/store";
import type { Booking, CustomerProfile, Shipment } from "@/lib/transco/types";
import { formatPhone, telHref } from "@/lib/transco/phone";

// Lives as a sibling of index.tsx (the list) under customers/route.tsx's
// Outlet — see that file's comment for why this can't just be a flat
// dot-notation file named console.customers.$customerId.tsx (it silently
// never rendered, being treated as a child of the list route instead).
export const Route = createFileRoute("/console/customers/$customerId")({
  component: CustomerProfilePage,
});

/**
 * A customer as a person, not a database record: who they are, what's
 * going on with them right now, and the next thing to do — then their
 * recent bookings, shipments and conversation. Finance isn't built yet,
 * so there are no revenue/balance placeholders here.
 */
function CustomerProfilePage() {
  const { customerId } = Route.useParams();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    setProfile(null);
    fetchCustomerProfile(customerId)
      .then(setProfile)
      .catch(() => setFailed(true));
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  const crumbs = [{ label: "Customers", to: "/console/customers" }, { label: profile?.customerName ?? "Customer" }];

  return (
    <PageShell>
      <Breadcrumbs items={crumbs} />
      {failed ? (
        <ErrorState title="Couldn't load this customer" onRetry={load} />
      ) : !profile ? (
        <ProfileSkeleton />
      ) : (
        <Profile profile={profile} />
      )}
    </PageShell>
  );
}

function Profile({ profile: p }: { profile: CustomerProfile }) {
  const navigate = useNavigate();
  const { selectConversation } = useConversations();
  const setOpenBooking = (bookingId: string) => void navigate({ to: "/console/bookings/$bookingId", params: { bookingId } });

  const today = new Date().toISOString().slice(0, 10);
  const activity = useMemo(() => {
    const open = p.bookings.filter((b) => b.status !== "cancelled");
    return {
      activeShipments: p.liveShipments.filter((s) => s.status !== "delivered").length,
      upcomingBookings: open.filter((b) => (b.status === "pending" || b.status === "confirmed") && (b.resolvedDate ?? "") >= today).length,
      declarationsToCheck: open.filter((b) => b.declarationSubmittedAt && b.declarationStatus !== "received"),
    };
  }, [p, today]);

  const openChat = () => {
    selectConversation(p.id);
    void navigate({ to: "/console/conversations" });
  };

  const firstDeclaration = activity.declarationsToCheck[0];
  const nextStep: { text: string; action: string; onClick: () => void } | null = firstDeclaration
    ? {
        text: `${activity.declarationsToCheck.length === 1 ? "A declaration is" : `${activity.declarationsToCheck.length} declarations are`} waiting to be checked.`,
        action: "Check declaration",
        onClick: () => setOpenBooking(firstDeclaration.id),
      }
    : p.needsAttention
      ? { text: "The bot flagged this conversation for staff.", action: "Open conversation", onClick: openChat }
      : null;

  const recentMessages = p.messages.slice(-3);
  const channelLabel = p.channel === "website" ? "Website chat" : (p.sources ?? []).includes("whatsapp") || p.channel === "whatsapp" ? "WhatsApp" : null;

  return (
    <>
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-lg font-semibold text-accent-foreground">
            {initials(p.customerName)}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{p.customerName}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {p.customerCode && <StatusBadge tone="neutral">{p.customerCode}</StatusBadge>}
              {channelLabel && <StatusBadge tone="info">{channelLabel}</StatusBadge>}
              {p.hasOnlineAccount && (
                <StatusBadge tone="success">
                  <UserRoundCheck className="h-3 w-3" aria-hidden /> Online account
                </StatusBadge>
              )}
              {p.status && p.status !== "ACTIVE" && <StatusBadge tone="neutral">{p.status === "HISTORICAL" ? "Past customer" : "Needs review"}</StatusBadge>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <a href={telHref(p.phoneNumber)} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Phone className="h-3.5 w-3.5" aria-hidden />{formatPhone(p.phoneNumber)}
              </a>
              {p.email && (
                <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  {p.email}
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.messages.length > 0 && (
            <Button type="button" onClick={openChat}>
              <MessageCircle className="mr-2 h-4 w-4" /> Open conversation
            </Button>
          )}
          {p.hasOnlineAccount && (
            <Button asChild variant="outline">
              <Link to="/console/my-transco/$customerId" params={{ customerId: p.id }}>
                Online account
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* The BL number is how we identify a customer's shipment — the
          newest one up front, earlier ones underneath. */}
      <LatestBl shipments={p.liveShipments} />

      {/* Current activity + next step */}
      <section className="mb-8 rounded-xl border bg-card p-5 shadow-xs">
        <SectionHeading>Current activity</SectionHeading>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <ActivityStat icon={Ship} value={activity.activeShipments} label={activity.activeShipments === 1 ? "active shipment" : "active shipments"} />
          <ActivityStat icon={CalendarClock} value={activity.upcomingBookings} label={activity.upcomingBookings === 1 ? "upcoming booking" : "upcoming bookings"} />
          <ActivityStat
            icon={ClipboardCheck}
            value={activity.declarationsToCheck.length}
            label={activity.declarationsToCheck.length === 1 ? "declaration to check" : "declarations to check"}
          />
        </div>
        {nextStep ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft px-4 py-3">
            <p className="text-sm text-warning-foreground">
              <span className="font-semibold">Next step:</span> {nextStep.text}
            </p>
            <Button type="button" size="sm" onClick={nextStep.onClick}>
              {nextStep.action}
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Nothing needs doing for this customer right now.</p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Bookings */}
        <section>
          <SectionHeading>Recent bookings</SectionHeading>
          <div className="rounded-xl border bg-card">
            {p.bookings.length ? (
              <ul className="divide-y">
                {p.bookings.slice(0, 6).map((b) => (
                  <BookingRow key={b.id} booking={b} onOpen={() => setOpenBooking(b.id)} />
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={CalendarClock} title="No bookings yet" />
            )}
          </div>
        </section>

        {/* Shipments */}
        <section>
          <SectionHeading>Shipments</SectionHeading>
          <div className="rounded-xl border bg-card">
            {p.liveShipments.length ? (
              <ul className="divide-y">
                {p.liveShipments.slice(0, 6).map((s) => {
                  const st = shipmentStatus(s.status);
                  return (
                    <li key={s.id}>
                      <Link
                        to="/console/shipments/$shipmentId"
                        params={{ shipmentId: s.id }}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium tabular-nums text-foreground">
                            {s.batchNumber ? `Shipment ${s.batchNumber}` : s.hblNumber ? `BL ${s.hblNumber}` : "Shipment"}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[s.batchNumber && s.hblNumber ? `BL ${s.hblNumber}` : null, [s.origin, s.destination].filter(Boolean).join(" → ")].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState compact icon={Ship} title="No shipments yet" description="A shipment appears here once a BL is assigned." />
            )}
          </div>
        </section>

        {/* Conversation */}
        <section>
          <SectionHeading
            action={
              p.messages.length > 0 ? (
                <button type="button" onClick={openChat} className="text-sm font-medium text-primary hover:underline">
                  Open conversation
                </button>
              ) : undefined
            }
          >
            Latest messages
          </SectionHeading>
          <div className="rounded-xl border bg-card">
            {recentMessages.length ? (
              <ul className="divide-y">
                {recentMessages.map((m) => (
                  <li key={m.id} className="px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      {SENDER_LABEL[m.sender]} · {fmtWhen(m.createdAt)}
                    </p>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-sm text-foreground">{m.body || "(attachment)"}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={MessageCircle} title="No messages yet" />
            )}
          </div>
        </section>

        {/* Notes */}
        <section>
          <SectionHeading>Staff notes</SectionHeading>
          <div className="rounded-xl border bg-card">
            {p.notes ? (
              <p className="whitespace-pre-line px-4 py-3 text-sm text-foreground">{p.notes}</p>
            ) : (
              <EmptyState compact icon={StickyNote} title="No notes yet" description="Add notes from the Customers list." />
            )}
          </div>
        </section>
      </div>

      {/* Older, imported history — only if there is any */}
      {(p.shipments?.length ?? 0) > 0 && (
        <details className="group mt-8 rounded-xl border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-foreground">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            Earlier shipments ({p.shipments!.length}, from our old records)
            <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <ul className="divide-y border-t">
            {p.shipments!.map((h) => (
              <li key={h.id} className="px-4 py-2.5 text-sm">
                <span className="font-medium text-foreground">{h.receiverName || "Receiver"}</span>
                <span className="text-muted-foreground">
                  {h.batchNumber ? ` · Shipment ${h.batchNumber}` : ""}
                  {h.receiverAddress ? ` · ${h.receiverAddress}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {p.channel !== "website" && <PortalPasswordCard customerId={p.id} />}

    </>
  );
}

/** Newest BL first (shipments arrive newest first); only ones with a BL. */
function LatestBl({ shipments }: { shipments: Shipment[] }) {
  const withBl = shipments.filter((s) => s.hblNumber);
  const latest = withBl[0];
  if (!latest) {
    return (
      <section className="mb-6 flex items-center gap-3 rounded-xl border border-dashed bg-card px-5 py-4">
        <Ship className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">No BL number yet — it appears here as soon as one is assigned.</p>
      </section>
    );
  }
  const earlier = withBl.slice(1);
  const st = shipmentStatus(latest.status);
  const copy = () => {
    void navigator.clipboard
      .writeText(latest.hblNumber ?? "")
      .then(() => notify.success(`BL ${latest.hblNumber} copied`))
      .catch(() => notify.error("Couldn't copy", "Select the number and copy it instead."));
  };
  return (
    <section className="mb-6 rounded-xl border-2 border-primary/40 bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest BL number</p>
          <p className="mt-1 select-all text-3xl font-bold tracking-tight tabular-nums text-foreground">{latest.hblNumber}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            {latest.batchNumber ? <span className="font-medium text-foreground">Shipment {latest.batchNumber}</span> : null}
            {[latest.origin, latest.destination].filter(Boolean).length > 0 && <span>· {[latest.origin, latest.destination].filter(Boolean).join(" → ")}</span>}
            {latest.createdAt && <span>· assigned {fmtDay(latest.createdAt.slice(0, 10))}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={copy}>
            <Copy className="mr-2 h-4 w-4" aria-hidden /> Copy
          </Button>
          <Button asChild>
            <Link to="/console/shipments/$shipmentId" params={{ shipmentId: latest.id }}>
              Open shipment
            </Link>
          </Button>
        </div>
      </div>
      {earlier.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">Earlier BLs</span>
          {earlier.map((s) => (
            <Link
              key={s.id}
              to="/console/shipments/$shipmentId"
              params={{ shipmentId: s.id }}
              className="rounded-md border bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-foreground transition-colors hover:border-primary/50"
            >
              {s.hblNumber}
              {s.batchNumber ? <span className="text-muted-foreground"> · Shipment {s.batchNumber}</span> : null}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityStat({ icon: Icon, value, label }: { icon: typeof Ship; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function BookingRow({ booking: b, onOpen }: { booking: Booking; onOpen: () => void }) {
  const st = bookingStatus(b.status);
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            {b.bookingCode ? `${b.bookingCode} · ` : ""}
            {fmtDay(b.resolvedDate)}
            {b.requestedTime ? ` · ${b.requestedTime}` : ""}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {b.boxSummary || "No box details"}
            {b.declarationSubmittedAt && b.declarationStatus !== "received" ? " · declaration to check" : ""}
          </span>
        </span>
        <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

/** Lets staff set a temporary My Transco password for this customer —
 * after confirming who they're speaking to (e.g. the customer called from
 * this number). The customer signs in with their phone number and this
 * password, and can change it in their profile. */
function PortalPasswordCard({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const save = async () => {
    if (password.length < 8) {
      setError("Please use at least 8 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await setPortalPassword(customerId, password);
      setDone(
        `Tell the customer to sign in at My Transco with ${formatPhone(result.phoneNumber)} and this password — they can change it in their profile.`,
      );
      notify.success("Sign-in password set", result.customerCode ?? undefined);
      setPassword("");
      setOpen(false);
    } catch (err) {
      setError(friendlyError(err, "Couldn't set the password. Nothing was changed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8 rounded-xl border bg-card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
            My Transco sign-in
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">Set a temporary password if the customer can't sign in with a WhatsApp code.</p>
        </div>
        {!open && (
          <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setDone(""); }}>
            Set password
          </Button>
        )}
      </div>
      {done && <p className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success-foreground">✓ {done}</p>}
      {open && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-muted-foreground">
            Only after confirming you're speaking to this customer (e.g. they called from this number). This connects their full history and signs
            out any existing sessions.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              type="text"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Temporary password (8+ characters)"
              autoComplete="off"
              className="max-w-xs"
              aria-label="Temporary password"
            />
            <Button type="button" size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save password"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setPassword(""); setError(""); }}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-attention-foreground">{error}</p>}
        </div>
      )}
    </section>
  );
}

function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading customer">
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="mb-8 h-28 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (!parts.length) return "?";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

function fmtDay(iso: string | undefined) {
  if (!iso) return "No date";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
