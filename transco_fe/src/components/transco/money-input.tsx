import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** An amount box with a fixed "$" inside on the left — it stays while typing. */
export const MoneyInput = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  ({ className, inputMode = "decimal", ...props }, ref) => (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground">
        $
      </span>
      <Input ref={ref} inputMode={inputMode} className={cn(className, "pl-6")} {...props} />
    </div>
  ),
);
MoneyInput.displayName = "MoneyInput";
