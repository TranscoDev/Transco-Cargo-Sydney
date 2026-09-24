import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/finance/invoices")({
  component: () => <ComingSoonPanel icon={FileText} title="Invoices" phase="Not built yet — Finance (Phase 5)" />,
});
