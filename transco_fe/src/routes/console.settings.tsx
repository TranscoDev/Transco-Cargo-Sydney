import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/settings")({
  component: () => <ComingSoonPanel icon={Settings} title="Settings" phase="Not yet scoped" />,
});
