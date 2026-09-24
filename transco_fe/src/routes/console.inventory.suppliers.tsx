import { createFileRoute } from "@tanstack/react-router";
import { Truck } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/inventory/suppliers")({
  component: () => <ComingSoonPanel icon={Truck} title="Suppliers" phase="Not built yet — Purchasing (Phase 4)" />,
});
