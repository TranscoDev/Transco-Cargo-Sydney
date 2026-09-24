import { createFileRoute, Outlet } from "@tanstack/react-router";

// Lightweight layout so the list (index.tsx) and detail ($customerId.tsx)
// can be proper siblings under /console/customers/* instead of the
// detail page being a silent no-op child of the list page. This file
// intentionally does nothing but render an outlet.
export const Route = createFileRoute("/console/customers")({
  component: () => <Outlet />,
});
