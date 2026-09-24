import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/finance/reports")({
  component: () => <ComingSoonPanel icon={BarChart3} title="Reports" phase="Not built yet — Reports (Phase 6, deferred)" />,
});
