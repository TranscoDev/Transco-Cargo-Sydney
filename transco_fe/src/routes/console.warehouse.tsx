import { createFileRoute } from "@tanstack/react-router";
import { Warehouse } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/warehouse")({
  component: () => <ComingSoonPanel icon={Warehouse} title="Warehouse" phase="Not built yet — Warehouse/Inventory (Phase 3)" />,
});
