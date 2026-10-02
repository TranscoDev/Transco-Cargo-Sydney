import { createFileRoute, Outlet } from "@tanstack/react-router";

// Lightweight layout so the list (index.tsx) and one booking's full page
// ($bookingId.tsx) are proper siblings under /console/bookings/* (same
// pattern as customers/route.tsx). ?show=declarations / ?show=bls opens
// the list already filtered — used by the dashboard's work list.
type BookingsSearch = { show?: "declarations" | "bls" };

export const Route = createFileRoute("/console/bookings")({
  validateSearch: (search: Record<string, unknown>): BookingsSearch =>
    search["show"] === "declarations" || search["show"] === "bls" ? { show: search["show"] } : {},
  component: () => <Outlet />,
});
