"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { createProjectDeliverable, updateProjectDeliverable } from "@/server/projects/deliverables-actions";
import type { ProjectDeliverable, ProjectDeliveryFile, ProjectViewer, MemberRef } from "./types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/settings/form-field";

type Props = {
  projectId: string;
  clientId: string | null;
  deliverables: ProjectDeliverable[];
  files: ProjectDeliveryFile[];
  members: MemberRef[];
  viewer: ProjectViewer;
  canEdit: boolean;
};

const NONE = "none";

export function DeliverablesPanel({ projectId, clientId, deliverables, files, members, viewer, canEdit }: Props) {
  const t = useTranslations("projects.deliverables");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fileByDeliverable, setFileByDeliverable] = useState<Record<string, string>>(() =>
    Object.fromEntries(deliverables.map((item) => [item.id, item.clientFileId ?? ""])),
  );
  const [form, setForm] = useState({ title: "", description: "", due_on: "", assignee_member_id: "" });
  const fileOptions = files.filter((file) => file.kind === "link" || file.uploadedAt !== null);
  const fileName = (id: string | null) => files.find((file) => file.id === id)?.title ?? null;
  const memberName = (id: string | null) => members.find((member) => member.id === id)?.fullName ?? t("unassigned");

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await createProjectDeliverable(viewer.slug, { project_id: projectId, ...form });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(t("created"));
      setForm({ title: "", description: "", due_on: "", assignee_member_id: "" });
      setAdding(false);
      router.refresh();
    });
  };

  const change = (item: ProjectDeliverable, status: ProjectDeliverable["status"]) => {
    startTransition(async () => {
      const result = await updateProjectDeliverable(viewer.slug, {
        deliverable_id: item.id,
        status,
        client_file_id: fileByDeliverable[item.id] ?? item.clientFileId ?? "",
      });
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(t("updated"));
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b">
        <div><CardTitle>{t("title")}</CardTitle><CardDescription className="mt-1">{t("description")}</CardDescription></div>
        {canEdit && clientId && <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>{adding ? tCommon("cancel") : t("new")}</Button>}
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {!clientId && <p className="text-sm text-muted-foreground">{t("internalProject")}</p>}
        {canEdit && adding && clientId && (
          <form onSubmit={create} className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
            <FormField id="deliverable-title" label={t("name")} className="sm:col-span-2">
              <Input id="deliverable-title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </FormField>
            <FormField id="deliverable-due" label={t("dueDate")}>
              <Input id="deliverable-due" type="date" value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })} />
            </FormField>
            <FormField id="deliverable-assignee" label={t("assignee")}>
              <Select value={form.assignee_member_id || NONE} onValueChange={(value) => setForm({ ...form, assignee_member_id: value === NONE ? "" : value })}>
                <SelectTrigger id="deliverable-assignee" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>{t("unassigned")}</SelectItem>{members.map((member) => <SelectItem key={member.id} value={member.id}>{member.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField id="deliverable-description" label={t("notes")} optional className="sm:col-span-2">
              <Textarea id="deliverable-description" rows={2} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </FormField>
            <div className="flex justify-end sm:col-span-2"><Button type="submit" disabled={pending || !form.title.trim()}>{pending ? tCommon("saving") : t("create")}</Button></div>
          </form>
        )}
        {deliverables.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p> : (
          <ul className="divide-y rounded-xl border">
            {deliverables.map((item) => (
              <li key={item.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(14rem,20rem)] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.title}</span><span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{t(`status.${item.status}`)}</span></div>
                  {item.description && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{item.description}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{item.dueOn ? t("dueLabel", { date: item.dueOn }) : t("noDueDate")} · {memberName(item.assigneeId)}{item.sentAt ? ` · ${t("sentLabel", { date: item.sentAt.slice(0, 10) })}` : ""}</p>
                  {fileName(item.clientFileId) && <p className="mt-1 truncate text-xs text-primary">{t("linkedFile", { name: fileName(item.clientFileId)! })}</p>}
                </div>
                {canEdit && item.status !== "accepted" && item.status !== "cancelled" && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {item.status !== "sent" && <Select value={fileByDeliverable[item.id] ?? item.clientFileId ?? NONE} onValueChange={(value) => setFileByDeliverable((prev) => ({ ...prev, [item.id]: value === NONE ? "" : value }))}>
                      <SelectTrigger className="min-w-36 flex-1" aria-label={t("linkedFileLabel")}><SelectValue placeholder={t("chooseFile")} /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>{t("noFile")}</SelectItem>{fileOptions.map((file) => <SelectItem key={file.id} value={file.id}>{file.title}</SelectItem>)}</SelectContent>
                    </Select>}
                    {item.status === "planned" && <Button size="sm" variant="outline" disabled={pending} onClick={() => change(item, "in_progress")}>{t("actions.start")}</Button>}
                    {item.status === "in_progress" && <Button size="sm" variant="outline" disabled={pending} onClick={() => change(item, "review")}>{t("actions.review")}</Button>}
                    {item.status === "review" && <Button size="sm" disabled={pending} onClick={() => change(item, "sent")}>{t("actions.send")}</Button>}
                    {item.status === "sent" && <Button size="sm" disabled={pending} onClick={() => change(item, "accepted")}>{t("actions.accept")}</Button>}
                  </div>
                )}
                {canEdit && (item.status === "planned" || item.status === "in_progress" || item.status === "review") && <div className="md:col-start-2 md:text-right"><Button variant="ghost" size="sm" className="text-muted-foreground" disabled={pending} onClick={() => change(item, "cancelled")}>{t("actions.cancel")}</Button></div>}
              </li>
            ))}
          </ul>
        )}
        {clientId && <p className="text-xs text-muted-foreground">{t("fileHint", { count: fileOptions.length })}</p>}
      </CardContent>
    </Card>
  );
}
