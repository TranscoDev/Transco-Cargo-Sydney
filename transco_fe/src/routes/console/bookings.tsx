import { createFileRoute } from "@tanstack/react-router";

import { BookingsPanel } from "@/components/transco/bookings-panel";
import { useConversations } from "@/lib/transco/store";

// Unchanged from the old /console "bookings" tab — same component,
// same props.
export const Route = createFileRoute("/console/bookings")({
  component: BookingsPage,
});

function BookingsPage() {
  const { bookings, deleteBooking, updateBookingStatus, updateBooking, assignBookingBl } = useConversations();
  return (
    <BookingsPanel
      bookings={bookings}
      onDelete={deleteBooking}
      onUpdateStatus={updateBookingStatus}
      onUpdateBooking={updateBooking}
      onAssignBl={assignBookingBl}
    />
  );
}
