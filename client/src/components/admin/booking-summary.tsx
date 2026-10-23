/**
 * What a booking is, at a glance, for staff: the service the customer picked
 * (category › service × quantity), when and how urgently they want it, and the
 * price read off the booking's frozen price breakdown — the same numbers the
 * invoice uses — rather than a "Total Amount: Pending" that told staff nothing.
 */

import { Badge } from "@/components/ui/badge";

const money = (n: unknown) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const SLOT: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

function Row({ label, value, strong, muted, minus }: { label: string; value: unknown; strong?: boolean; muted?: boolean; minus?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "border-t border-[rgba(255,255,255,0.08)] mt-1 pt-2.5" : ""}`}>
      <span className={`text-sm ${muted ? "text-[hsl(215,20%,55%)]" : "text-[hsl(215,20%,75%)]"} ${strong ? "font-semibold text-white" : ""}`}>{label}</span>
      <span className={`font-mono tabular-nums ${strong ? "text-lg font-bold text-[hsl(160,84%,65%)]" : muted ? "text-sm text-[hsl(215,20%,60%)]" : "text-sm text-white"}`}>{minus ? "− " : ""}{money(value)}</span>
    </div>
  );
}

function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)] min-w-0 ${wide ? "col-span-2" : ""}`}>
      <p className="text-xs font-medium text-[hsl(215,20%,55%)] uppercase tracking-wider mb-1">{label}</p>
      <div className="text-base text-white break-words">{children}</div>
    </div>
  );
}

