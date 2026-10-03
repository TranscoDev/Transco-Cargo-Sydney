import type { Booking } from "@/lib/transco/types";

/**
 * Light-background tags so staff spot a home pickup (we collect from the
 * sender — arranged by phone) or door delivery at a glance. Same font and
 * size as the surrounding text — only the background changes.
 */
export function HandoverTags({ booking }: { booking: Pick<Booking, "handover" | "deliveryType" | "pickupNote"> }) {
  const pickup = booking.handover === "pickup";
  const door = booking.deliveryType === "door";
  if (!pickup && !door) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
      {pickup ? (
        <span className="rounded-md bg-amber-100 px-1.5 text-inherit" title={booking.pickupNote || undefined}>
          Home pickup
        </span>
      ) : null}
      {door ? <span className="rounded-md bg-sky-100 px-1.5 text-inherit">Door delivery</span> : null}
    </span>
  );
}
