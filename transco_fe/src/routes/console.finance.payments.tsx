import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/finance/payments")({
  component: () => <ComingSoonPanel icon={Wallet} title="Payments" phase="Not built yet — Finance (Phase 5)" />,
});
