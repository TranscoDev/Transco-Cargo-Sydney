import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PenLine, Printer, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchDeclaration,
  printDeclaration,
  type DeclarationPerson,
  type DeclarationPrintData,
} from "@/lib/transco/declaration-print";
import { formatDate } from "@/lib/transco/my-transco";
import { BookingDetailsEditor } from "@/components/transco/booking-details-editor";

/**
 * Everything staff need about one booking in one place — customer,
 * sender, receiver and boxes, as filled in the online declaration — with
 * Print at the top. Opened by clicking a booking on the Bookings page.
 * Loads from the same staff endpoint the printout uses, so what's on
 * screen is exactly what prints.
 */
export function BookingDetailsSheet({
  bookingId,
  open,
  onOpenChange,
}: {
  bookingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<DeclarationPrintData | null>(null);
  const [error, setError] = useState("");
  const [printError, setPrintError] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    setError("");
    fetchDeclaration(bookingId)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load the booking"));
  }, [bookingId]);

  // Fresh every time it opens — staff may have just changed something.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const print = () => {
    setPrintError("");
    printDeclaration(bookingId).catch((err: unknown) =>
      setPrintError(err instanceof Error ? err.message : "Could not open the declaration"),
    );
  };

  const d = data && data.bookingId === bookingId ? data : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-6">
          <SheetTitle className="tabular-nums">{d?.bookingCode ?? "Booking"}</SheetTitle>
          <SheetDescription>
            {d ? [d.customer.name ?? "No name", d.itemsText].filter(Boolean).join(" · ") : "Loading booking details…"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-2 flex flex-col gap-5 text-sm">
          <div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" onClick={print} disabled={!d}>
                <Printer className="mr-2 h-4 w-4" />
                Print declaration
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={!d}>
                <PenLine className="mr-2 h-4 w-4" />
                Change details
              </Button>
            </div>
            {printError && <p className="mt-2 text-xs font-medium text-attention-foreground">{printError}</p>}
          </div>

          {error ? (
            <div className="rounded-lg bg-attention-soft p-3 text-sm">
              <p className="font-medium text-attention-foreground">{error}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2 h-7" onClick={load}>
                Try again
              </Button>
            </div>
          ) : !d ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <>
              <Section title="Customer">
                <Rows
                  rows={[
                    ["Name", d.customer.name],
                    ["Customer no.", d.customer.customerCode],
                    ["Phone", d.customer.phoneNumber ? `+${d.customer.phoneNumber}` : null],
                  ]}
                />
                {d.customer.id && (
                  <CustomerLink customerId={d.customer.id} myTransco={d.channel === "portal"} />
                )}
              </Section>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-foreground">Declaration</span>
                {d.declarationSubmittedAt ? (
                  <Badge variant="secondary" className="text-xs">Filled online</Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Not filled online — fill in on the printout</Badge>
                )}
                {d.declarationStatus === "received" && <Badge className="text-xs">Checked</Badge>}
              </div>

              <PersonSection
                title={d.sender && !d.senderIsAccountHolder ? "Sender (someone else)" : "Sender"}
                person={d.sender}
              />
              <PersonSection title="Receiver" person={d.receiver} withId />

              <Section title="Shipment">
                <Rows
                  rows={[
                    ["Boxes", d.items.length ? d.items.map((i) => `${i.qty} × ${i.label}`).join(", ") : d.itemsText],
                    ["Service", d.service],
                    ["Destination", [d.destination, d.country].filter(Boolean).join(", ")],
                    ["Delivery", d.delivery],
                    ["Drop-off", d.dropOff ? [d.dropOff.date ? formatDate(d.dropOff.date) : null, d.dropOff.time].filter(Boolean).join(" · ") : null],
                    ["BL number", d.blNumber],
                    ["Customer note", d.notes],
                  ]}
                />
              </Section>
            </>
          )}
        </div>
      </SheetContent>
      <BookingDetailsEditor bookingId={bookingId} open={editing} onOpenChange={setEditing} onSaved={load} />
    </Sheet>
  );
}

function CustomerLink({ customerId, myTransco }: { customerId: string; myTransco: boolean }) {
  const className = "mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline";
  return myTransco ? (
    <Link to="/console/my-transco/$customerId" params={{ customerId }} className={className}>
      <UserRound className="h-3.5 w-3.5" /> Open customer profile →
    </Link>
  ) : (
    <Link to="/console/customers/$customerId" params={{ customerId }} className={className}>
      <UserRound className="h-3.5 w-3.5" /> Open customer profile →
    </Link>
  );
}

function PersonSection({ title, person, withId = false }: { title: string; person: DeclarationPerson | null; withId?: boolean }) {
  return (
    <Section title={title}>
      {person ? (
        <Rows
          rows={[
            ["Full name", person.fullName],
            ["Address", [person.address, person.town].filter(Boolean).join(", ")],
            ["Mobile", person.mobile],
            ["Email", person.email],
            ...(withId ? ([["Passport / NIC", person.idNumber ?? null]] as [string, string | null][]) : []),
          ]}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Not given online — the customer fills this in on the printed form.</p>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-panel p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words font-medium text-foreground">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
