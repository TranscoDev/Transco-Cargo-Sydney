import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ChevronRight, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The console's shared page building blocks. Every page uses these
 * instead of hand-rolling its own header/badge/empty state, so the whole
 * app looks and reads as one calm product:
 *
 *   PageShell      scrollable page area with consistent padding
 *   PageHeader     breadcrumbs, title, one-line description, actions
 *   SectionHeading a quiet heading for a group on a page
 *   StatusBadge    soft tinted status pill (success/pending/info/attention/neutral)
 *   EmptyState     positive "nothing here" message with an optional action
 *   ErrorState     calm "couldn't load" message with Try again
 *   LoadingRows    skeleton rows while data loads
 */

// ---------------------------------------------------------------
// Layout
// ---------------------------------------------------------------

export function PageShell({ children, className, width = "wide" }: { children: ReactNode; className?: string; width?: "wide" | "narrow" | "full" }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div
        className={cn(
          "mx-auto w-full px-4 py-5 md:px-8 md:py-7",
          width === "wide" && "max-w-6xl",
          width === "narrow" && "max-w-3xl",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface Crumb {
  label: string;
  /** Omit for the current page (last crumb). */
  to?: string;
  params?: Record<string, string>;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {items.map((c, i) => (
          <Fragment key={`${c.label}-${i}`}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden />}
            <li className="min-w-0">
              {c.to ? (
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                <Link to={c.to as any} params={c.params as any} className="truncate hover:text-foreground hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {c.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Title + one short line of guidance + actions. Put ONE primary action
 * (default Button) and keep the rest variant="outline"/"ghost" so the
 * main thing to do is obvious.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  icon: Icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <header className="mb-6">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            {Icon && <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="min-w-0 break-words">{title}</span>
          </h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function SectionHeading({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------
// Status
// ---------------------------------------------------------------

export type StatusTone = "success" | "pending" | "info" | "attention" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success-soft text-success-foreground",
  pending: "bg-warning-soft text-warning-foreground",
  info: "bg-info-soft text-info-foreground",
  attention: "bg-attention-soft text-attention-foreground",
  neutral: "bg-secondary text-secondary-foreground",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-success",
  pending: "bg-warning",
  info: "bg-info",
  attention: "bg-attention",
  neutral: "bg-muted-foreground/60",
};

/** Soft, readable status pill. Same tone = same meaning everywhere. */
export function StatusBadge({ tone, children, dot = false, className }: { tone: StatusTone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[tone])} aria-hidden />}
      {children}
    </span>
  );
}

export function toneClasses(tone: StatusTone) {
  return TONE_CLASSES[tone];
}

// ---------------------------------------------------------------
// Empty / error / loading
// ---------------------------------------------------------------

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-6" : "px-6 py-12")}>
      {Icon && (
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * For a failed load. Says what happened in plain words and offers a
 * retry — never a raw status code. Pass `detail` only if it helps staff.
 */
export function ErrorState({
  title = "Couldn't load this right now",
  description = "Please check your connection and try again. Nothing has been changed.",
  onRetry,
  compact = false,
}: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl bg-attention-soft/60 text-center", compact ? "px-4 py-5" : "px-6 py-10")}>
      <AlertCircle className="mb-2 h-5 w-5 text-attention" aria-hidden />
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}
