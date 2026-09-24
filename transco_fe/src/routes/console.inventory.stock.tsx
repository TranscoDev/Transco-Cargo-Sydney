import { createFileRoute } from "@tanstack/react-router";
import { PackageSearch } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/inventory/stock")({
  component: () => <ComingSoonPanel icon={PackageSearch} title="Stock" phase="Not built yet — Inventory (Phase 3)" />,
});
