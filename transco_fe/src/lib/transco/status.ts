import type { StatusTone } from "@/components/transco/page-kit";
import type { BookingStatus, SenderType, ShipmentStatus } from "./types";
import { SHIPMENT_STATUS_LABELS } from "./types";

/**
 * One place that decides how a status looks and reads, so "Pending" or
 * "In transit" is the same colour and wording on every page.
 * Tones: pending = waiting on us/them, info = moving along,
 * success = done, attention = needs a look, neutral = inactive.
 */

export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: StatusTone }> = {
  pending: { label: "Pending", tone: "pending" },
  confirmed: { label: "Confirmed", tone: "info" },
  completed: { label: "Done", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function bookingStatus(status: string) {
  return BOOKING_STATUS[status as BookingStatus] ?? { label: status, tone: "neutral" as StatusTone };
}

const SHIPMENT_TONE: Record<ShipmentStatus, StatusTone> = {
  booked: "pending",
  cargo_received: "info",
  at_warehouse: "info",
  loaded: "info",
  in_transit: "info",
  arrived: "info",
  customs: "pending",
  ready_for_collection: "attention",
  delivered: "success",
};

export function shipmentStatus(status: string) {
  const s = status as ShipmentStatus;
  return {
    label: SHIPMENT_STATUS_LABELS[s] ?? status,
    tone: SHIPMENT_TONE[s] ?? ("neutral" as StatusTone),
  };
}

/** Plain words for who sent a message. */
export const SENDER_LABEL: Record<SenderType, string> = {
  CUSTOMER: "Customer",
  CHATBOT: "Bot",
  HUMAN: "Staff",
};
