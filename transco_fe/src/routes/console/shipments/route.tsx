import { createFileRoute, Outlet } from "@tanstack/react-router";

// Same list+detail sibling pattern as console/customers/route.tsx — see
// that file's comment for why this can't be a flat dot-notation detail
// file (it silently never rendered, being treated as a child of the list
// route instead).
export const Route = createFileRoute("/console/shipments")({
  component: () => <Outlet />,
});
