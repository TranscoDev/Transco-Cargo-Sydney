import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/leads")({
  component: () => <ComingSoonPanel icon={Users} title="Leads" phase="Not yet scoped" />,
});
