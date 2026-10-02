"use client";

import { Check, ClipboardList, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelClientRequest, closeClientRequest, createClientRequest } from "@/app/[org]/clients/actions";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export type ClientRequestRow = {
  id: string; kind: "questionnaire" | "material" | "access" | "other"; status: "requested" | "received" | "cancelled";
  title: string; instructions: string | null; requestedAt: string; dueOn: string | null; receivedAt: string | null;
  response: string | null; fileId: string | null; fileTitle: string | null;
};
export type ClientRequestFile = { id: string; title: string };

export function ClientRequestsPanel({ slug, clientId, requests, files, projects, canEdit }: {
  slug: string; clientId: string; requests: ClientRequestRow[]; files: ClientRequestFile[];
  projects: { id: string; name: string }[]; canEdit: boolean;
}) {
  const t = useTranslations("clients.requests");
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<ClientRequestRow["kind"]>("questionnaire");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [projectId, setProjectId] = useState("");
  const [closing, setClosing] = useState<ClientRequestRow | null>(null);
  const [response, setResponse] = useState("");
  const [fileId, setFileId] = useState("");
  const submit = () => startTransition(async () => {
    const result = await createClientRequest(slug, clientId, { kind, title, instructions, requestedAt: new Date().toISOString().slice(0, 10), dueOn: dueOn || null, projectId: projectId || null });
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(t("created")); setCreating(false); setTitle(""); setInstructions(""); setDueOn(""); setProjectId("");
  });
  const receive = () => startTransition(async () => {
    if (!closing) return;
    const result = await closeClientRequest(slug, clientId, closing.id, { response, clientFileId: fileId || null });
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(t("receivedToast")); setClosing(null); setResponse(""); setFileId("");
  });
  const cancel = (id: string) => startTransition(async () => {
    const result = await cancelClientRequest(slug, clientId, id);
    if (!result.ok) { toast.error(result.error); return; }
    toast.success(t("cancelledToast"));
  });
  return <SettingsCard title={t("title")} description={requests.length ? t("count", { count: requests.length }) : undefined} actions={canEdit ? <Button variant="outline" size="sm" onClick={() => setCreating(!creating)}><Plus data-icon="inline-start" />{t("add")}</Button> : undefined} bodyClassName={requests.length ? "px-5 py-1" : undefined}>
    {creating && canEdit && <div className="mb-4 space-y-3 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <select aria-label={t("kind")} className="h-9 rounded-md border bg-background px-3 text-sm" value={kind} onChange={(e) => setKind(e.target.value as ClientRequestRow["kind"])}>{(["questionnaire", "material", "access", "other"] as const).map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}</select>
        <Input placeholder={t("titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <Input type="date" aria-label={t("dueOn")} value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        <select aria-label={t("project")} className="h-9 rounded-md border bg-background px-3 text-sm" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">{t("noProject")}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      <Textarea placeholder={t("instructions")} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={5000} />
      <p className="text-xs text-muted-foreground">{t("manualOnly")}</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreating(false)}>{t("cancel")}</Button><Button disabled={pending || !title.trim()} onClick={submit}>{t("save")}</Button></div>
    </div>}
    {closing && <div className="mb-4 space-y-3 rounded-lg border p-4"><p className="font-medium">{t("markReceived", { title: closing.title })}</p><Textarea placeholder={t("response")} value={response} onChange={(e) => setResponse(e.target.value)} maxLength={10000} /><select aria-label={t("file")} className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={fileId} onChange={(e) => setFileId(e.target.value)}><option value="">{t("noFile")}</option>{files.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setClosing(null)}>{t("cancel")}</Button><Button disabled={pending || (!response.trim() && !fileId)} onClick={receive}><Check data-icon="inline-start" />{t("confirmReceived")}</Button></div></div>}
    {!requests.length ? <div className="text-center"><ClipboardList className="mx-auto size-5 text-muted-foreground"/><p className="mt-2 text-muted-foreground">{t("empty")}</p></div> : <ul className="divide-y">{requests.map((r) => <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.title}</span><Badge variant={r.status === "requested" ? "secondary" : "outline"}>{t(`statuses.${r.status}`)}</Badge><span className="text-xs text-muted-foreground">{t(`kinds.${r.kind}`)}</span></div>{r.instructions && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{r.instructions}</p>}<p className="mt-1 text-xs text-muted-foreground">{t("requestedAt", { date: r.requestedAt })}{r.dueOn ? ` · ${t("dueOnValue", { date: r.dueOn })}` : ""}</p>{r.response && <p className="mt-2 whitespace-pre-wrap text-sm">{t("responseLabel")}: {r.response}</p>}{r.fileTitle && <p className="text-sm">{t("fileLabel")}: {r.fileTitle}</p>}</div>{canEdit && r.status === "requested" && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => { setClosing(r); setResponse(""); setFileId(""); }}><Check data-icon="inline-start"/>{t("received")}</Button><Button size="icon" variant="ghost" aria-label={t("cancelRequest")} disabled={pending} onClick={() => cancel(r.id)}><X/></Button></div>}</li>)}</ul>}
  </SettingsCard>;
}
