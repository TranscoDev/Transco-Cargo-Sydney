import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Mail, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingRows, PageHeader, PageShell, StatusBadge } from "@/components/transco/page-kit";
import { ComposeEmailDialog, EmailView, fmtSentAt } from "@/components/transco/email-kit";
import {
  accountLabel,
  disconnectGmail,
  EmailError,
  fetchEmailAccounts,
  fetchEmails,
  gmailConnectUrl,
  type EmailAccounts,
  type SentEmail,
} from "@/lib/transco/emails";

export const Route = createFileRoute("/console/emails")({
  component: EmailsPage,
});

const GMAIL_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Gmail connected ✓" },
  cancelled: { ok: false, text: "Gmail wasn't connected (cancelled)." },
  expired: { ok: false, text: "That took too long — press Connect Gmail again." },
  no_send: { ok: false, text: "Gmail wasn't connected: tick “Send email on your behalf” on Google's screen." },
  no_refresh: { ok: false, text: "Google didn't give lasting access. Press Connect Gmail again." },
  failed: { ok: false, text: "Gmail couldn't be connected. Please try again." },
};

function EmailsPage() {
  const [emails, setEmails] = useState<SentEmail[] | null>(null);
  const [accounts, setAccounts] = useState<EmailAccounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [account, setAccount] = useState("");
  const [person, setPerson] = useState("");
  const [open, setOpen] = useState<SentEmail | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    fetchEmails()
      .then((d) => {
        setEmails(d.emails);
        setError(null);
      })
      .catch((err) => setError(err instanceof EmailError ? err.message : "Couldn't load the emails."));
    fetchEmailAccounts()
      .then(setAccounts)
      .catch(() => setAccounts(null));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("transco:emails-changed", load);
    return () => window.removeEventListener("transco:emails-changed", load);
  }, [load]);

  // Back from Google's "Connect Gmail" screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("gmail");
    if (!result) return;
    const r = GMAIL_RESULT[result] ?? GMAIL_RESULT["failed"]!;
    if (r.ok) toast.success(r.text);
    else toast.error(r.text);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of emails ?? []) map.set(e.sentById, e.sentByName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [emails]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (emails ?? [])
      .filter((e) => !account || e.account === account)
      .filter((e) => !person || e.sentById === person)
      .filter((e) => !needle || [e.subject, e.to, e.customerName ?? "", e.body].some((s) => s.toLowerCase().includes(needle)));
  }, [emails, q, account, person]);

  const connectGmail = async () => {
    try {
      const { url } = await gmailConnectUrl();
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof EmailError ? err.message : "Couldn't start the Gmail connection.");
    }
  };

  const removeGmail = async () => {
    if (!window.confirm("Disconnect Gmail? Nobody will be able to send from it until it's connected again.")) return;
    try {
      await disconnectGmail();
      toast.success("Gmail disconnected");
      load();
    } catch (err) {
      toast.error(err instanceof EmailError ? err.message : "Couldn't disconnect.");
    }
  };

  const selectClass = "rounded-lg border bg-card px-2.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const showGmail = accounts && (accounts.isAdmin || accounts.gmail.usable);

  return (
    <PageShell>
      <PageHeader
        icon={Mail}
        title="Emails"
        description="Every email sent to customers from the console."
        actions={
          <Button type="button" onClick={() => setComposing(true)}>
            <Mail className="mr-1 h-4 w-4" aria-hidden /> New email
          </Button>
        }
      />

      {accounts && (
        <section className="mb-5 rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email accounts</h2>
          <ul className="flex flex-col gap-3 text-sm">
            <li className="flex flex-wrap items-center gap-2">
              <span className="w-16 font-semibold text-foreground">Outlook</span>
              <span className="text-muted-foreground">{accounts.outlook.address}</span>
              {accounts.outlook.connected ? (
                <StatusBadge tone="success" dot>
                  Connected
                </StatusBadge>
              ) : (
                <StatusBadge tone="pending">Waiting for the Microsoft 365 admin</StatusBadge>
              )}
              {accounts.outlook.secretExpires && <span className="text-xs text-muted-foreground">Key expires {accounts.outlook.secretExpires}</span>}
            </li>
            {showGmail && (
              <li className="flex flex-wrap items-center gap-2">
                <span className="w-16 font-semibold text-foreground">Gmail</span>
                <span className="text-muted-foreground">{accounts.gmail.address ?? "Not connected"}</span>
                {accounts.gmail.connected ? (
                  <StatusBadge tone="success" dot>
                    Connected
                  </StatusBadge>
                ) : accounts.gmail.broken ? (
                  <StatusBadge tone="attention">Needs connecting again</StatusBadge>
                ) : (
                  <StatusBadge tone="pending">Not connected</StatusBadge>
                )}
                <span className="text-xs text-muted-foreground">{accounts.gmail.adminOnly ? "Admin only" : "Everyone, until Outlook is connected"}</span>
                {accounts.isAdmin && (
                  <span className="ml-auto flex gap-2">
                    {accounts.gmail.configured ? (
                      <Button type="button" size="sm" variant={accounts.gmail.connected ? "outline" : "default"} onClick={() => void connectGmail()}>
                        {accounts.gmail.connected ? "Reconnect" : "Connect Gmail"}
                      </Button>
                    ) : (
                      <span className="text-xs text-attention-foreground">Google sign-in isn't set up on the server yet.</span>
                    )}
                    {(accounts.gmail.connected || accounts.gmail.broken) && (
                      <Button type="button" size="sm" variant="outline" onClick={() => void removeGmail()}>
                        Disconnect
                      </Button>
                    )}
                  </span>
                )}
              </li>
            )}
          </ul>
        </section>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="em-search" className="sr-only">
          Search
        </label>
        <input
          id="em-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search subject, customer, email…"
          className="min-w-[14rem] flex-1 rounded-lg border bg-card px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <label htmlFor="em-account" className="sr-only">
          Account
        </label>
        <select id="em-account" value={account} onChange={(e) => setAccount(e.target.value)} className={selectClass}>
          <option value="">All accounts</option>
          <option value="outlook">Outlook</option>
          {showGmail && <option value="gmail">Gmail</option>}
        </select>
        <label htmlFor="em-person" className="sr-only">
          Sent by
        </label>
        <select id="em-person" value={person} onChange={(e) => setPerson(e.target.value)} className={selectClass}>
          <option value="">Everyone</option>
          {people.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <ErrorState title={error} onRetry={load} />
      ) : !emails ? (
        <LoadingRows rows={4} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState
            compact
            icon={Mail}
            title={emails.length ? "No emails match" : "No emails sent yet"}
            description={emails.length ? "Try another search or filter." : "Use “✉ Email” on a customer, booking or chat — or New email above."}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-semibold">Sent</th>
                <th className="px-3 py-2.5 font-semibold">From</th>
                <th className="px-3 py-2.5 font-semibold">To</th>
                <th className="px-3 py-2.5 font-semibold">Subject</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} onClick={() => setOpen(e)} className="cursor-pointer border-b last:border-0 hover:bg-secondary/40">
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{fmtSentAt(e.sentAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                    {accountLabel(e.account)} · {e.sentByName.split(/\s+/)[0]}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="block font-medium text-foreground">{e.customerName || "(not a customer)"}</span>
                    <span className="block text-xs text-muted-foreground">{e.to}</span>
                  </td>
                  <td className="px-3 py-2.5 text-foreground">
                    <button type="button" className="text-left hover:underline">
                      {e.subject}
                    </button>
                    {e.aiDrafted && <Sparkles className="ml-1 inline h-3.5 w-3.5 text-muted-foreground" aria-label="AI draft" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EmailView email={open} onClose={() => setOpen(null)} />
      <ComposeEmailDialog open={composing} onClose={() => setComposing(false)} />
    </PageShell>
  );
}
