import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, IdCard, Mail, MapPin, Phone, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchReceiver } from "@/lib/transco/api";
import { SHIPMENT_STATUS_LABELS, type ReceiverProfile } from "@/lib/transco/types";

// Sibling of index.tsx under shipments/route.tsx's Outlet. Mirrors
// CustomerProfile's role but for the receiving side — a receiver has no
// `customers` record, so this is the only "profile" they get: every
// shipment addressed to them, deduped, across any sender or batch.
export const Route = createFileRoute("/console/shipments/receiver/$receiverId")({
  component: ReceiverProfilePage,
});

function ReceiverProfilePage() {
  const { receiverId } = Route.useParams();
  const [receiver, setReceiver] = useState<ReceiverProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReceiver(null);
    setError(null);
    fetchReceiver(receiverId)
      .then(setReceiver)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load receiver"));
  }, [receiverId]);

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

      {!receiver && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {receiver && (
        <>
          <div className="mb-5">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <User className="h-4 w-4 text-muted-foreground" />
              {receiver.name}
            </h1>
            <p className="text-xs text-muted-foreground">
              Receiver — {receiver.hblNumbers.length} shipment
              {receiver.hblNumbers.length === 1 ? "" : "s"} received, no duplicate contact records
            </p>
          </div>

          <Card className="mb-6">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Contact</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 p-4 pt-0 text-sm sm:grid-cols-3">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {receiver.phone || "—"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {receiver.email || "—"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <IdCard className="h-3.5 w-3.5 text-muted-foreground" />
                {receiver.identityDocument
                  ? `${receiver.identityDocument.type} ${receiver.identityDocument.number}`
                  : "—"}
              </span>
              <span className="inline-flex items-start gap-1.5 sm:col-span-3">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {receiver.address || "—"}
              </span>
            </CardContent>
          </Card>

          <h2 className="mb-2 text-sm font-medium text-foreground">
            All shipments to this person ({receiver.shipments.length})
          </h2>

          <div className="overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-secondary/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">HBL</th>
                  <th className="px-3 py-2 font-medium">Batch</th>
                  <th className="px-3 py-2 font-medium">Sender</th>
                  <th className="px-3 py-2 font-medium">Boxes</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {receiver.shipments.map((s) => (
                  <tr key={s.id} className="border-t border-border hover:bg-secondary/30">
                    <td className="px-3 py-2">
                      <Link
                        to="/console/shipments/$shipmentId"
                        params={{ shipmentId: s.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.hblNumber || s.shipmentNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {s.consolidationId ? (
                        <Link
                          to="/console/shipments/batch/$batchId"
                          params={{ batchId: s.consolidationId }}
                          className="hover:underline"
                        >
                          Batch {s.batchNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {s.customerName ? (
                        <Link
                          to="/console/customers/$customerId"
                          params={{ customerId: s.customerId }}
                          className="text-primary hover:underline"
                        >
                          {s.customerName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {s.totalBoxes ?? s.boxCount ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="font-medium">
                        {SHIPMENT_STATUS_LABELS[s.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
