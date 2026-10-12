import { useState } from "react";
import QRCode from "qrcode";
import { Copy, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { API_BASE_URL } from "@/lib/transco/config";
import { getAuthToken } from "@/lib/transco/auth";
import { friendlyError, notify } from "@/lib/transco/notify";

/**
 * "Invite to My Transco" — a personal link (24 hours, single use) for this
 * booking's customer. It opens sign-up with their number already
 * confirmed, or signs them straight in if they already have an account.
 * Staff show the QR at the counter, copy the link, or send it on WhatsApp.
 * The QR is drawn here in the browser — the link never goes to an outside service.
 */
export function InviteCard({ bookingId, phoneNumber }: { bookingId: string; phoneNumber: string | null }) {
  const [invite, setInvite] = useState<{ link: string; expiresAt: string; hasAccount: boolean; qr: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE_URL}/api/my-transco/bookings/${bookingId}/invite`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Couldn't create the link (${res.status})`);
      const qr = await QRCode.toDataURL(data.link, { width: 220, margin: 1 });
      setInvite({ ...data, qr });
    } catch (err) {
      notify.error(friendlyError(err, "Couldn't create the invite link."));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.link);
      notify.success("Link copied");
    } catch {
      notify.error("Couldn't copy — press and hold the link to copy it.");
    }
  };

  const waText = invite
    ? encodeURIComponent(`Hi! Here's your personal link to My Transco — track your boxes and book faster next time: ${invite.link}`)
    : "";
  const waHref = phoneNumber ? `https://wa.me/${phoneNumber.replace(/\D/g, "")}?text=${waText}` : `https://wa.me/?text=${waText}`;

  return (
    <div className="mt-3 rounded-lg border border-dashed p-3">
      <p className="text-sm font-semibold text-foreground">Invite to My Transco</p>
      {!invite ? (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A one-time link (24 hours) that opens sign-up with their number already confirmed — or signs them in if they have an account.
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => void create()} disabled={busy}>
            <Link2 className="h-4 w-4" /> {busy ? "Creating…" : "Create invite link"}
          </Button>
        </>
      ) : (
        <div className="mt-2 flex flex-col items-center gap-2 text-center">
          <img src={invite.qr} alt="Invite QR code" className="h-44 w-44 rounded border bg-white p-1" />
          <p className="text-xs text-muted-foreground">
            {invite.hasAccount ? "They already have an account — scanning signs them in." : "Let them scan this with their phone camera."}{" "}
            Works until {new Date(invite.expiresAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}, once.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" className="gap-1.5" onClick={() => void copy()}>
              <Copy className="h-4 w-4" /> Copy link
            </Button>
            <Button asChild type="button" size="sm" className="gap-1.5 bg-[#25d366] text-white hover:bg-[#1fb956]">
              <a href={waHref} target="_blank" rel="noopener noreferrer">WhatsApp it</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
