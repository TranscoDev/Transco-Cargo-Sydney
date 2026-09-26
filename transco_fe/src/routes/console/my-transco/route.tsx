import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout only — the list (index.tsx) and a customer's profile
// ($customerId.tsx) are siblings under /console/my-transco/*, the same
// structure as /console/customers (see that folder's route.tsx for why).
export const Route = createFileRoute("/console/my-transco")({
  component: () => <Outlet />,
});
