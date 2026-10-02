import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";

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
import { ShipmentPicker } from "@/components/transco/shipment-picker";
import { moveShipment } from "@/lib/transco/api";
import { friendlyError, notify } from "@/lib/transco/notify";

const name = (n: number | null) => (n ? `Shipment ${n}` : "no shipment");

/**
 * "This BL is in Shipment 58 → [Shipment 59 ▾] Move" — for when staff put a
 * customer in the wrong shipment. The same BL record moves (never a copy),
 * after a confirmation, and the move is written into the BL's history.
 */
export function MoveShipmentControl({
  shipmentId,
  currentBatchNumber,
  blNumber,
  customerName,
  onMoved,
}: {
  shipmentId: string;
  currentBatchNumber: number | null;
  blNumber: string | null;
  customerName?: string | null | undefined;
  onMoved: () => void;
}) {
  const [target, setTarget] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const targetNumber = target === "" ? null : Number(target);
  const changed = targetNumber !== currentBatchNumber;
  const who = [blNumber ? `BL ${blNumber}` : "This BL", customerName ? `(${customerName})` : null].filter(Boolean).join(" ");

  const move = async () => {
    setMoving(true);
    try {
      const r = await moveShipment(shipmentId, targetNumber);
      notify.success(`Moved to ${name(r.to)}`, `${who} was moved from ${name(r.from)}. It's recorded in the BL's history.`);
      setConfirming(false);
      setTarget("");
      onMoved();
    } catch (err) {
      notify.error("Couldn't move it", friendlyError(err, "Nothing was changed — please try again."));
    } finally {
      setMoving(false);
    }
  };

  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="font-semibold text-foreground">Shipment</span>
        <span className="text-muted-foreground">
          {blNumber ? `BL ${blNumber} is in ` : "In "}
          <span className="font-medium text-foreground">{currentBatchNumber ? `Shipment ${currentBatchNumber}` : "no shipment yet"}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Move to</span>
        <div className="min-w-44 flex-1">
          <ShipmentPicker value={target} onChange={setTarget} className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm text-foreground" />
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!changed || moving} onClick={() => setConfirming(true)}>
          Move
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to {name(targetNumber)}?</AlertDialogTitle>
            <AlertDialogDescription>
              {who} moves from {name(currentBatchNumber)} to {name(targetNumber)}. It isn't copied — it just changes shipment, and the move is
              noted in its history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>Keep it where it is</AlertDialogCancel>
            <AlertDialogAction
              disabled={moving}
              onClick={(e) => {
                e.preventDefault();
                void move();
              }}
            >
              {moving ? "Moving…" : `Move to ${name(targetNumber)}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
