import { createFileRoute } from "@tanstack/react-router";

import { BookingWorkspace } from "@/components/transco/booking-details-sheet";

// One booking as a full page — the drop-off work (confirm, values, BL,
// forms) needs more room than a side panel.
export const Route = createFileRoute("/console/bookings/$bookingId")({
  component: BookingPage,
});

function BookingPage() {
  const { bookingId } = Route.useParams();
  return <BookingWorkspace key={bookingId} bookingId={bookingId} />;
}
