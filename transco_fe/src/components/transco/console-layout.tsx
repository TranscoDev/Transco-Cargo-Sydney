import { CalendarClock, LogOut, MessageSquareDot, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/transco/theme";

export type ConsoleTab = "conversations" | "bookings";

export function ConsoleLayout({
  agentName,
  onLogout,
  activeTab,
  onTabChange,
  children,
}: {
  agentName: string;
  onLogout: () => void;
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background">
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-panel px-3 py-2 md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <MessageSquareDot className="h-4 w-4" />
            </span>
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              Transco
            </span>
          </span>

          <nav className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onTabChange("conversations")}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                activeTab === "conversations"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              Conversations
            </button>
            <button
              type="button"
              onClick={() => onTabChange("bookings")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                activeTab === "bookings"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Bookings
            </button>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden max-w-40 truncate text-xs capitalize text-muted-foreground sm:inline">
            {agentName}
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-foreground transition-colors hover:bg-secondary"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}