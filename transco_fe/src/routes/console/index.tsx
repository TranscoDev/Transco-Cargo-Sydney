import { createFileRoute, Navigate } from "@tanstack/react-router";

// Bare /console (bookmarked by staff today) keeps working — just
// redirects straight to the dashboard instead of 404ing.
export const Route = createFileRoute("/console/")({
  component: () => <Navigate to="/console/dashboard" />,
});
