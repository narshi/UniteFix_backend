/**
 * Go-live checklist — every key, account and setting checked against the
 * running server. Shows whether something is set, never its value.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, apiErrorMessage } from "@/lib/queryClient";

type Check = { key: string; area: string; label: string; status: "ok" | "action" | "info"; detail: string; fix?: string };
const TONE: Record<Check["status"], string> = {
  ok: "border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
  action: "border-rose-500/40 text-rose-600 dark:text-rose-300",
  info: "border-sky-500/40 text-sky-600 dark:text-sky-300",
};
const LABEL: Record<Check["status"], string> = { ok: "Ready", action: "To do", info: "Note" };

/** Signs in to Cashfree Payouts and reads the balance — moves no money. */
function CashfreeCheck() {
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; text?: string; using?: any }>({ busy: false });
  const run = async () => {
    setState({ busy: true });
    try {
      const d = (await apiRequest("GET", "/api/admin/withdrawals/cashfree-check")).data;
      const rs = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
      const env = d.environment === "PROD" ? "live" : "test";
      const v2 = d.v2.ok ? "payouts (v2) accept the keys" : `payouts (v2) refused: ${d.v2.message}`;
      const v1 = d.v1.ok ? `balance ${rs(d.v1.balance)}, available ${rs(d.v1.available)}` : "balance not available";
      setState({ busy: false, ok: d.v2.ok, text: `Cashfree ${env}${d.signed ? ", signed with your public key" : ""} — ${v2}; ${v1}.`, using: d.using });
    } catch (e) { setState({ busy: false, ok: false, text: apiErrorMessage(e) }); }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={run} disabled={state.busy}>{state.busy ? "Connecting…" : "Test connection"}</Button>
      {state.text && <span className={`text-xs ${state.ok ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>{state.text}</span>}
      {state.using && (
        <div className="w-full rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">What the server is using</p>
          <p>Client ID: <code>{state.using.clientId ?? "none"}</code> from <code>{state.using.clientIdVar ?? "—"}</code>{state.using.clientIdLooksTest ? " — this looks like a TEST key" : ""}</p>
          <p>Server's outgoing IP right now: <code>{state.using.outboundIp ?? "unknown"}</code> — Render can change it on any deploy or restart, so an IP whitelist on Cashfree breaks; the public key method does not.</p>
          <p>Public key ending: <code>…{state.using.publicKeyEnding ?? "none"}</code> from <code>{state.using.publicKeyVar ?? "—"}</code></p>
          <p>Fund source: <code>{state.using.fundsourceId ?? "chosen by Cashfree"}</code>{state.using.fundsourceIdInvalid ? " — CASHFREE_PAYOUTS_FUNDSOURCE_ID is set but not a valid id (letters, digits, _ . -), so it is ignored" : state.using.fundsourceId ? " from CASHFREE_PAYOUTS_FUNDSOURCE_ID" : " — set CASHFREE_PAYOUTS_FUNDSOURCE_ID on Render (e.g. CF_Wallet) if transfers fail with ERROR_SELECTING_FUND_SOURCE"}</p>
          {state.using.oldNamesAlsoSet?.length > 0 && <p>Older variables still set on Render: {state.using.oldNamesAlsoSet.join(", ")} (used only when the CASHFREE_PAYOUTS_ ones are empty).</p>}
          <p>Compare: the Client ID with Cashfree → Payouts (Production) → Developers → API Keys, and the key ending with the last line of the public key file you downloaded.</p>
        </div>
      )}
    </div>
  );
}

/**
 * A real ₹1–₹10 transfer through Cashfree to an account you name — the same
 * calls a withdrawal makes, with no wallet involved. Asks to confirm first.
 */
function TestPayout() {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<"upi" | "bank">("upi");
  const [f, setF] = useState({ name: "", upiId: "", bankAccount: "", ifsc: "", amount: "1" });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; transferId?: string } | null>(null);
  const describe = (d: any) => `${d.transferId}: ${d.status === "processed" ? "money sent" : d.status === "processing" ? "on its way (Cashfree: " + (d.providerStatus ?? "PENDING") + ")" : d.status + (d.reason ? " — " + d.reason : "")}${d.utr ? ` · UTR ${d.utr}` : ""}`;
  const send = async () => {
    setBusy(true); setResult(null);
    try {
      const body = to === "upi" ? { name: f.name, upiId: f.upiId, amount: Number(f.amount) } : { name: f.name, bankAccount: f.bankAccount, ifsc: f.ifsc, amount: Number(f.amount) };
      const r: any = await apiRequest("POST", "/api/admin/withdrawals/cashfree-test-payout", body);
      setResult({ ok: r.data.status !== "failed", text: describe(r.data), transferId: r.data.transferId });
    } catch (e) { setResult({ ok: false, text: apiErrorMessage(e) }); }
    finally { setBusy(false); setConfirming(false); }
  };
  const check = async () => {
    if (!result?.transferId) return;
    setBusy(true);
    try { const r: any = await apiRequest("GET", `/api/admin/withdrawals/cashfree-test-payout/${result.transferId}`); setResult({ ok: r.data.status !== "failed", text: describe(r.data), transferId: r.data.transferId }); }
    catch (e) { setResult({ ...result, ok: false, text: apiErrorMessage(e) }); }
    finally { setBusy(false); }
  };
  if (!open) return <Button size="sm" variant="ghost" className="mt-1 px-0 text-xs underline" onClick={() => setOpen(true)}>Send a test payout…</Button>;
  const dest = to === "upi" ? f.upiId : `account ${f.bankAccount} (${f.ifsc})`;
  return (
    <div className="mt-3 space-y-2 rounded-md border p-3">
      <p className="text-xs text-muted-foreground">Sends real money (₹1–₹10) through Cashfree to the account below — the same steps a withdrawal takes, without touching any wallet. Use your own account.</p>
      <div className="flex gap-1">
        {(["upi", "bank"] as const).map(k => <Button key={k} size="sm" variant={to === k ? "default" : "outline"} onClick={() => { setTo(k); setConfirming(false); }}>{k === "upi" ? "UPI ID" : "Bank account"}</Button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input id="tp-name" aria-label="Account holder's name" placeholder="Account holder's name" value={f.name} onChange={e => { setF({ ...f, name: e.target.value }); setConfirming(false); }} />
        {to === "upi"
          ? <Input id="tp-upi" aria-label="UPI ID" placeholder="name@okhdfcbank" value={f.upiId} onChange={e => { setF({ ...f, upiId: e.target.value }); setConfirming(false); }} />
          : <>
              <Input id="tp-acc" aria-label="Bank account number" inputMode="numeric" placeholder="Account number" value={f.bankAccount} onChange={e => { setF({ ...f, bankAccount: e.target.value.replace(/\s/g, "") }); setConfirming(false); }} />
              <Input id="tp-ifsc" aria-label="IFSC" placeholder="IFSC" value={f.ifsc} onChange={e => { setF({ ...f, ifsc: e.target.value.toUpperCase() }); setConfirming(false); }} />
            </>}
        <Input id="tp-amt" aria-label="Amount in rupees" inputMode="numeric" placeholder="1" value={f.amount} onChange={e => { setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") }); setConfirming(false); }} />
      </div>
      {!confirming
        ? <Button size="sm" onClick={() => setConfirming(true)} disabled={busy || !f.name.trim() || !(to === "upi" ? f.upiId.trim() : f.bankAccount && f.ifsc) || !(Number(f.amount) >= 1 && Number(f.amount) <= 10)}>Review test payout</Button>
        : <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Send <b>₹{f.amount}</b> to <b>{f.name}</b>, {dest}?</span>
            <Button size="sm" onClick={send} disabled={busy}>{busy ? "Sending…" : `Send ₹${f.amount}`}</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </div>}
      {result && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs ${result.ok ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>{result.text}</span>
          {result.transferId && <Button size="sm" variant="outline" onClick={check} disabled={busy}>Check status</Button>}
        </div>
      )}
    </div>
  );
}

export default function GoLivePage() {
  const q = useQuery<{ checks: Check[]; summary: { ok: number; action: number; info: number } }>({ queryKey: ["/api/admin/hub/go-live"], queryFn: async () => (await apiRequest("GET", "/api/admin/hub/go-live")).data });
  const areas = Array.from(new Set((q.data?.checks ?? []).map(c => c.area)));
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Go-live checklist</h1>
          <p className="text-sm text-muted-foreground">Keys, accounts and settings the platform and the Partner Hub need before real customers and real money. Checked live on this server; no secret is ever shown.</p>
        </div>
        <Button variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Checking…" : "Check again"}</Button>
      </div>
      {q.data && <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="outline" className={TONE.action}>{q.data.summary.action} to do</Badge>
        <Badge variant="outline" className={TONE.ok}>{q.data.summary.ok} ready</Badge>
        <Badge variant="outline" className={TONE.info}>{q.data.summary.info} notes</Badge>
      </div>}
      {q.isLoading && <p className="text-sm text-muted-foreground">Checking…</p>}
      {q.isError && <p className="text-sm text-destructive">Could not run the checks. Only super admins can see this page.</p>}
      {areas.map(area => (
        <Card key={area}>
          <CardHeader className="pb-2"><CardTitle className="text-base font-medium">{area}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">{q.data!.checks.filter(c => c.area === area).sort((a, b) => (a.status === "action" ? 0 : 1) - (b.status === "action" ? 0 : 1)).map(c => (
              <li key={c.key} className="grid gap-1 px-6 py-3 sm:grid-cols-[7rem_1fr]">
                <span><Badge variant="outline" className={TONE[c.status]}>{LABEL[c.status]}</Badge></span>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{c.label}</p>
                  <p className="text-muted-foreground">{c.detail}</p>
                  {c.fix && c.status !== "ok" && <p className="mt-1 text-xs"><span className="font-medium">How: </span>{c.fix}</p>}
                  {c.key === "cashfree_payouts" && <><CashfreeCheck /><TestPayout /></>}
                </div>
              </li>
            ))}</ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
