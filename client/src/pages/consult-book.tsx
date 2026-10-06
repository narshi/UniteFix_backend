/**
 * Public booking pages for a consulting partner — no login.
 *
 *   /book/<partner code>   pick a service and a free slot, leave a name and number
 *   /book/a/<token>        the client's own page: status, meeting link once
 *                          confirmed, notes from the consultant, cancel
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Svc = { id: number; name: string; description: string | null; kind: string; price: number; durationMinutes: number; mode: string; gstRate: number };
type Slot = { startsAt: string; endsAt: string; day: string; time: string };

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const when = (s: string) => new Date(s).toLocaleString("en-IN", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-0 noise-overlay px-4 py-10">
      <div className="mx-auto max-w-2xl">{children}<p className="mt-10 text-center text-xs text-[hsl(215,20%,50%)]">Bookings through UniteFix Partner Hub · times in IST</p></div>
    </div>
  );
}

export function ConsultBookingPage({ code }: { code: string }) {
  const profile = useQuery<{ name: string; city: string | null; services: Svc[] }>({ queryKey: ["/api/public/consult", code], queryFn: async () => (await apiRequest("GET", `/api/public/consult/${encodeURIComponent(code)}`)).data, retry: false });
  const [svc, setSvc] = useState<Svc | null>(null);
  const slots = useQuery<Slot[]>({ queryKey: ["/api/public/consult/slots", code, svc?.id], queryFn: async () => (await apiRequest("GET", `/api/public/consult/${encodeURIComponent(code)}/slots?serviceId=${svc!.id}`)).data, enabled: !!svc });
  const days = useMemo(() => Array.from(new Set((slots.data ?? []).map(s => s.day))), [slots.data]);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "", message: "", mode: "online" });
  const [done, setDone] = useState<string | null>(null);
  const book = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/public/consult/${encodeURIComponent(code)}/book`, { serviceId: svc!.id, startsAt: slot!.startsAt, name: f.name, phone: f.phone, email: f.email || null, message: f.message || null, mode: svc!.mode === "both" ? f.mode : undefined })) as any,
    onSuccess: (r: any) => setDone(r.data.link),
  });

  if (profile.isError) return <Shell><h1 className="text-2xl font-semibold text-white">This booking page is not available.</h1></Shell>;
  if (!profile.data) return <Shell><p className="text-[hsl(215,20%,65%)]">Loading…</p></Shell>;
  if (done) return (
    <Shell>
      <h1 className="text-2xl font-semibold text-white">Request sent</h1>
      <p className="mt-2 text-[hsl(215,20%,70%)]">{profile.data.name} will confirm your appointment for {when(slot!.startsAt)}. Keep this link — it shows the confirmation, the meeting link and any notes, and lets you cancel.</p>
      <a href={done} className="mt-4 inline-block break-all rounded-lg bg-[hsl(174,72%,38%)] px-5 py-2.5 font-medium text-white hover:bg-[hsl(174,72%,33%)]">{window.location.origin}{done}</a>
    </Shell>
  );
  const ready = svc && slot && f.name.trim().length >= 2 && f.phone.replace(/\D/g, "").length >= 10;
  return (
    <Shell>
      <p className="text-xs font-mono uppercase tracking-widest text-[hsl(174,72%,55%)]">Book a consultation</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">{profile.data.name}</h1>
      {profile.data.city && <p className="text-[hsl(215,20%,65%)]">{profile.data.city}</p>}

      <section className="mt-8 space-y-2" aria-labelledby="h-svc">
        <h2 id="h-svc" className="text-sm font-semibold text-white">1. Choose a service</h2>
        {!profile.data.services.length && <p className="text-sm text-[hsl(215,20%,65%)]">No services are open for online booking right now.</p>}
        {profile.data.services.map(s => (
          <button key={s.id} onClick={() => { setSvc(s); setDay(null); setSlot(null); }} aria-pressed={svc?.id === s.id}
            className={`w-full rounded-xl border p-4 text-left ${svc?.id === s.id ? "border-[hsl(174,72%,45%)] bg-[hsl(174,72%,45%)]/10" : "border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.25)]"}`}>
            <div className="flex justify-between gap-3"><span className="font-medium text-white">{s.name}</span><span className="tabular-nums text-white">{rs(s.price)}{s.kind === "hourly" ? "/hr" : ""}{s.gstRate ? <span className="text-xs text-[hsl(215,20%,60%)]"> + GST</span> : null}</span></div>
            <p className="mt-1 text-sm text-[hsl(215,20%,65%)]">{s.durationMinutes} min · {s.mode === "both" ? "online or in person" : s.mode === "online" ? "online" : "in person"}{s.description ? ` · ${s.description}` : ""}</p>
          </button>
        ))}
      </section>

      {svc && (
        <section className="mt-8 space-y-3" aria-labelledby="h-time">
          <h2 id="h-time" className="text-sm font-semibold text-white">2. Pick a time</h2>
          {slots.isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading free times…</p> : !days.length ? <p className="text-sm text-[hsl(215,20%,65%)]">No free times in the next three weeks.</p> : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">{days.map(d => (
                <button key={d} onClick={() => { setDay(d); setSlot(null); }} aria-pressed={day === d} className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${day === d ? "border-[hsl(174,72%,45%)] text-white" : "border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,70%)]"}`}>{dayLabel(d)}</button>
              ))}</div>
              {day && <div className="flex flex-wrap gap-2">{(slots.data ?? []).filter(s => s.day === day).map(s => (
                <button key={s.startsAt} onClick={() => setSlot(s)} aria-pressed={slot?.startsAt === s.startsAt} className={`rounded-md border px-3 py-1.5 text-sm tabular-nums ${slot?.startsAt === s.startsAt ? "border-[hsl(174,72%,45%)] bg-[hsl(174,72%,45%)]/15 text-white" : "border-[rgba(255,255,255,0.1)] text-[hsl(215,20%,75%)]"}`}>{s.time}</button>
              ))}</div>}
            </>
          )}
        </section>
      )}

      {slot && (
        <section className="mt-8 space-y-3" aria-labelledby="h-you">
          <h2 id="h-you" className="text-sm font-semibold text-white">3. Your details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="b-name">Name</Label><Input id="b-name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div><Label htmlFor="b-phone">Mobile</Label><Input id="b-phone" inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label htmlFor="b-email">Email (optional)</Label><Input id="b-email" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
            {svc?.mode === "both" && <div className="sm:col-span-2"><Label htmlFor="b-mode">How would you like to meet?</Label>
              <select id="b-mode" className="mt-1 h-9 w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[hsl(222,47%,11%)] px-2 text-white" value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}><option value="online">Online</option><option value="onsite">In person</option></select></div>}
            <div className="sm:col-span-2"><Label htmlFor="b-msg">What is it about? (optional)</Label><Textarea id="b-msg" rows={3} value={f.message} onChange={e => setF({ ...f, message: e.target.value })} /></div>
          </div>
          {book.isError && <p role="alert" className="text-sm text-rose-300">{apiErrorMessage(book.error)}</p>}
          <Button disabled={!ready || book.isPending} onClick={() => book.mutate()}>{book.isPending ? "Sending…" : `Request ${when(slot.startsAt)}`}</Button>
        </section>
      )}
    </Shell>
  );
}

export function ConsultAppointmentPage({ token }: { token: string }) {
  const q = useQuery<{ service: string; consultant: string; consultantPhone: string | null; startsAt: string; endsAt: string; mode: string; status: string; location: string | null; meetingLink: string | null; notes: string | null; price: number }>({
    queryKey: ["/api/public/consult/a", token], queryFn: async () => (await apiRequest("GET", `/api/public/consult/a/${encodeURIComponent(token)}`)).data, retry: false,
  });
  const cancel = useMutation({ mutationFn: async () => apiRequest("POST", `/api/public/consult/a/${encodeURIComponent(token)}/cancel`), onSuccess: () => q.refetch() });
  if (q.isError) return <Shell><h1 className="text-2xl font-semibold text-white">Booking not found.</h1></Shell>;
  if (!q.data) return <Shell><p className="text-[hsl(215,20%,65%)]">Loading…</p></Shell>;
  const a = q.data;
  const STATUS: Record<string, string> = { requested: "Waiting for confirmation", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", no_show: "Missed" };
  return (
    <Shell>
      <p className="text-xs font-mono uppercase tracking-widest text-[hsl(174,72%,55%)]">{STATUS[a.status] ?? a.status}</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">{a.service}</h1>
      <p className="mt-1 text-[hsl(215,20%,70%)]">with {a.consultant} · {when(a.startsAt)} · {a.mode === "online" ? "online" : "in person"}</p>
      {a.meetingLink && <a href={a.meetingLink} target="_blank" rel="noreferrer" className="mt-6 inline-block rounded-lg bg-[hsl(174,72%,38%)] px-5 py-2.5 font-medium text-white hover:bg-[hsl(174,72%,33%)]">Join the meeting</a>}
      {a.location && <p className="mt-4 text-white">Where: {a.location}</p>}
      {a.notes && <div className="mt-6 rounded-xl border border-[rgba(255,255,255,0.1)] p-4"><p className="text-xs uppercase tracking-wider text-[hsl(215,20%,55%)]">Notes from {a.consultant}</p><p className="mt-2 whitespace-pre-wrap text-white">{a.notes}</p></div>}
      {a.consultantPhone && <p className="mt-6 text-sm text-[hsl(215,20%,65%)]">Questions? Call {a.consultantPhone}.</p>}
      {["requested", "confirmed"].includes(a.status) && (
        <div className="mt-8">
          {cancel.isError && <p role="alert" className="mb-2 text-sm text-rose-300">{apiErrorMessage(cancel.error)}</p>}
          <Button variant="outline" onClick={() => { if (window.confirm("Cancel this appointment?")) cancel.mutate(); }}>Cancel appointment</Button>
        </div>
      )}
    </Shell>
  );
}

/** Route by path: /book/a/<token> or /book/<code>. */
export default function ConsultBookRouter() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[1] === "a" && parts[2]) return <ConsultAppointmentPage token={parts[2]} />;
  return <ConsultBookingPage code={parts[1] ?? ""} />;
}
