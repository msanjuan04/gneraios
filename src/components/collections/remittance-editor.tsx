"use client";

import { ArrowLeft, Eye, FileCode2, Info, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteRemittance, generateRemittance, previewRemittance, saveRemittanceDraft } from "@/app/[org]/invoices/remittances/actions";
import { useInvoiceFormat } from "@/components/invoices/format";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { FormField } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { checkItem, checkRemittance, formatCreditorId, type ItemCheckInput, sumCents } from "@/domain/collections";
import { addDays } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { CreditorIdBadge } from "./creditor-card";
import { CopyButton, IssueList, RemittanceStatusBadge, SequenceBadge } from "./shared";
import type { DraftRow, RemittanceEditorData, RemittancePreview } from "./types";

const toCheck = (row: DraftRow): ItemCheckInput => ({
  id: row.invoiceId,
  invoiceNumber: row.number,
  amountCents: row.outstandingCents,
  mandate: row.mandate,
});

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Remesa en borrador (o nueva): la fecha de cobro y qué facturas entran, con los avisos de cada
 * una en vivo (mandato, cuenta, importe). Se guarda como borrador, se previsualiza el fichero aunque
 * falte confirmar el ICS y se genera cuando todo está bien.
 */
export function RemittanceEditor({
  slug,
  basePath,
  data,
  canEdit,
}: {
  slug: string;
  basePath: string;
  data: RemittanceEditorData;
  canEdit: boolean;
}) {
  const t = useTranslations("collections.editor");
  const tRoot = useTranslations("collections");
  const { money, date } = useInvoiceFormat();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const initialSelection = useMemo(() => new Set(data.rows.filter((r) => r.selected).map((r) => r.invoiceId)), [data.rows]);
  const [selected, setSelected] = useState<Set<string>>(initialSelection);
  const [collectionOn, setCollectionOn] = useState(data.collectionOn);
  const [notes, setNotes] = useState(data.notes);
  const [saved, setSaved] = useState({
    mode: data.mode,
    updatedAt: data.updatedAt,
    selection: data.mode === "edit" ? initialSelection : new Set<string>(),
    collectionOn: data.collectionOn,
    notes: data.notes,
  });
  const [busy, setBusy] = useState<"save" | "generate" | "preview" | "delete" | null>(null);
  const [preview, setPreview] = useState<RemittancePreview | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(collectionOn);
  const rowIssues = useMemo(
    () => new Map(data.rows.map((r) => [r.invoiceId, validDate ? checkItem(toCheck(r), collectionOn) : []])),
    [data.rows, collectionOn, validDate],
  );
  const chosen = data.rows.filter((r) => selected.has(r.invoiceId));
  const check = validDate
    ? checkRemittance({ today: data.today, collectionOn, creditor: data.creditor.config, items: chosen.map(toCheck) })
    : null;
  const withIssues = chosen.filter((r) => (rowIssues.get(r.invoiceId) ?? []).length > 0);
  const totalCents = sumCents(chosen.map((r) => Math.max(0, r.outstandingCents)));
  const selectable = data.rows.filter((r) => r.otherRemittance === null);
  const allChosen = selectable.length > 0 && selectable.every((r) => selected.has(r.invoiceId));
  const dirty =
    saved.mode === "create" || !sameSet(selected, saved.selection) || collectionOn !== saved.collectionOn || notes !== saved.notes;
  const remittanceHref = `${basePath}/invoices/remittances/${data.remittanceId}`;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Guarda la selección; devuelve la versión guardada (para generar después) o null si falla. */
  const save = async (): Promise<string | null> => {
    const result = await saveRemittanceDraft(slug, {
      remittance_id: data.remittanceId,
      expected_updated_at: saved.mode === "edit" ? saved.updatedAt : null,
      issuer_id: data.issuer.id,
      collection_on: collectionOn,
      notes,
      invoice_ids: chosen.map((r) => r.invoiceId),
    });
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    setSaved({ mode: "edit", updatedAt: result.updatedAt, selection: new Set(selected), collectionOn, notes });
    return result.updatedAt;
  };

  const onSave = () => {
    setBusy("save");
    startTransition(async () => {
      const wasNew = saved.mode === "create";
      const ok = await save();
      setBusy(null);
      if (!ok) return;
      toast.success(t("savedToast"));
      if (wasNew) router.replace(remittanceHref);
    });
  };

  const onGenerate = () => {
    setBusy("generate");
    startTransition(async () => {
      const version = dirty ? await save() : saved.updatedAt;
      if (!version) {
        setBusy(null);
        return;
      }
      const result = await generateRemittance(slug, data.remittanceId, version);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        if (saved.mode === "create") router.replace(remittanceHref);
        return;
      }
      toast.success(t("generatedToast", { id: result.messageId }));
      router.replace(remittanceHref);
      router.refresh();
    });
  };

  const onPreview = () => {
    setBusy("preview");
    startTransition(async () => {
      const result = await previewRemittance(slug, {
        remittance_id: data.remittanceId,
        issuer_id: data.issuer.id,
        collection_on: collectionOn,
        invoice_ids: chosen.map((r) => r.invoiceId),
      });
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.preview);
    });
  };

  const onDelete = () => {
    setBusy("delete");
    startTransition(async () => {
      const result = await deleteRemittance(slug, data.remittanceId);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deletedToast"));
      router.push(`${basePath}/invoices/remittances`);
    });
  };

  const creditorIssues = check?.creditor.issues ?? data.creditor.issues;
  const blockingReason = !check
    ? t("blocked.date")
    : chosen.length === 0
      ? t("blocked.empty")
      : check.creditor.source !== "confirmed"
        ? t("blocked.creditor")
        : withIssues.length > 0
          ? t("blocked.items", { count: withIssues.length })
          : check.issues.length > 0 || check.creditor.issues.length > 0
            ? t("blocked.remittance")
            : null;

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        href={`${basePath}/invoices/remittances`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {tRoot("back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-3xl font-extrabold heading-tight md:text-4xl">
              {saved.mode === "create" ? t("titleNew") : t("title", { date: date(saved.collectionOn) })}
            </h2>
            {saved.mode === "edit" && <RemittanceStatusBadge status="draft" />}
          </div>
          <p className="mt-2 text-muted-foreground">{t("subtitle", { issuer: data.issuer.name })}</p>
        </div>
        {canEdit && saved.mode === "edit" && !confirmDelete && (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
            <Trash2 data-icon="inline-start" />
            {t("delete")}
          </Button>
        )}
      </header>

      {confirmDelete && (
        <InlineConfirm
          tone="destructive"
          className="mb-6"
          confirmLabel={busy === "delete" ? t("deleting") : t("deleteConfirmAction")}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
          pending={busy === "delete"}
        >
          {t("deleteConfirm")}
        </InlineConfirm>
      )}
      {!canEdit && <ReadOnlyNotice className="mb-6">{tRoot("readOnly")}</ReadOnlyNotice>}

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <SettingsCard title={t("settingsTitle")}>
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <FormField
              id="remittance-date"
              label={t("collectionOn")}
              description={t("collectionOnHint")}
              error={check?.issues.includes("collectionDatePast") ? t("dateInPast") : undefined}
            >
              <Input
                id="remittance-date"
                type="date"
                min={addDays(data.today, 1)}
                value={collectionOn}
                onChange={(e) => setCollectionOn(e.target.value)}
                disabled={!canEdit}
                className="tabular"
              />
            </FormField>
            <FormField id="remittance-notes" label={t("notes")} optional>
              <Input
                id="remittance-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                disabled={!canEdit}
                placeholder={t("notesPlaceholder")}
              />
            </FormField>
          </div>
          {check && <IssueList issues={check.warnings} tone="warning" className="mt-3" />}
        </SettingsCard>

        <SettingsCard title={t("creditorTitle")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono">
              {data.creditor.creditorId ? formatCreditorId(data.creditor.creditorId) : "—"}
            </span>
            <CreditorIdBadge source={check?.creditor.source ?? data.creditor.source} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{data.creditor.config.name}</p>
          <IssueList issues={creditorIssues} tone={creditorIssues.every((i) => i === "creditorIdUnconfirmed") ? "warning" : "destructive"} className="mt-3" />
          {creditorIssues.length > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-px size-3.5 shrink-0 text-primary" />
              <span>
                {t.rich("creditorHelp", {
                  link: (chunks) => (
                    <Link href={`${basePath}/invoices/remittances`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </p>
          )}
        </SettingsCard>
      </div>

      <SettingsCard
        title={t("rowsTitle")}
        description={t("rowsDescription", { count: data.rows.length })}
        bodyClassName={data.rows.length > 0 ? "p-0" : undefined}
        actions={
          canEdit && selectable.length > 0 ? (
            <label className="flex h-7 cursor-pointer items-center gap-2 rounded-full px-2 text-[0.8rem] font-semibold text-muted-foreground hover:text-foreground">
              <Checkbox
                checked={allChosen ? true : chosen.length > 0 ? "indeterminate" : false}
                onCheckedChange={() => setSelected(allChosen ? new Set() : new Set(selectable.map((r) => r.invoiceId)))}
                aria-label={t("selectAll")}
              />
              {t("selectAll")}
            </label>
          ) : undefined
        }
      >
        {data.rows.length === 0 ? (
          <div className="py-4 text-center">
            <p className="font-semibold">{t("emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-lg text-muted-foreground">{t("emptyBody")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-5" />
                  <TableHead className="text-xs text-muted-foreground">{t("columns.invoice")}</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t("columns.client")}</TableHead>
                  <TableHead className="hidden text-xs text-muted-foreground md:table-cell">{t("columns.due")}</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">{t("columns.amount")}</TableHead>
                  <TableHead className="pr-5 text-xs text-muted-foreground">{t("columns.mandate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => {
                  const issues = rowIssues.get(row.invoiceId) ?? [];
                  const isSelected = selected.has(row.invoiceId);
                  const blocked = row.otherRemittance !== null;
                  const due = row.dueOn !== null && validDate && row.dueOn <= collectionOn;
                  return (
                    <TableRow
                      key={row.invoiceId}
                      data-state={isSelected ? "selected" : undefined}
                      className={cn("align-top data-[state=selected]:bg-primary/5", blocked && "opacity-60")}
                    >
                      <TableCell className="w-10 pt-3 pl-5">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggle(row.invoiceId)}
                          disabled={!canEdit || blocked}
                          aria-label={t("selectRow", { number: row.number ?? "", client: row.clientName })}
                        />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <Link href={`${basePath}/invoices/${row.invoiceId}`} className="font-mono font-semibold hover:text-primary">
                          {row.number ?? "—"}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <InvoiceStatusBadge status={row.invoiceStatus} />
                          {row.paymentMethod !== "sepa_debit" && (
                            <span className="text-[11px] text-muted-foreground">{t("otherMethod")}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-56 py-2.5">
                        <Link href={`${basePath}/clients/${row.clientId}`} className="block truncate font-medium hover:text-primary">
                          {row.clientName}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden py-2.5 tabular md:table-cell">
                        {row.dueOn ? (
                          <span className={cn(due ? "text-foreground" : "text-muted-foreground")}>{date(row.dueOn)}</span>
                        ) : (
                          "—"
                        )}
                        {row.dueOn && !due && <p className="text-[11px] text-muted-foreground">{t("notDueYet")}</p>}
                      </TableCell>
                      <TableCell className="py-2.5 text-right font-semibold tabular">{money(row.outstandingCents)}</TableCell>
                      <TableCell className="min-w-52 py-2.5 pr-5">
                        {row.mandate && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs">{row.mandate.reference}</span>
                            <SequenceBadge sequence={row.mandate.nextSequence} />
                          </div>
                        )}
                        {blocked && row.otherRemittance && (
                          <p className="text-xs text-muted-foreground">
                            {t.rich("inOther", {
                              date: date(row.otherRemittance.collectionOn),
                              link: (chunks) => (
                                <Link
                                  href={`${basePath}/invoices/remittances/${row.otherRemittance!.id}`}
                                  className="font-semibold text-foreground underline-offset-4 hover:underline"
                                >
                                  {chunks}
                                </Link>
                              ),
                            })}
                          </p>
                        )}
                        <IssueList issues={issues} tone={isSelected ? "destructive" : "warning"} className="mt-1" />
                        {issues.includes("mandateMissing") && (
                          <Link
                            href={`${basePath}/clients/${row.clientId}`}
                            className="mt-1 inline-block text-xs font-semibold text-primary underline-offset-4 hover:underline"
                          >
                            {t("addMandate")}
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SettingsCard>

      {canEdit && (
        <div className="sticky bottom-4 z-20 mt-6 rounded-2xl border bg-background/80 shadow-lg backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold tabular">{t("footer", { count: chosen.length, amount: money(totalCents) })}</p>
              {blockingReason && <p className="truncate text-xs text-muted-foreground">{blockingReason}</p>}
            </div>
            <Button variant="ghost" onClick={onPreview} disabled={busy !== null || chosen.length === 0 || !check?.canPreview}>
              <Eye data-icon="inline-start" />
              {busy === "preview" ? t("previewing") : t("preview")}
            </Button>
            <Button variant="outline" onClick={onSave} disabled={busy !== null || !validDate || !dirty}>
              <Save data-icon="inline-start" />
              {busy === "save" ? t("saving") : t("save")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button onClick={onGenerate} disabled={busy !== null || !check?.canGenerate}>
                    <FileCode2 data-icon="inline-start" />
                    {busy === "generate" ? t("generating") : t("generate")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{blockingReason ?? t("generateHint")}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      <PreviewSheet preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/** El XML de la vista previa, para revisarlo o validarlo; nunca es el fichero definitivo si el ICS no está confirmado. */
function PreviewSheet({ preview, onClose }: { preview: RemittancePreview | null; onClose: () => void }) {
  const t = useTranslations("collections.preview");
  const { money } = useInvoiceFormat();
  return (
    <SettingsSheet
      open={preview !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("title")}
      description={preview ? t("description", { count: preview.included, amount: money(preview.totalCents) }) : undefined}
    >
      {preview && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          {preview.creditorIdSource !== "confirmed" && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{t("unconfirmed")}</p>
          )}
          {preview.excluded > 0 && <p className="text-xs text-muted-foreground">{t("excluded", { count: preview.excluded })}</p>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">pain.008.001.02</p>
            <CopyButton value={preview.xml} label={t("copy")} />
          </div>
          <pre className="min-h-0 flex-1 overflow-auto rounded-xl border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
            {preview.xml}
          </pre>
        </div>
      )}
    </SettingsSheet>
  );
}
