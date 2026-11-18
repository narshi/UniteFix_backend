/**
 * A red bar across every admin page while a critical safety case (SOS, or a
 * critical report) is waiting for someone to pick it up, with a short beep
 * when a new one arrives. Only for staff who can open the Safety desk.
 */

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAdminMe } from "@/lib/admin-auth";

type Alarm = { critical: Array<{ id: number; code: string; kind: string; createdAt: string }>; open: number };

function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.3);
    });
  } catch { /* the browser blocked sound until the page is clicked: the bar still shows */ }
}

export default function SafetyAlarm() {
  const { can } = useAdminMe();
  const allowed = can("safety:view");
  const [location] = useLocation();
  const seen = useRef<Set<number>>(new Set());
  const { data } = useQuery<Alarm>({
    queryKey: ["/api/admin/safety/alarm"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/safety/alarm")).data,
    enabled: allowed, refetchInterval: 15_000,
  });
  const critical = data?.critical ?? [];
  useEffect(() => {
    const fresh = critical.filter((c) => !seen.current.has(c.id));
    if (fresh.length) { fresh.forEach((c) => seen.current.add(c.id)); beep(); }
  }, [critical]);
  if (!allowed || !critical.length) return null;
  const first = critical[0];
  return (
    <div role="alert" className="sticky top-0 z-40 flex flex-wrap items-center gap-3 bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg" data-testid="safety-alarm">
      <span className="material-icons animate-pulse" style={{ fontFamily: "Material Icons" }}>sos</span>
      <span>{critical.length === 1 ? `${first.kind === "sos" ? "SOS" : "Critical report"} ${first.code} is waiting for someone to pick it up.` : `${critical.length} critical safety cases are waiting.`}</span>
      {location !== "/admin/safety" && <Link href="/admin/safety" className="ml-auto rounded-full bg-white px-3 py-1 text-red-700 hover:bg-red-50">Open the Safety desk</Link>}
    </div>
  );
}
