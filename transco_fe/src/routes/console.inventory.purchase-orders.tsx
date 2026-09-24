import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/inventory/purchase-orders")({
  component: () => <ComingSoonPanel icon={ClipboardList} title="Purchase Orders" phase="Not built yet — Purchasing (Phase 4)" />,
});
