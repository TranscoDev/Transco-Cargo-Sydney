import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mail, MessageSquare, Package, Phone, Receipt, StickyNote } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CUSTOMER_STATUS_LABELS } from "@/lib/transco/types";
import { fetchCustomerProfile } from "@/lib/transco/api";
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
            <Badge variant="secondary">
              {CUSTOMER_STATUS_LABELS[profile.status ?? "ACTIVE"]}
            </Badge>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">Total Bookings</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-2xl font-semibold tabular-nums">
                {profile.totalBookings ?? 0}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">Total Shipments</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-2xl font-semibold tabular-nums">
                {profile.totalShipments ?? 0}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">Total Revenue</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {profile.financeDataAvailable ? (
                  <p className="text-2xl font-semibold tabular-nums">${profile.totalRevenue ?? 0}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Available in Phase 5</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">Outstanding Balance</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {profile.financeDataAvailable ? (
                  <p className="text-2xl font-semibold tabular-nums">${profile.outstandingBalance ?? 0}</p>
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
                    <div key={b.id} className="rounded-md border border-border bg-panel p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium capitalize">{b.requestedDay}, {b.resolvedDate}</span>
                        <Badge variant="outline" className="capitalize">{b.status}</Badge>
                      </div>
                      {b.boxSummary && <p className="mt-1 text-xs text-muted-foreground">{b.boxSummary}</p>}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="shipments">
              {(profile.shipments?.length ?? 0) === 0 ? (
                <EmptyTabState icon={Package} text="No shipments yet." />
              ) : (
                <div className="flex flex-col gap-2">
                  {profile.shipments?.map((s) => (
                    <div key={s.id} className="rounded-md border border-border bg-panel p-3 text-sm">
                      <p className="font-medium">{s.receiverName}</p>
                      <p className="text-xs text-muted-foreground">{s.receiverAddress}</p>
                    </div>
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
                    <div key={m.id} className="rounded-md border border-border bg-panel p-3 text-sm">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.sender}</p>
                      <p className="mt-0.5">{m.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="notes">
              {profile.notes ? (
                <p className="rounded-md border border-border bg-panel p-3 text-sm">{profile.notes}</p>
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

function EmptyTabState({ icon: Icon, text }: { icon: typeof Package; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-8 text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
