import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Box, CheckCircle2, Package, Phone, Ship, Truck, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchShipment, updateShipment } from "@/lib/transco/api";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  type Shipment,
  type ShipmentStatus,
} from "@/lib/transco/types";

// Sibling of index.tsx under shipments/route.tsx's Outlet — same reason
// as console/customers/$customerId.tsx (see that file's comment).
export const Route = createFileRoute("/console/shipments/$shipmentId")({
  component: ShipmentDetailPage,
});

function ShipmentDetailPage() {
  const { shipmentId } = Route.useParams();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingDraft, setTrackingDraft] = useState("");
  const [warehouseDraft, setWarehouseDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetchShipment(shipmentId)
      .then((data) => {
        setShipment(data);
        setTrackingDraft(data.trackingNumber ?? "");
        setWarehouseDraft(data.warehouseStatus ?? "");
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load shipment"));
  };

  useEffect(() => {
    setShipment(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId]);

  const handleStatusChange = async (status: ShipmentStatus) => {
    if (!shipment) return;
    setSaving(true);
    try {
      const updated = await updateShipment(shipment.id, { status });
      setShipment(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTracking = async () => {
    if (!shipment) return;
    setSaving(true);
    try {
      const updated = await updateShipment(shipment.id, {
        trackingNumber: trackingDraft || null,
        warehouseStatus: warehouseDraft || null,
      });
      setShipment(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update shipment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <Link
        to="/console/shipments"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Shipments
      </Link>

      {error && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {!shipment && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {shipment && (
        <>
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Ship className="h-4 w-4 text-muted-foreground" />
                {shipment.shipmentNumber}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {shipment.customerName || "Unknown customer"}
                </span>
                {shipment.phoneNumber && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {shipment.phoneNumber}
                  </span>
                )}
                {shipment.bookingId && (
                  <Link to="/console/bookings" className="text-primary hover:underline">
                    View Linked Booking
                  </Link>
                )}
              </div>
            </div>
            <Badge variant="secondary" className="text-sm">
              {SHIPMENT_STATUS_LABELS[shipment.status]}
            </Badge>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">Route</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-sm font-medium">
                {shipment.origin || "?"} → {shipment.destination || "?"}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">Cargo</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-sm">
                {shipment.boxCount != null ? `${shipment.boxCount} boxes` : "—"}
                {shipment.weight != null ? ` · ${shipment.weight}kg` : ""}
                {shipment.cbm != null ? ` · ${shipment.cbm}m³` : ""}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="p-4 pb-1">
                <CardTitle className="text-xs font-medium text-muted-foreground">Service Type</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 text-sm">{shipment.serviceType || "—"}</CardContent>
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Status</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-4 pt-0">
                <Select value={shipment.status} onValueChange={(v) => handleStatusChange(v as ShipmentStatus)} disabled={saving}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIPMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SHIPMENT_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="warehouseStatus">Warehouse Note</Label>
                  <Input
                    id="warehouseStatus"
                    value={warehouseDraft}
                    onChange={(e) => setWarehouseDraft(e.target.value)}
                    placeholder="e.g. Received, 3 of 3 boxes checked in"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="trackingNumber">Tracking Number</Label>
                  <Input
                    id="trackingNumber"
                    value={trackingDraft}
                    onChange={(e) => setTrackingDraft(e.target.value)}
                  />
                </div>
                <Button type="button" size="sm" onClick={handleSaveTracking} disabled={saving} className="self-start">
                  Save
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm">Timeline</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {shipment.history.length === 0 ? (
                  <EmptyState icon={Package} text="No status history yet." />
                ) : (
                  <ol className="flex flex-col gap-3">
                    {[...shipment.history].reverse().map((point, idx) => (
                      <li key={`${point.status}-${point.at}-${idx}`} className="flex items-start gap-2 text-sm">
                        <CheckCircle2
                          className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", idx === 0 ? "text-primary" : "text-muted-foreground")}
                        />
                        <div>
                          <p className={cn("font-medium", idx === 0 && "text-primary")}>
                            {SHIPMENT_STATUS_LABELS[point.status]}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(point.at).toLocaleString("en-AU", {
                              day: "numeric",
                              month: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          {(shipment.blNumber || shipment.containerNumber) && (
            <Card>
              <CardHeader className="p-4 pb-2">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <Truck className="h-3.5 w-3.5" />
                  Documentation
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 p-4 pt-0 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">BL Number</p>
                  <p>{shipment.blNumber || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Container Number</p>
                  <p className="inline-flex items-center gap-1">
                    <Box className="h-3 w-3" />
                    {shipment.containerNumber || "—"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Package; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-6 text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
