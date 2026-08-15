/**
 * Marketing Notifications — compose and send a push campaign.
 *
 * Audience is the point of this page: customers and service experts are two
 * completely different populations and almost never want the same message, so
 * they are targeted separately (or together via "Everyone").
 *
 * "Reachable" vs "Total": a user only receives a PUSH if they have at least one
 * active device token. Everyone in the audience still gets the message in their
 * in-app notification feed, so the two numbers are shown side by side rather
 * than collapsed into one misleading figure.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

type Audience = "customers" | "experts" | "all";

type AudienceStats = {
  customers: { total: number; reachable: number };
  experts: { total: number; reachable: number };
};

type Campaign = {
  id: number;
  audience: string;
  title: string;
  body: string;
  deepLink: string | null;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  createdAt: string;
};

const TITLE_MAX = 100;
const BODY_MAX = 500;

const AUDIENCE_LABEL: Record<Audience, string> = {
  customers: "Customers",
  experts: "Service Experts",
  all: "Everyone",
};

export default function MarketingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [audience, setAudience] = useState<Audience>("customers");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: audienceData } = useQuery<{ data: AudienceStats }>({
    queryKey: ["/api/admin/notifications/audience"],
  });

  const { data: campaignData, isLoading: campaignsLoading } = useQuery<{ data: Campaign[] }>({
    queryKey: ["/api/admin/notifications/campaigns"],
  });

  const stats = audienceData?.data;
  const campaigns = campaignData?.data ?? [];

  // Recipients for the currently selected audience, so the confirm dialog can
  // state exactly how many people are about to be messaged.
  const selected = (() => {
    if (!stats) return { total: 0, reachable: 0 };
    if (audience === "customers") return stats.customers;
    if (audience === "experts") return stats.experts;
    return {
      total: stats.customers.total + stats.experts.total,
      reachable: stats.customers.reachable + stats.experts.reachable,
    };
  })();

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/notifications/broadcast", {
        audience,
        title: title.trim(),
        body: body.trim(),
        deepLink: deepLink.trim() || undefined,
      });
      return res;
    },
    onSuccess: (result: any) => {
      const d = result?.data ?? {};
      toast({
        title: "Campaign sent",
        description:
          `${d.recipients ?? 0} recipient(s) · ${d.sent ?? 0} device(s) delivered` +
          (d.failed ? ` · ${d.failed} failed` : "") +
          (d.skippedReason ? ` — ${d.skippedReason}` : ""),
      });
      setTitle("");
      setBody("");
      setDeepLink("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notifications/audience"] });
    },
    onError: (error: any) => {
      toast({ title: "Send failed", description: error.message, variant: "destructive" });
    },
    onSettled: () => setConfirmOpen(false),
  });

  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    title.length <= TITLE_MAX &&
    body.length <= BODY_MAX &&
    !sendMutation.isPending;

  return (
    <div className="flex-1 p-4 sm:p-6 xl:p-8 min-w-0 min-h-screen relative overflow-hidden bg-transparent">
      <div className="flex justify-between items-center mb-8 relative z-10 stagger-enter">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-[hsl(210,20%,75%)] tracking-tight drop-shadow-[0_2px_10px_rgba(255,255,255,0.1)]">
            Marketing Notifications
          </h1>
          <p className="text-[hsl(215,20%,65%)] font-medium tracking-wide mt-1">
            Send a push announcement to customers or service experts.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 relative z-10">
        {/* ── Composer ─────────────────────────────────────────── */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)] xl:col-span-2 stagger-enter">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Compose</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-2">
              <Label className="text-[hsl(210,20%,80%)]">Audience</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(["customers", "experts", "all"] as Audience[]).map((option) => {
                  const isActive = audience === option;
                  const counts =
                    option === "customers"
                      ? stats?.customers
                      : option === "experts"
                        ? stats?.experts
                        : stats && {
                          total: stats.customers.total + stats.experts.total,
                          reachable: stats.customers.reachable + stats.experts.reachable,
                        };

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setAudience(option)}
                      className={`text-left px-4 py-3 rounded-xl border transition-all ${isActive
                        ? "bg-[hsla(217,91%,60%,0.15)] border-[hsla(217,91%,60%,0.4)] shadow-[0_0_15px_hsla(217,91%,60%,0.15)]"
                        : "bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.05)]"
                        }`}
                    >
                      <div className={`font-semibold ${isActive ? "text-white" : "text-[hsl(210,20%,80%)]"}`}>
                        {AUDIENCE_LABEL[option]}
                      </div>
                      <div className="text-xs text-[hsl(215,20%,55%)] mt-1">
                        {counts
                          ? `${counts.total} total · ${counts.reachable} with app`
                          : "…"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="notif-title" className="text-[hsl(210,20%,80%)]">Title</Label>
                <span className={`text-xs ${title.length > TITLE_MAX ? "text-red-400" : "text-[hsl(215,20%,55%)]"}`}>
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
              <Input
                id="notif-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Monsoon offer — 20% off AC servicing"
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="notif-body" className="text-[hsl(210,20%,80%)]">Message</Label>
                <span className={`text-xs ${body.length > BODY_MAX ? "text-red-400" : "text-[hsl(215,20%,55%)]"}`}>
                  {body.length}/{BODY_MAX}
                </span>
              </div>
              <Textarea
                id="notif-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                placeholder="Book any AC service before 31 August and get 20% off. Tap to browse services."
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white"
              />
              <p className="text-xs text-[hsl(215,20%,55%)]">
                Android collapses long messages — keep the first line meaningful on its own.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notif-link" className="text-[hsl(210,20%,80%)]">
                Deep link <span className="text-[hsl(215,20%,55%)]">(optional)</span>
              </Label>
              <Input
                id="notif-link"
                value={deepLink}
                onChange={(e) => setDeepLink(e.target.value)}
                placeholder="unitefix://home"
                className="bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.1)] text-white font-mono text-sm"
              />
              <p className="text-xs text-[hsl(215,20%,55%)]">
                Where the notification opens. e.g. <code>unitefix://home</code>,{" "}
                <code>unitefix://shop</code>, <code>unitefix://partner/wallet</code>. Leave blank
                to open the notification list.
              </p>
            </div>

            {/* Live preview — what the notification looks like on a phone. */}
            <div className="space-y-2">
              <Label className="text-[hsl(210,20%,80%)]">Preview</Label>
              <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4 flex gap-3">
                <div className="w-9 h-9 rounded-lg shrink-0 bg-[hsla(217,91%,60%,0.15)] border border-[hsla(217,91%,60%,0.3)] flex items-center justify-center">
                  <span className="material-icons text-[hsl(217,91%,60%)] text-[18px]" style={{ fontFamily: "Material Icons" }}>
                    campaign
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {title.trim() || "Notification title"}
                  </div>
                  <div className="text-sm text-[hsl(215,20%,65%)] line-clamp-2">
                    {body.trim() || "Your message will appear here."}
                  </div>
                  <div className="text-[11px] text-[hsl(215,20%,45%)] mt-1">UniteFix · now</div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[rgba(255,255,255,0.06)]">
              <p className="text-sm text-[hsl(215,20%,65%)]">
                Sending to <span className="text-white font-semibold">{selected.total}</span>{" "}
                {AUDIENCE_LABEL[audience].toLowerCase()} ·{" "}
                <span className="text-white font-semibold">{selected.reachable}</span> will get a push
              </p>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={!canSend}
                className="bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white"
              >
                {sendMutation.isPending ? "Sending…" : "Send campaign"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Reach summary ────────────────────────────────────── */}
        <Card className="glass-card border-[rgba(255,255,255,0.08)] stagger-enter h-fit">
          <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
            <CardTitle className="text-xl text-white">Reach</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {(["customers", "experts"] as const).map((key) => {
              const row = stats?.[key];
              const pct = row && row.total > 0 ? Math.round((row.reachable / row.total) * 100) : 0;
              return (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[hsl(210,20%,80%)]">{AUDIENCE_LABEL[key]}</span>
                    <span className="text-white font-semibold">
                      {row ? `${row.reachable}/${row.total}` : "…"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
                    <div
                      className="h-full bg-[hsl(217,91%,60%)] rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-[hsl(215,20%,55%)] mt-1">
                    {pct}% have the app installed with notifications enabled
                  </p>
                </div>
              );
            })}
            <p className="text-xs text-[hsl(215,20%,55%)] pt-2 border-t border-[rgba(255,255,255,0.06)]">
              Everyone in the audience gets the message in their in-app notification list, even
              without a registered device.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── History ────────────────────────────────────────────── */}
      <Card className="glass-card border-[rgba(255,255,255,0.08)] relative z-10 mt-6 stagger-enter">
        <CardHeader className="border-b border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.01)] rounded-t-xl">
          <CardTitle className="text-xl text-white">Past Campaigns</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {campaignsLoading ? (
            <div className="flex justify-center p-8 text-[hsl(215,20%,65%)]">Loading…</div>
          ) : campaigns.length === 0 ? (
            <div className="flex justify-center p-8 text-[hsl(215,20%,65%)]">
              No campaigns sent yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-[rgba(255,255,255,0.06)]">
                    <TableHead className="text-[hsl(210,20%,75%)]">Sent</TableHead>
                    <TableHead className="text-[hsl(210,20%,75%)]">Audience</TableHead>
                    <TableHead className="text-[hsl(210,20%,75%)]">Title</TableHead>
                    <TableHead className="text-[hsl(210,20%,75%)] text-right">Recipients</TableHead>
                    <TableHead className="text-[hsl(210,20%,75%)] text-right">Delivered</TableHead>
                    <TableHead className="text-[hsl(210,20%,75%)] text-right">Failed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => (
                    <TableRow key={c.id} className="border-[rgba(255,255,255,0.04)]">
                      <TableCell className="text-[hsl(215,20%,65%)] whitespace-nowrap">
                        {c.createdAt ? format(new Date(c.createdAt), "dd MMM yyyy, HH:mm") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-[rgba(255,255,255,0.15)] text-[hsl(210,20%,80%)]">
                          {AUDIENCE_LABEL[c.audience as Audience] ?? c.audience}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-white max-w-xs truncate" title={c.body}>
                        {c.title}
                      </TableCell>
                      <TableCell className="text-right text-[hsl(210,20%,80%)]">{c.recipientCount}</TableCell>
                      <TableCell className="text-right text-emerald-400">{c.deliveredCount}</TableCell>
                      <TableCell className="text-right text-[hsl(215,20%,55%)]">{c.failedCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {selected.total} {AUDIENCE_LABEL[audience].toLowerCase()}?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected.reachable} of them will receive a push notification on their phone. This
              cannot be undone or recalled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-lg border p-3 text-sm">
            <div className="font-semibold">{title.trim()}</div>
            <div className="text-muted-foreground">{body.trim()}</div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                sendMutation.mutate();
              }}
              disabled={sendMutation.isPending}
            >
              {sendMutation.isPending ? "Sending…" : "Send now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
