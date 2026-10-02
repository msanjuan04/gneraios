"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Building2, Download, FileText, Pencil, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { archiveCompanyDocument, updateCompanyDocument } from "@/app/[org]/finance/company-actions";
import { type CompanyDocumentInput, companyDocumentSchema } from "@/app/[org]/finance/company-schema";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isSettledStatus, ORG_DOCUMENT_CATEGORIES, ORG_DOCUMENT_STATUSES, ORG_DOCUMENT_TYPES, type OrgDocumentItem } from "@/domain/company/types";
import type { CompanyProfile } from "@/server/company/profile";
import { cn } from "@/lib/utils";
import { useFinanceFormat } from "./format";

type Member = { id: string; fullName: string };

type Props = {
  slug: string;
  profile: CompanyProfile | null;
  documents: OrgDocumentItem[];
  members: Member[];
  canEdit: boolean;
  canArchive: boolean;
  readOnly?: boolean;
};

const STATUS_TONE: Record<OrgDocumentItem["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  pending_signature: "bg-warning/15 text-warning",
  signed: "bg-success/12 text-success",
  filed: "bg-primary/12 text-primary",
  registered: "bg-success/12 text-success",
  superseded: "bg-muted text-muted-foreground line-through",
};

const NONE = "__none__";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentSheet({
  slug,
  document,
  members,
  onClose,
}: {
  slug: string;
  /** null = subir uno nuevo. */
  document: OrgDocumentItem | null;
  members: Member[];
  onClose: (changed: boolean) => void;
}) {
  const t = useTranslations("finance.company");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const [pending, startTransition] = useTransition();
  const [fileError, setFileError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const form = useForm<CompanyDocumentInput>({
    resolver: zodResolver(companyDocumentSchema),
    values: document
      ? { title: document.title, category: document.category, status: document.status, effective_on: document.effectiveOn ?? "", member_id: document.memberId ?? "", description: document.description ?? "" }
      : { title: "", category: "constitution", status: "draft", effective_on: "", member_id: "", description: "" },
    mode: "onTouched",
  });
  const { control, register, handleSubmit, formState } = form;
  const { errors } = formState;

  const submit = handleSubmit((values) => {
    startTransition(async () => {
      if (document) {
        const result = await updateCompanyDocument(slug, document.id, values);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(t("updatedToast"));
        onClose(true);
        return;
      }
      if (!file) {
        setFileError(t("errors.missingFile"));
        return;
      }
      if (!ORG_DOCUMENT_TYPES[file.type]) {
        setFileError(t("errors.type"));
        return;
      }
      setFileError(null);
      const body = new FormData();
      body.set("file", file);
      for (const [key, value] of Object.entries(values)) body.set(key, value ?? "");
      try {
        const response = await fetch(`/api/company/${slug}/documents`, { method: "POST", body });
        const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          toast.error(payload.error ?? t("errors.uploadFailed"));
          return;
        }
      } catch {
        toast.error(t("errors.uploadFailed"));
        return;
      }
      toast.success(t("uploadedToast"));
      onClose(true);
    });
  });

  return (
    <SettingsSheet open onOpenChange={(open) => !open && onClose(false)} title={document ? t("editTitle") : t("uploadTitle")} description={document ? t("editDescription") : t("uploadDescription")}>
      <SheetForm
        onSubmit={submit}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => onClose(false)} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : document ? tCommon("save") : t("upload")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {!document && (
            <FormField id="doc-file" label={t("fields.file")} description={t("fields.fileHint")} error={fileError ?? undefined}>
              <Input id="doc-file" type="file" accept={Object.keys(ORG_DOCUMENT_TYPES).join(",")} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setFileError(null); }} />
            </FormField>
          )}
          <FormField id="doc-title" label={t("fields.title")} error={message(errors.title?.message)}>
            <Input id="doc-title" maxLength={200} aria-invalid={Boolean(errors.title)} {...register("title")} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <FormField id="doc-category" label={t("fields.category")} error={message(errors.category?.message)}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="doc-category" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORG_DOCUMENT_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {t(`categories.${c}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <FormField id="doc-status" label={t("fields.status")} error={message(errors.status?.message)}>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="doc-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORG_DOCUMENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(`statuses.${s}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="doc-date" label={t("fields.effectiveOn")} description={t("fields.effectiveOnHint")} error={message(errors.effective_on?.message)} optional>
              <Input id="doc-date" type="date" {...register("effective_on")} />
            </FormField>
            <Controller
              control={control}
              name="member_id"
              render={({ field }) => (
                <FormField id="doc-member" label={t("fields.member")} description={t("fields.memberHint")} optional>
                  <Select value={field.value || NONE} onValueChange={(value) => field.onChange(value === NONE ? "" : value)}>
                    <SelectTrigger id="doc-member" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("fields.memberNone")}</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              )}
            />
          </div>
          <FormField id="doc-description" label={t("fields.description")} error={message(errors.description?.message)} optional>
            <Textarea id="doc-description" rows={4} maxLength={5000} {...register("description")} />
          </FormField>
        </div>
      </SheetForm>
    </SettingsSheet>
  );
}

