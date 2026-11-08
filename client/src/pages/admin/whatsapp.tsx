/**
 * Admin → WhatsApp: connect UniteFix's WhatsApp Business number (WhatsApp
 * Cloud API, Meta) so payment links for call bookings go out on WhatsApp
 * automatically. Four steps: connect (checked with Meta), submit the message
 * template for approval, send a test, switch it on. The access token is stored
 * encrypted and never shown again. See server/services/whatsapp.service.ts.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, apiErrorMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, ExternalLink, RefreshCw, Send, ShieldCheck } from "lucide-react";

type Status = {
  source: "env" | "admin" | null; enabled: boolean; connected: boolean; ready: boolean;
  tokenSaved: boolean; tokenEnding: string | null; phoneNumberId: string | null; businessAccountId: string | null;
  template: string; lang: string; displayNumber: string | null; verifiedName: string | null;
  templateStatus: string | null; templateReason: string | null; checkedAt: string | null; templateBody: string;
};

const field = "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white";
const panel = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 sm:p-5";
const KEY = ["/api/admin/integrations/whatsapp"];

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: React.ReactNode }) {
  return (
    <section className={panel} aria-label={title}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
        {done ? <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-label="done" /> : <Circle className="h-5 w-5 text-[hsl(215,20%,45%)]" aria-label="to do" />}
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

export default function WhatsAppPage() {
  const { toast } = useToast();
  const status = useQuery<Status>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", KEY[0])).data });
  const s = status.data;
  const [token, setToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [template, setTemplate] = useState("unitefix_payment_link");
  const [lang, setLang] = useState("en");
  const [testPhone, setTestPhone] = useState("");
  useEffect(() => {
    if (!s) return;
    setPhoneNumberId(s.phoneNumberId ?? ""); setBusinessAccountId(s.businessAccountId ?? ""); setTemplate(s.template || "unitefix_payment_link"); setLang(s.lang || "en");
  }, [s?.phoneNumberId, s?.businessAccountId, s?.template, s?.lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = (title: string) => (r: any) => { toast({ title, description: r?.message }); queryClient.setQueryData(KEY, r?.data ?? undefined); queryClient.invalidateQueries({ queryKey: KEY }); };
  const failed = (title: string) => (e: unknown) => toast({ title, description: apiErrorMessage(e), variant: "destructive" });
  const connect = useMutation({ mutationFn: async () => apiRequest("PUT", KEY[0], { token: token || undefined, phoneNumberId, businessAccountId, template, lang }), onSuccess: r => { setToken(""); done("Connected")(r); }, onError: failed("Not connected") });
  const submit = useMutation({ mutationFn: async () => apiRequest("POST", `${KEY[0]}/template`, {}), onSuccess: done("Template sent to Meta"), onError: failed("Not sent") });
  const refresh = useMutation({ mutationFn: async () => apiRequest("POST", `${KEY[0]}/template/refresh`, {}), onSuccess: done("Template status updated"), onError: failed("Could not check") });
  const test = useMutation({ mutationFn: async () => apiRequest("POST", `${KEY[0]}/test`, { phone: testPhone }), onSuccess: (r: any) => toast({ title: "Test sent", description: r?.message }), onError: failed("Test not sent") });
  const toggle = useMutation({ mutationFn: async (enabled: boolean) => apiRequest("PATCH", KEY[0], { enabled }), onSuccess: done("Saved"), onError: failed("Not saved") });
  const disconnect = useMutation({ mutationFn: async () => apiRequest("DELETE", KEY[0]), onSuccess: done("Disconnected"), onError: failed("Not disconnected") });

  const env = s?.source === "env";
  const approved = s?.templateStatus === "APPROVED";

  return (
    <main className="min-w-0 flex-1 space-y-5 p-4 sm:p-6 xl:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">WhatsApp</h1>
          <p className="mt-1 max-w-3xl text-sm text-[hsl(215,20%,65%)]">
            Connect UniteFix's WhatsApp Business number so payment links for call bookings go out on WhatsApp automatically (WhatsApp Cloud API, from Meta; about ₹0.12 per message for this kind of message). Until it is ready, staff can still send links from WhatsApp Web.
          </p>
        </div>
        {s && (
          <Badge className={s.ready && s.enabled ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15" : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/15"} data-testid="wa-state">
            {s.ready && s.enabled ? "Sending automatically" : s.connected ? (approved ? "Switched off" : "Waiting for template approval") : "Not connected"}
          </Badge>
        )}
      </div>

      {env && <p className="rounded-xl bg-[rgba(59,130,246,0.1)] p-3 text-sm text-blue-200">WhatsApp is set by the server's environment variables, so it is changed there, not here.</p>}

      <Step n={1} done={!!s?.connected} title="Connect the number">
        <p className="mb-3 text-sm text-[hsl(215,20%,65%)]">
          From <a className="inline-flex items-center gap-1 text-[#FFB15C] underline" href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noreferrer">WhatsApp Manager <ExternalLink className="h-3 w-3" /></a> → your number → API setup, and a permanent access token (Business settings → System users → Generate token, with whatsapp_business_messaging and whatsapp_business_management).
        </p>
        {s?.connected && (
          <p className="mb-3 flex items-center gap-2 text-sm text-emerald-300" data-testid="wa-number"><ShieldCheck className="h-4 w-4" /> {s.verifiedName ?? "Connected"}{s.displayNumber ? ` · ${s.displayNumber}` : ""}</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="wa-token" className="text-[hsl(215,20%,75%)]">Access token</Label>
            <Input id="wa-token" type="password" autoComplete="off" value={token} disabled={env} onChange={e => setToken(e.target.value)} placeholder={s?.tokenSaved ? `Saved (ends …${s.tokenEnding}). Paste a new one to replace it.` : "EAAG…"} className={field} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wa-phone-id" className="text-[hsl(215,20%,75%)]">Phone number ID</Label>
            <Input id="wa-phone-id" inputMode="numeric" value={phoneNumberId} disabled={env} onChange={e => setPhoneNumberId(e.target.value.trim())} placeholder="e.g. 109876543210987" className={field} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wa-waba" className="text-[hsl(215,20%,75%)]">WhatsApp Business Account ID</Label>
            <Input id="wa-waba" inputMode="numeric" value={businessAccountId} disabled={env} onChange={e => setBusinessAccountId(e.target.value.trim())} placeholder="needed to submit the template" className={field} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wa-template" className="text-[hsl(215,20%,75%)]">Template name</Label>
            <Input id="wa-template" value={template} disabled={env} onChange={e => setTemplate(e.target.value.trim())} className={field} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wa-lang" className="text-[hsl(215,20%,75%)]">Template language</Label>
            <Input id="wa-lang" value={lang} disabled={env} onChange={e => setLang(e.target.value.trim())} placeholder="en" className={field} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={env || connect.isPending || !phoneNumberId || (!token && !s?.tokenSaved)} onClick={() => connect.mutate()}>{connect.isPending ? "Checking with Meta…" : s?.connected ? "Save and check again" : "Connect and check"}</Button>
          {s?.source === "admin" && <Button variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button>}
        </div>
      </Step>

      <Step n={2} done={approved} title="Get the message approved">
        <p className="text-sm text-[hsl(215,20%,65%)]">WhatsApp only lets a business start a chat with a message Meta has approved. UniteFix's payment message (a utility message, the low-cost kind):</p>
        <blockquote className="my-3 rounded-lg border-l-4 border-[#25D366] bg-[rgba(37,211,102,0.06)] px-3 py-2 text-sm text-white">{s?.templateBody ?? "…"}</blockquote>
        <p className="mb-3 text-xs text-[hsl(215,20%,55%)]">{"{{1}}"} name · {"{{2}}"} service · {"{{3}}"} booking number · {"{{4}}"} amount · {"{{5}}"} payment link. Using a template you made yourself? Give it these five values in this order and put its name in step 1.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!s?.connected || !s?.businessAccountId || submit.isPending || approved} onClick={() => submit.mutate()}>{submit.isPending ? "Sending…" : "Send it to Meta for approval"}</Button>
          <Button variant="outline" className="gap-1" disabled={!s?.connected || !s?.businessAccountId || refresh.isPending} onClick={() => refresh.mutate()}><RefreshCw className="h-3.5 w-3.5" /> Check status</Button>
          {s?.templateStatus && (
            <Badge data-testid="wa-template-status" className={approved ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15" : s.templateStatus === "REJECTED" ? "bg-red-500/15 text-red-300 hover:bg-red-500/15" : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/15"}>
              {s.templateStatus === "NOT_FOUND" ? "Not found at Meta" : s.templateStatus.charAt(0) + s.templateStatus.slice(1).toLowerCase()}
            </Badge>
          )}
        </div>
        {s?.templateReason && <p className="mt-2 text-sm text-red-300">Meta's reason: {s.templateReason}</p>}
      </Step>

      <Step n={3} done={false} title="Send yourself a test">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="wa-test" className="text-[hsl(215,20%,75%)]">Your mobile number</Label>
            <Input id="wa-test" inputMode="tel" value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="98450 12345" className={`${field} w-56`} />
          </div>
          <Button variant="outline" className="gap-1" disabled={!s?.connected || !approved || test.isPending} onClick={() => test.mutate()}><Send className="h-3.5 w-3.5" /> {test.isPending ? "Sending…" : "Send test"}</Button>
        </div>
        {!approved && <p className="mt-2 text-xs text-[hsl(215,20%,55%)]">Available once the template is approved.</p>}
      </Step>

      <Step n={4} done={!!(s?.ready && s?.enabled)} title="Send payment links on WhatsApp automatically">
        <label className="flex items-center gap-3 text-sm text-white">
          <Switch checked={!!s?.enabled} disabled={env || !s?.connected || toggle.isPending} onCheckedChange={v => toggle.mutate(v)} aria-label="Send payment links on WhatsApp automatically" />
          {s?.enabled ? "On: every payment link from Book by call also goes on WhatsApp." : "Off: links go by SMS and email only (and WhatsApp Web by hand)."}
        </label>
        {s?.enabled && !approved && s?.connected && <p className="mt-2 text-xs text-amber-300">It starts once Meta approves the template.</p>}
      </Step>
    </main>
  );
}
