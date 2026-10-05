/**
 * Documents — the business's vault: KYC papers, licences, insurance, with
 * their review status and expiry. Expiring documents are flagged a month
 * ahead, so a lapsed licence never surprises anyone.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { HubPage, Panel, Chip, Empty } from "@/components/hub/ui";

type Doc = { id: number; docType: string; label: string; fileUrl: string; fileName: string | null; status: string; expiresAt: string | null; reviewNote: string | null; createdAt: string };

function expiryTone(d: Doc): { tone: string; text: string } | null {
  if (!d.expiresAt) return null;
  const days = Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { tone: "bad", text: `expired ${-days}d ago` };
  if (days <= 30) return { tone: "warn", text: `expires in ${days}d` };
  return { tone: "muted", text: `valid till ${d.expiresAt}` };
}

export default function HubDocuments() {
  const { data = [], isLoading } = useQuery<Doc[]>({ queryKey: ["/api/hub/documents"], queryFn: async () => (await apiRequest("GET", "/api/hub/documents")).data });
  const current = data.filter(d => d.status !== "superseded");
  const history = data.filter(d => d.status === "superseded");

  return (
    <HubPage title="Documents" subtitle={<>Upload or replace documents from <Link href="/partner/onboarding" className="text-[hsl(174,72%,60%)] underline underline-offset-2">Onboarding &amp; KYC</Link>. Earlier versions are kept below.</>}>
      <Panel title="Current">
        {isLoading ? <p className="text-sm text-[hsl(215,20%,65%)]">Loading…</p> : current.length === 0 ? <Empty icon="folder_open" title="No documents yet" /> : (
          <ul className="divide-y divide-[rgba(255,255,255,0.06)]">
            {current.map(d => {
              const exp = expiryTone(d);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex-1 min-w-[200px]"><p className="text-sm text-white">{d.label}</p><p className="text-xs text-[hsl(215,20%,60%)]">Uploaded {new Date(d.createdAt).toLocaleDateString("en-IN")}{d.reviewNote ? ` · UniteFix: ${d.reviewNote}` : ""}</p></div>
                  <Chip tone={d.status === "verified" ? "good" : d.status === "rejected" ? "bad" : "info"}>{d.status}</Chip>
                  {exp && <Chip tone={exp.tone}>{exp.text}</Chip>}
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-[hsl(174,72%,60%)] underline underline-offset-2">{d.fileName ?? "view"}</a>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {history.length > 0 && (
        <Panel title="Earlier versions">
          <ul className="space-y-1 text-sm text-[hsl(215,20%,65%)]">
            {history.map(d => <li key={d.id}>{d.label} · {new Date(d.createdAt).toLocaleDateString("en-IN")} · <a href={d.fileUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{d.fileName ?? "view"}</a></li>)}
          </ul>
        </Panel>
      )}
    </HubPage>
  );
}
