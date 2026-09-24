import { createFileRoute } from "@tanstack/react-router";
import { PauseCircle } from "lucide-react";

import { ComingSoonPanel } from "@/components/transco/coming-soon-panel";

// The real, functional Bot Controls (pause/resume website + WhatsApp)
// still live in the header dropdown, completely unchanged — this nav
// entry is a placeholder for its eventual relocation here (Phase 6,
// deferred), not a sign it's missing.
export const Route = createFileRoute("/console/ai/bot-controls")({
  component: () => (
    <ComingSoonPanel
      icon={PauseCircle}
      title="Bot Controls"
      phase="Still in the header dropdown for now — moves here in Phase 6 (deferred)"
    />
  ),
});
