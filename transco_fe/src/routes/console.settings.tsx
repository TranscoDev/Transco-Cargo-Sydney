import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Moon, Plus, Settings as SettingsIcon, Sun, Trash2, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser } from "@/lib/transco/auth";
import { changePassword, createStaff, deleteStaff, fetchStaff } from "@/lib/transco/api";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/transco/theme";
import type { StaffAccount } from "@/lib/transco/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/console/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const me = getCurrentUser();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-chat-canvas p-4 md:p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <SettingsIcon className="h-4 w-4 text-muted-foreground" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">Appearance and staff account management.</p>
      </div>

      <div className="flex max-w-2xl flex-col gap-6">
        <AppearanceCard />
        <YourAccountCard email={me?.email ?? null} name={me?.name ?? null} />
        <StaffAccountsCard currentUserId={me?.id ?? null} />
      </div>
    </div>
  );
}

function AppearanceCard() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const choose = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Appearance</CardTitle>
      </CardHeader>
      <CardContent className="flex gap-2 p-4 pt-0">
        <button
          type="button"
          onClick={() => choose("light")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
            theme === "light"
              ? "border-primary bg-primary/10 text-primary"
              : "border-input text-muted-foreground hover:bg-secondary/60",
          )}
        >
          <Sun className="h-4 w-4" />
          Light
        </button>
        <button
          type="button"
          onClick={() => choose("dark")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
            theme === "dark"
              ? "border-primary bg-primary/10 text-primary"
              : "border-input text-muted-foreground hover:bg-secondary/60",
          )}
        >
          <Moon className="h-4 w-4" />
          Dark
        </button>
      </CardContent>
    </Card>
  );
}

function YourAccountCard({ email, name }: { email: string | null; name: string | null }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Your Account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-4 pt-0">
        <div className="flex items-center gap-2 text-sm">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">{name || "—"}</span>
          <span className="text-muted-foreground">{email}</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Change Password
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password">Current Password</Label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Password updated.</p>
          )}
          <Button type="submit" size="sm" disabled={saving} className="self-start">
            {saving ? "Saving…" : "Update Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StaffAccountsCard({ currentUserId }: { currentUserId: string | null }) {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const load = () => {
    setLoading(true);
    fetchStaff()
      .then((data) => {
        setStaff(data);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load staff accounts"),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (id: string, label: string) => {
    if (
      !window.confirm(`Remove ${label}'s staff account? They will no longer be able to sign in.`)
    ) {
      return;
    }
    try {
      await deleteStaff(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove staff account");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="text-sm">Staff Accounts</CardTitle>
        <AddStaffDialog open={addOpen} onOpenChange={setAddOpen} onCreated={load} />
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {staff.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    {s.name}
                    {s.id === currentUserId && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.email}</p>
                </div>
                {s.id !== currentUserId && (
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id, s.name)}
                    aria-label={`Remove ${s.name}`}
                    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setName("");
    setPassword("");
    setError(null);
  };

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      await createStaff({ email, name, password });
      reset();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create staff account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Staff
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Staff Account</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-name">Name</Label>
            <Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-email">Email</Label>
            <Input
              id="staff-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-password">Password</Label>
            <Input
              id="staff-password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={saving || !email || !name || !password}
          >
            {saving ? "Creating…" : "Create Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
