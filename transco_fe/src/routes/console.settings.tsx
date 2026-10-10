import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Moon, Palette, Plus, Settings as SettingsIcon, Sun, Trash2, User, Users } from "lucide-react";
import { PageHeader, PageShell } from "@/components/transco/page-kit";

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

// Everyone opens Settings for their own password and theme; the staff
// list needs the Settings page in their access.
const hasPage = (page: string) => { const pages = getCurrentUser()?.pages; return !pages || pages.includes(page); };
import { changePassword, createStaff, deleteStaff, fetchStaffWithAccess, updateStaffAccess } from "@/lib/transco/api";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/transco/theme";
import type { StaffAccess, StaffAccount } from "@/lib/transco/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/console/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const me = getCurrentUser();
  const name = me?.name || me?.email || "Staff";

  return (
    <PageShell>
      <PageHeader icon={SettingsIcon} title="Settings" description="Your account, how the console looks, and the team who can sign in." />

      {/* Who's signed in — a friendly welcome strip. */}
      <div className="mb-6 flex items-center gap-4 rounded-xl border bg-linear-to-r from-primary/10 via-card to-card p-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
          {initials(name)}
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">Hi, {name.split(/\s+/)[0]} 👋</p>
          <p className="truncate text-sm text-muted-foreground">Signed in as {me?.email ?? "—"}</p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <YourAccountCard email={me?.email ?? null} name={me?.name ?? null} />
        </div>
        <div className="flex flex-col gap-6">
          <AppearanceCard />
          {hasPage("settings") && <StaffAccountsCard currentUserId={me?.id ?? null} />}
        </div>
      </div>
    </PageShell>
  );
}

function initials(text: string) {
  return text.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

/** A settings section: coloured icon, title, one-line explanation, optional action. */
function SettingsCard({
  icon: Icon,
  tone,
  title,
  description,
  action,
  children,
}: {
  icon: typeof SettingsIcon;
  tone: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-5 pb-3">
        <div className="flex items-start gap-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tone)}>
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-5 pt-2">{children}</CardContent>
    </Card>
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
    <SettingsCard icon={Palette} tone="bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Appearance" description="Light or dark — whichever is easier on your eyes.">
      <div className="flex gap-2">
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
      </div>
    </SettingsCard>
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
    <SettingsCard icon={KeyRound} tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" title="Your account" description="Change the password you sign in with.">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{name || "—"}</span>
          <span className="truncate text-muted-foreground">{email}</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
            <p className="text-xs text-success-foreground">Password updated.</p>
          )}
          <Button type="submit" disabled={saving} className="self-start">
            {saving ? "Saving…" : "Update password"}
          </Button>
        </form>
      </div>
    </SettingsCard>
  );
}

type PageOption = { key: string; label: string };

const ROLE_LABEL: Record<string, string> = { admin: "Admin", warehouse: "Warehouse", custom: "Custom" };

