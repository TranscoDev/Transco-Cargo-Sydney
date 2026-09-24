import { createFileRoute } from "@tanstack/react-router";
import { Receipt } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/finance/expenses")({
  component: () => <ComingSoonPanel icon={Receipt} title="Expenses" phase="Not built yet — Finance (Phase 5)" />,
});