function DocumentRow({ slug, document, members, canEdit, canArchive, onEdit, onChanged }: { slug: string; document: OrgDocumentItem; members: Member[]; canEdit: boolean; canArchive: boolean; onEdit: () => void; onChanged: () => void }) {
  const t = useTranslations("finance.company");
  const { date } = useFinanceFormat();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const member = document.memberId ? members.find((m) => m.id === document.memberId)?.fullName : null;
  const archive = () =>
    startTransition(async () => {
      const result = await archiveCompanyDocument(slug, document.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("archivedToast"));
      setConfirming(false);
      onChanged();
    });
  return (
    <li className={cn("px-4 py-3", isSettledStatus(document.status) ? "" : "bg-warning/[0.04]")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{document.title}</span>
            <Badge className={STATUS_TONE[document.status]}>{t(`statuses.${document.status}`)}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[document.effectiveOn ? date(document.effectiveOn) : null, member, document.fileName, formatBytes(document.sizeBytes)].filter(Boolean).join(" · ")}
          </p>
          {document.description && <p className="mt-1.5 text-sm whitespace-pre-line text-muted-foreground">{document.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <a href={`/api/company/${slug}/documents/${document.id}?download=1`}>
              <Download data-icon="inline-start" />
              {t("download")}
            </a>
          </Button>
          {canEdit && (
            <Button type="button" variant="ghost" size="sm" onClick={onEdit} disabled={pending}>
              <Pencil data-icon="inline-start" />
              {t("edit")}
            </Button>
          )}
          {canArchive && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending || confirming}>
              <Archive data-icon="inline-start" />
              {t("archive")}
            </Button>
          )}
        </div>
      </div>
      {confirming && (
        <InlineConfirm tone="warning" className="mt-3" confirmLabel={t("archive")} onConfirm={archive} onCancel={() => setConfirming(false)} pending={pending}>
          {t("archiveConfirm", { title: document.title })}
        </InlineConfirm>
      )}
    </li>
  );
}

export function CompanyView({ slug, profile, documents, members, canEdit, canArchive, readOnly }: Props) {
  const t = useTranslations("finance.company");
  const { date } = useFinanceFormat();
  const [sheet, setSheet] = useState<{ document: OrgDocumentItem | null } | null>(null);
  const [, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => window.location.reload());

  if (readOnly) return <ReadOnlyNotice>{t("readOnly")}</ReadOnlyNotice>;

  const groups = ORG_DOCUMENT_CATEGORIES.map((category) => ({ category, items: documents.filter((d) => d.category === category) })).filter((g) => g.items.length > 0);
  const open = documents.filter((d) => !isSettledStatus(d.status));

  return (
    <div className="space-y-6">
      <SettingsCard title={t("profileTitle")} description={t("profileDescription")}>
        {profile ? (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold text-muted-foreground uppercase">{t("profile.legalName")}</dt>
              <dd className="font-semibold">{profile.legalName}{profile.tradeName ? <span className="font-normal text-muted-foreground"> · {profile.tradeName}</span> : null}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted-foreground uppercase">{t("profile.taxId")}</dt>
              <dd>{profile.taxId ?? <span className="text-warning">{t("profile.pending")}</span>}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted-foreground uppercase">{t("profile.address")}</dt>
              <dd>{[profile.addressLine, [profile.postalCode, profile.city].filter(Boolean).join(" "), profile.province].filter(Boolean).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted-foreground uppercase">{t("profile.activeFrom")}</dt>
              <dd>{profile.activeFrom ? date(profile.activeFrom) : <span className="text-warning">{t("profile.notYet")}</span>}</dd>
            </div>
            {profile.registryInfo && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-muted-foreground uppercase">{t("profile.registry")}</dt>
                <dd className="whitespace-pre-line">{profile.registryInfo}</dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-muted-foreground uppercase">{t("profile.verifactu")}</dt>
              <dd>{date(profile.verifactuFrom)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("profileEmpty")}</p>
        )}
      </SettingsCard>

      <SettingsCard
        title={t("documentsTitle")}
        description={open.length > 0 ? t("documentsOpen", { count: open.length }) : t("documentsDescription")}
        actions={
          canEdit ? (
            <Button type="button" onClick={() => setSheet({ document: null })}>
              <Upload data-icon="inline-start" />
              {t("upload")}
            </Button>
          ) : undefined
        }
      >
        {documents.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <FileText className="size-6" />
            {t("documentsEmpty")}
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.category}>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <Building2 className="size-3.5" />
                  {t(`categories.${group.category}`)}
                </h3>
                <ul className="divide-y overflow-hidden rounded-xl border">
                  {group.items.map((document) => (
                    <DocumentRow key={document.id} slug={slug} document={document} members={members} canEdit={canEdit} canArchive={canArchive} onEdit={() => setSheet({ document })} onChanged={refresh} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </SettingsCard>

      {sheet && (
        <DocumentSheet
          slug={slug}
          document={sheet.document}
          members={members}
          onClose={(changed) => {
            setSheet(null);
            if (changed) refresh();
          }}
        />
      )}
    </div>
  );
}