/** Admin / Warehouse / Custom (+ which pages). Shared by Add and Change access. */
function AccessPicker({
  value,
  onChange,
  pageOptions,
  warehousePages,
}: {
  value: StaffAccess;
  onChange: (v: StaffAccess) => void;
  pageOptions: PageOption[];
  warehousePages: string[];
}) {
  const label = (k: string) => pageOptions.find((p) => p.key === k)?.label ?? k;
  const roles: { key: StaffAccess["role"]; title: string; desc: string }[] = [
    { key: "warehouse", title: "Warehouse", desc: warehousePages.map(label).join(", ") },
    { key: "custom", title: "Custom", desc: "Choose the pages" },
    { key: "admin", title: "Admin", desc: "Every page, and can manage staff" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <Label>Access</Label>
      {roles.map((r) => (
        <label
          key={r.key}
          className={cn(
            "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm",
            value.role === r.key ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <input
            type="radio"
            name="staff-role"
            className="mt-0.5"
            checked={value.role === r.key}
            onChange={() => onChange({ role: r.key, pages: r.key === "custom" ? value.pages : [] })}
          />
          <span>
            <span className="font-medium text-foreground">{r.title}</span>
            <span className="block text-xs text-muted-foreground">{r.desc}</span>
          </span>
        </label>
      ))}
      {value.role === "custom" && (
        <div className="grid grid-cols-2 gap-1.5 rounded-md bg-secondary/40 p-2.5">
          {pageOptions.map((p) => (
            <label key={p.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.pages.includes(p.key)}
                onChange={(e) =>
                  onChange({ role: "custom", pages: e.target.checked ? [...value.pages, p.key] : value.pages.filter((x) => x !== p.key) })
                }
              />
              {p.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeAccessDialog({
  member,
  pageOptions,
  warehousePages,
  onSaved,
}: {
  member: StaffAccount;
  pageOptions: PageOption[];
  warehousePages: string[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const initial = (): StaffAccess => ({
    role: member.role === "warehouse" || member.role === "custom" ? member.role : "admin",
    pages: member.pages ?? [],
  });
  const [access, setAccess] = useState<StaffAccess>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateStaffAccess(member.id, access);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change access");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setAccess(initial());
          setError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8">
          Access
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{member.name} — access</DialogTitle>
        </DialogHeader>
        <AccessPicker value={access} onChange={setAccess} pageOptions={pageOptions} warehousePages={warehousePages} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" onClick={save} disabled={saving || (access.role === "custom" && !access.pages.length)}>
            {saving ? "Saving…" : "Save access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StaffAccountsCard({ currentUserId }: { currentUserId: string | null }) {
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Only the Transco admin adds or removes staff; everyone else sees the list.
  const [canManage, setCanManage] = useState(false);
  const [pageOptions, setPageOptions] = useState<PageOption[]>([]);
  const [warehousePages, setWarehousePages] = useState<string[]>([]);

  const load = () => {
    setLoading(true);
    fetchStaffWithAccess()
      .then((data) => {
        setStaff(data.staff);
        setCanManage(data.canManage);
        setPageOptions(data.pageOptions);
        setWarehousePages(data.warehousePages);
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
    <SettingsCard
      icon={Users}
      tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
      title="Staff accounts"
      description={`${staff.length || ""} ${staff.length === 1 ? "person" : "people"} can sign in to the console.`.trim()}
      action={
        canManage ? (
          <AddStaffDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onCreated={load}
            pageOptions={pageOptions}
            warehousePages={warehousePages}
          />
        ) : undefined
      }
    >
        {!loading && !canManage && (
          <p className="mb-3 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">🔒 Only the Transco admin can add or remove staff members.</p>
        )}
        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {staff.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                  {initials(s.name || s.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {s.name}
                    {s.id === currentUserId && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.email}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground">
                      {s.role ? ROLE_LABEL[s.role] ?? s.role : "All pages"}
                    </span>
                    {s.role === "custom" && s.pages?.length ? (
                      <span className="ml-1.5">{s.pages.map((k) => pageOptions.find((p) => p.key === k)?.label ?? k).join(", ")}</span>
                    ) : null}
                  </p>
                </div>
                {canManage && s.id !== currentUserId && (
                  <ChangeAccessDialog member={s} pageOptions={pageOptions} warehousePages={warehousePages} onSaved={load} />
                )}
                {canManage && s.id !== currentUserId && (
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
    </SettingsCard>
  );
}

function AddStaffDialog({
  open,
  onOpenChange,
  onCreated,
  pageOptions,
  warehousePages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  pageOptions: PageOption[];
  warehousePages: string[];
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [access, setAccess] = useState<StaffAccess>({ role: "warehouse", pages: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setName("");
    setPassword("");
    setAccess({ role: "warehouse", pages: [] });
    setError(null);
  };

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      await createStaff({ email, name, password, role: access.role, pages: access.pages });
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
          <AccessPicker value={access} onChange={setAccess} pageOptions={pageOptions} warehousePages={warehousePages} />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={saving || !email || !name || !password || (access.role === "custom" && !access.pages.length)}
          >
            {saving ? "Creating…" : "Create Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
