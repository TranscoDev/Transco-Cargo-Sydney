import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeftRight } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/inventory/movements")({
  component: () => <ComingSoonPanel icon={ArrowLeftRight} title="Stock Movements" phase="Not built yet — Inventory (Phase 3)" />,
});
