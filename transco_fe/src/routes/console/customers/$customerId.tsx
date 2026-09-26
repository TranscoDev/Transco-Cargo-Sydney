import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  KeyRound,
  Mail,
  MessageSquare,
  Package,
  Phone,
  Receipt,
  Ship,
  StickyNote,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CUSTOMER_STATUS_LABELS, SHIPMENT_STATUS_LABELS } from "@/lib/transco/types";
import { fetchCustomerProfile, setPortalPassword } from "@/lib/transco/api";
import type { CustomerProfile } from "@/lib/transco/types";

// Lives as a sibling of index.tsx (the list) under customers/route.tsx's
// Outlet — see that file's comment for why this can't just be a flat
// dot-notation file named console.customers.$customerId.tsx (it silently
// never rendered, being treated as a child of the list route instead).
export const Route = createFileRoute("/console/customers/$customerId")({
  component: CustomerProfilePage,
});

function CustomerProfilePage() {
  const { customerId } = Route.useParams();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError(null);
    fetchCustomerProfile(customerId)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load customer");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <Link
        to="/console/customers"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Customers
      </Link>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {!profile && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {profile && (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-foreground">{profile.customerName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {profile.phoneNumber}
                </span>
                {profile.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {profile.email}
                  </span>
                )}
                <span>Customer ID: {profile.id}</span>
                {profile.channel && <span className="capitalize">Channel: {profile.channel}</span>}
              </div>
            </div>
            <Badge variant="secondary">{CUSTOMER_STATUS_LABELS[profile.status ?? "ACTIVE"]}</Badge>
          </div>

          {profile.channel !== "website" && (
            <Link
              to="/console/my-transco/$customerId"
              params={{ customerId: profile.id }}
              className="mb-2 inline-block text-xs font-medium text-primary hover:underline"
            >
              Open My Transco account view →
            </Link>
          )}
          {profile.channel !== "website" && <PortalPasswordCard customerId={profile.id} />}

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Total Bookings
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-2xl font-semibold tabular-nums">
                {profile.totalBookings ?? 0}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Total Shipments
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-2xl font-semibold tabular-nums">
                {profile.totalShipments ?? 0}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Total Revenue
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {profile.financeDataAvailable ? (
                  <p className="text-2xl font-semibold tabular-nums">
                    ${profile.totalRevenue ?? 0}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Available in Phase 5</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Outstanding Balance
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {profile.financeDataAvailable ? (
                  <p className="text-2xl font-semibold tabular-nums">
                    ${profile.outstandingBalance ?? 0}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Available in Phase 5</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="bookings">
            <TabsList>
              <TabsTrigger value="bookings">Bookings</TabsTrigger>
              <TabsTrigger value="shipments">Shipments</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="conversation">Conversation</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="bookings">
              {profile.bookings.length === 0 ? (
                <EmptyTabState icon={Package} text="No bookings yet." />
              ) : (
                <div className="flex flex-col gap-2">
                  {profile.bookings.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-md border border-border bg-panel p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium capitalize">
                          {b.requestedDay}, {b.resolvedDate}
                        </span>
                        <Badge variant="outline" className="capitalize">
                          {b.status}
                        </Badge>
                      </div>
                      {b.boxSummary && (
                        <p className="mt-1 text-xs text-muted-foreground">{b.boxSummary}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="shipments">
              {profile.liveShipments.length === 0 ? (
                <EmptyTabState icon={Ship} text="No shipments yet." />
              ) : (
                <div className="flex flex-col gap-2">
                  {profile.liveShipments.map((s) => (
                    <Link
                      key={s.id}
                      to="/console/shipments/$shipmentId"
                      params={{ shipmentId: s.id }}
                      className="rounded-md border border-border bg-panel p-3 text-sm hover:border-primary/40"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {s.hblNumber ? `HBL ${s.hblNumber}` : s.shipmentNumber}
                        </span>
                        <Badge variant="outline">{SHIPMENT_STATUS_LABELS[s.status]}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {s.origin || "?"} → {s.destination || "?"}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="payments">
              <EmptyTabState icon={Receipt} text="Available in Phase 5 (Finance)." />
            </TabsContent>

            <TabsContent value="conversation">
              {profile.messages.length === 0 ? (
                <EmptyTabState icon={MessageSquare} text="No conversation yet." />
              ) : (
                <div className="flex flex-col gap-2">
                  <Link
                    to="/console/conversations"
                    className="mb-1 inline-flex w-fit items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Open full conversation
                  </Link>
                  {profile.messages.slice(-5).map((m) => (
                    <div
                      key={m.id}
                      className="rounded-md border border-border bg-panel p-3 text-sm"
                    >
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {m.sender}
                      </p>
                      <p className="mt-0.5">{m.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="notes">
              {profile.notes ? (
                <p className="rounded-md border border-border bg-panel p-3 text-sm">
                  {profile.notes}
                </p>
              ) : (
                <EmptyTabState icon={StickyNote} text="No staff notes yet." />
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
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
      setError("Use at least 8 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await setPortalPassword(customerId, password);
      setDone(
        `Password set (${result.customerCode}). Tell the customer to sign in at My Transco with +${result.phoneNumber} and this password — they can change it in their profile.`,
      );
      setPassword("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5 rounded-lg border border-border bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <KeyRound className="h-3.5 w-3.5" />
          My Transco sign-in
        </p>
        {!open && (
          <Button type="button" size="sm" variant="outline" onClick={() => { setOpen(true); setDone(""); }}>
            Set password
          </Button>
        )}
      </div>
      {done && <p className="mt-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{done}</p>}
      {open && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] text-muted-foreground">
            Only after confirming you are speaking to this customer (e.g. they called from this number).
            This connects their full history and signs out any existing sessions.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              type="text"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Temporary password (8+ characters)"
              autoComplete="off"
              className="max-w-xs"
            />
            <Button type="button" size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setPassword(""); setError(""); }}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-[11px] font-medium text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function EmptyTabState({ icon: Icon, text }: { icon: typeof Package; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-8 text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