export default function BookingSummary({ service, statusBadge }: { service: any; statusBadge: React.ReactNode }) {
  const s: any = service.pricingSnapshot ?? {};
  const qty = Number(service.quantity ?? s.quantity ?? 1) || 1;
  const fixedPrice = s.snapshotVersion === 2 || s.basePrice != null;
  const billed = !fixedPrice && s.subtotal != null;
  const partsCost = Number(s.extraPartsCost ?? 0) + Number(s.platformPartsCost ?? 0);
  const total = s.grossTotal ?? service.totalAmount ?? (fixedPrice ? s.basePrice : null);
  const bookingFee = Number(s.bookingFee ?? service.bookingFee ?? 0);
  const shareLabel = s.payeeType === "partner" || service.partnerName ? `${service.partnerName ?? s.servicedBy ?? "Partner"}'s share` : "Technician's share";
  const typed = service.serviceType && service.serviceName && service.serviceType.trim().toLowerCase() !== String(service.serviceName).trim().toLowerCase() ? service.serviceType : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Fact label="Service ID"><span className="text-lg font-semibold">{service.serviceId || service.id}</span></Fact>
        <Fact label="Status"><div className="mt-1 flex flex-wrap items-center gap-2">{statusBadge}{service.urgency === "urgent" && <Badge className="bg-red-100 text-red-700 border-0">Urgent</Badge>}</div></Fact>
      </div>

      <div className="border-t border-[rgba(255,255,255,0.06)] pt-6">
        <h4 className="font-medium text-white mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-[hsl(27,90%,60%)] rounded-full"></span> What they booked</h4>
        <div className="grid grid-cols-2 gap-4">
          <Fact label="Service" wide>
            {service.categoryName || service.serviceName ? (
              <>
                <p className="text-xs uppercase tracking-wider text-[hsl(217,91%,72%)]">
                  {[service.categoryName, service.subCategory].filter(Boolean).join(" › ") || "—"}
                </p>
                <p className="text-lg font-semibold">
                  {service.serviceName ?? service.serviceType ?? "General"}
                  {qty > 1 && <span className="ml-2 text-base font-normal text-[hsl(217,91%,72%)]">× {qty}</span>}
                </p>
                {typed && <p className="text-sm text-[hsl(215,20%,60%)] mt-1">Customer typed: “{typed}”</p>}
              </>
            ) : (
              <>
                <p className="text-lg font-semibold">{service.serviceType || "General"}{qty > 1 && <span className="ml-2 text-base font-normal text-[hsl(217,91%,72%)]">× {qty}</span>}</p>
                <p className="text-sm text-[hsl(38,92%,65%)] mt-1">Not booked from the catalogue (older app): the technician prices it on their bill after the visit.</p>
              </>
            )}
          </Fact>
          <Fact label="Wanted on">
            {service.preferredDate
              ? <>{new Date(`${service.preferredDate}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}{service.preferredTimeSlot ? ` · ${SLOT[service.preferredTimeSlot] ?? service.preferredTimeSlot}` : ""}</>
              : <span className="text-[hsl(215,20%,60%)]">No date given</span>}
          </Fact>
          <Fact label="Booked">{service.createdAt ? new Date(service.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</Fact>
          <Fact label="Who has it">
            {service.technicianName
              ? <>{service.technicianName}{service.partnerName && <span className="block text-sm text-[hsl(27,90%,65%)]">{service.partnerName}'s technician</span>}</>
              : service.partnerName
                ? <>{service.partnerName}<span className="block text-sm text-[hsl(215,20%,60%)]">{service.escalatedAt ? "did not assign in time — back in the queue" : "to assign a technician"}{service.slaAssignBy && !service.escalatedAt ? ` by ${new Date(service.slaAssignBy).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}</span></>
                : <span className="text-[hsl(215,20%,60%)]">Not assigned</span>}
          </Fact>
          <Fact label="Rest of the payment">
            {service.paymentMethod && service.paymentMethod !== "pending" ? <span className="capitalize">{String(service.paymentMethod).replace(/_/g, " ")}</span> : <span className="text-[hsl(215,20%,60%)]">Not collected yet</span>}
            <span className="block text-sm text-[hsl(215,20%,60%)]">Booking fee {service.bookingFeeStatus === "paid" ? "paid" : service.bookingFeeStatus ?? "—"}</span>
          </Fact>
        </div>
      </div>

      <div className="border-t border-[rgba(255,255,255,0.06)] pt-6">
        <h4 className="font-medium text-white mb-4 flex items-center gap-2"><span className="w-1.5 h-4 bg-[hsl(160,84%,60%)] rounded-full"></span> Price</h4>
        <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.04)]">
          {fixedPrice ? (
            <>
              {qty > 1 && s.unitPrice != null && <Row label={`${money(s.unitPrice)} × ${qty}`} value={Number(s.unitPrice) * qty} muted />}
              {Number(s.discountAmount ?? 0) > 0 && <>
                <Row label="List price" value={s.listPrice} />
                <Row label={`Discount${s.discountLabel ? ` (${s.discountLabel})` : ""}`} value={s.discountAmount} minus />
              </>}
              <Row label="Service price (GST included)" value={s.basePrice} />
              {partsCost > 0 && <Row label={`Parts${s.partsNote ? ` — ${s.partsNote}` : ""}`} value={partsCost} />}
              {Number(s.partsGst ?? 0) > 0 && <Row label="GST on parts" value={s.partsGst} />}
              <Row label="Total" value={total} strong />
              {s.prepaid
                ? <Row label="Paid in full at booking" value={s.prepaidAmount ?? total} muted />
                : <Row label={`Booking advance (${service.bookingFeeStatus === "paid" ? "paid" : "not paid yet"})`} value={bookingFee} muted />}
              {s.finalTotal != null && <Row label="Due after the service" value={s.finalTotal} muted />}
              <div className="mt-3 border-t border-[rgba(255,255,255,0.06)] pt-2">
                <p className="text-[11px] uppercase tracking-wider text-[hsl(215,20%,50%)] mb-1">Where the money goes</p>
                {s.gst != null && <Row label={`GST (${s.gstPercent ?? 18}%)`} value={s.gst} muted />}
                {s.platformFee != null && <Row label={`UniteFix fee (${s.platformFeePercent ?? "—"}%)`} value={s.platformFee} muted />}
                {s.technicianEarning != null && <Row label={shareLabel} value={s.technicianEarning} muted />}
                {s.platformSubsidised && <p className="text-xs text-[hsl(38,92%,65%)] mt-1">The discount is bigger than UniteFix's fee: UniteFix is paying towards this job.</p>}
              </div>
            </>
          ) : billed ? (
            <>
              {s.sparePartsCost != null && <Row label="Spare parts" value={s.sparePartsCost} />}
              {s.serviceLaborCost != null && <Row label="Labour" value={s.serviceLaborCost} />}
              {s.platformFee != null && <Row label={`UniteFix fee (${s.platformFeePercent ?? "—"}%)`} value={s.platformFee} />}
              {(s.cgst != null || s.sgst != null) && <Row label={`GST (${s.gstPercent ?? 18}%)`} value={Number(s.cgst ?? 0) + Number(s.sgst ?? 0)} />}
              <Row label="Total" value={total} strong />
              <Row label="Booking fee already paid" value={s.bookingFeeCredit ?? bookingFee} muted minus />
              {s.finalTotal != null && <Row label="Customer pays after the service" value={s.finalTotal} muted />}
              {s.employeeEarnings != null && <Row label={shareLabel} value={s.employeeEarnings} muted />}
            </>
          ) : (
            <>
              <Row label={`Booking fee (${service.bookingFeeStatus === "paid" ? "paid" : "not paid yet"})`} value={bookingFee} />
              <p className="text-sm text-[hsl(215,20%,60%)] mt-2">No price yet: the technician submits the bill after the visit, and the total appears here.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
