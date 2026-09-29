import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Page for a module that hasn't been built yet (it sits in the greyed
 * "Coming later" group of the sidebar). Says so plainly and points back
 * to work that can be done today — never a broken link or fake data. */
export function ComingSoonPanel({
  icon: Icon,
  title,
  note,
}: {
  icon: LucideIcon;
  title: string;
  /** Internal roadmap note — kept in the code for developers, not shown to staff. */
  phase?: string;
  /** Optional helpful pointer for staff, e.g. where the feature lives today. */
  note?: string;
}) {
  return (
    <div className="grid h-full place-items-center bg-background px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="h-6 w-6" aria-hidden />
        </div>
        <p className="mt-4 text-base font-semibold text-foreground">{title} is coming later</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This part of Transco Admin isn't built yet, so there's nothing to do here for now.
        </p>
        {note && <p className="mt-3 rounded-lg bg-info-soft px-3 py-2 text-sm text-info-foreground">{note}</p>}
        <Button asChild variant="outline" size="sm" className="mt-5">
          <Link to="/console/dashboard">Back to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
