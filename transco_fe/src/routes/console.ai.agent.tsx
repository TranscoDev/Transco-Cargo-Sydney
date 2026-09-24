import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

export const Route = createFileRoute("/console/ai/agent")({
  component: () => <ComingSoonPanel icon={Bot} title="Agent Transco" phase="Not built yet — AI/ERP integration (Phase 6, deferred)" />,
});
