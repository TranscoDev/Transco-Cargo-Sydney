import { createFileRoute } from "@tanstack/react-router";
import { MapPin } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/tracking")({
  component: () => <ComingSoonPanel icon={MapPin} title="Tracking" phase="Not built yet — Operations (Phase 2)" />,
});
