import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, LockKeyhole, MessageSquareDot, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { isAuthenticated, login } from "@/lib/transco/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — Transco Conversation Console" },
      {
        name: "description",
        content:
          "Staff sign-in for Transco, the WhatsApp customer conversation console for support teams.",
      },
      { property: "og:title", content: "Sign in — Transco Conversation Console" },
      {
        property: "og:description",
        content: "Staff sign-in for Transco, the WhatsApp customer conversation console.",
      },
    ],
  }),
  component: LoginPage,
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated()) void navigate({ to: "/console" });
  }, [navigate]);

  const emailError = touched.email && !emailPattern.test(email) ? "Enter a valid email" : null;
  const passwordError =
    touched.password && password.length < 6 ? "Password must be at least 6 characters" : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!emailPattern.test(email) || password.length < 6) return;
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      await navigate({ to: "/console" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <MessageSquareDot className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Transco</h1>
            <p className="text-xs text-muted-foreground">Customer conversation console</p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          className="mt-6 rounded-xl border border-border bg-panel p-5 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-foreground">Staff sign in</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Use your Transco support account to open the console.
          </p>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <label className="mt-4 block text-xs font-medium text-foreground" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            placeholder="agent@transco.lk"
            aria-invalid={Boolean(emailError)}
            className={cn(
              "mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring",
              emailError ? "border-destructive" : "border-input",
            )}
          />
          {emailError && <p className="mt-1 text-[11px] text-destructive">{emailError}</p>}

          <label className="mt-4 block text-xs font-medium text-foreground" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            placeholder="••••••••"
            aria-invalid={Boolean(passwordError)}
            className={cn(
              "mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring",
              passwordError ? "border-destructive" : "border-input",
            )}
          />
          {passwordError && <p className="mt-1 text-[11px] text-destructive">{passwordError}</p>}

          <button
            type="submit"
            disabled={loading}
            className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <p className="mt-4 text-[11px] text-muted-foreground">
            Demo sign-in: any valid email with a 6+ character password.
          </p>
        </form>
      </div>
    </div>
  );
}
