import { createFileRoute, useSearch } from "@tanstack/react-router";

import { BookingsPanel, type BookingFilter } from "@/components/transco/bookings-panel";
import { useConversations } from "@/lib/transco/store";

export const Route = createFileRoute("/console/bookings/")({
  component: BookingsPage,
});

function BookingsPage() {
  // The ?show=… filter is validated on the bookings layout route.
  const { show } = useSearch({ from: "/console/bookings" });
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
