import { AlertCircle, Check, CheckCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MessageStatus } from "@/lib/transco/types";

export function MessageStatusIcon({
  status,
  failureReason,
  className,
}: {
  status?: MessageStatus | undefined;
  failureReason?: string | null | undefined;
  className?: string;
}) {
  if (!status) return null;

  if (status === "FAILED") {
    return (
      <AlertCircle
        aria-label={failureReason ?? "Failed to send"}
        title={failureReason ?? "Failed to send"}
        className={cn("h-3.5 w-3.5 text-destructive", className)}
      />
    );
  }
  if (status === "SENT") {
    return <Check aria-label="Sent" className={cn("h-3.5 w-3.5 opacity-60", className)} />;
  }
  if (status === "DELIVERED") {
    return (
      <CheckCheck aria-label="Delivered" className={cn("h-3.5 w-3.5 opacity-60", className)} />
    );
  }
  return <CheckCheck aria-label="Read" className={cn("h-3.5 w-3.5 text-sky-500", className)} />;
}