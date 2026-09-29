import { createFileRoute } from "@tanstack/react-router";

import { BookingsPanel, type BookingFilter } from "@/components/transco/bookings-panel";
import { useConversations } from "@/lib/transco/store";

// ?show=declarations / ?show=bls opens the list already filtered to that
// work — used by the dashboard's "Check 3 declarations" / "Assign 2 BLs".
type BookingsSearch = { show?: "declarations" | "bls" };

export const Route = createFileRoute("/console/bookings")({
  validateSearch: (search: Record<string, unknown>): BookingsSearch =>
    search["show"] === "declarations" || search["show"] === "bls" ? { show: search["show"] } : {},
  component: BookingsPage,
});

function BookingsPage() {
  const { show } = Route.useSearch();
  const { bookings, deleteBooking, updateBookingStatus, updateBooking, assignBookingBl } = useConversations();
  return (
    <BookingsPanel
      bookings={bookings}
      onDelete={deleteBooking}
      onUpdateStatus={updateBookingStatus}
      onUpdateBooking={updateBooking}
      onAssignBl={assignBookingBl}
      initialFilter={(show ?? "all") as BookingFilter}
    />
  );
}
