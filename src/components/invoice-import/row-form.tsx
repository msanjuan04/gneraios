"use client";

import { CircleAlert, ExternalLink, Eye, EyeOff, ListPlus, Lock, Sparkles, TriangleAlert, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInvoiceFormat } from "@/components/invoices/format";
import { OptionSelect } from "@/components/projects/fields";
import { FormField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bpsToInput, defaultDueOn, type FormIssue, type ImportForm, newClientTaxIdValid } from "@/domain/invoice-import/form";
import { type ImportSetup, taxIdKey } from "@/domain/invoice-import/match";
import type { Confidence } from "@/domain/invoice-import/types";
import { cn } from "@/lib/utils";
import { checkExistingInvoice } from "@/server/invoice-import/actions";
import { ClientSelect } from "./client-select";
import { ConfidenceDot } from "./confidence";
import { LinesEditor } from "./lines-editor";
import { PaymentFields } from "./payment-fields";
import type { ExistingInvoice } from "./types";
import type { ImportItem, RowView } from "./use-invoice-import";

/** El PDF de la fila, para verlo junto al formulario o abrirlo en otra pestaña. */
export function usePdfUrl(file: File, active: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const created = URL.createObjectURL(file);
    // El PDF solo existe en el navegador: se enseña con una URL local mientras se revisa.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(created);
    return () => {
      URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [file, active]);
  return url;
}

export function PdfToggle({ file }: { file: File }) {
  const t = useTranslations("invoiceImport.row");
  const [show, setShow] = useState(false);
  const url = usePdfUrl(file, show);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="xs" onClick={() => setShow((v) => !v)}>
          {show ? <EyeOff data-icon="inline-start" /> : <Eye data-icon="inline-start" />}
          {show ? t("hidePdf") : t("viewPdf")}
        </Button>
        {url && (
          <Button asChild variant="ghost" size="xs">
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink data-icon="inline-start" />
              {t("openPdf")}
            </a>
          </Button>
        )}
      </div>
      {show && url && <iframe src={url} title={file.name} className="h-[60vh] min-h-[420px] w-full rounded-xl border bg-white" />}
    </div>
  );
}

const confidenceOf = (item: ImportItem, field: string, value: Confidence | null | undefined) => (item.edited.includes(field) ? null : (value ?? null));

export function RowForm({
  slug,
  item,
  view,
  setup,
  lockedClient,
  onUpdate,
  onSave,
  onRemove,
  onCreateClient,
  onNumberTaken,
  creatingClient,
  canCreateSeries,
  onCreateSeries,
  creatingSeries,
}: {
  slug: string;
  item: ImportItem;
  view: RowView;
  setup: ImportSetup;
  lockedClient: { id: string; name: string } | null;
  onUpdate: (field: string, fn: (form: ImportForm) => ImportForm) => void;
  onSave: () => void;
  onRemove: () => void;
  onCreateClient: () => void;
  onNumberTaken: (existing: ExistingInvoice | null) => void;
  creatingClient: boolean;
  /** Owner: puede crear aquí la serie que falta (si no, se dice a quién pedírsela). */
  canCreateSeries: boolean;
  onCreateSeries: (format: string) => void;
  creatingSeries: boolean;
}) {
  const t = useTranslations("invoiceImport.form");
  const tClient = useTranslations("invoiceImport.client");
  const tIssue = useTranslations("invoiceImport.issues");
  const tWarning = useTranslations("invoiceImport.warnings");
  const tRow = useTranslations("invoiceImport.row");
  const tTotals = useTranslations("invoiceImport.totals");
  const { money, date } = useInvoiceFormat();
  const [editClient, setEditClient] = useState(false);
  const form = item.form!;
  const extraction = item.extraction!;
  const totals = view.totals;
  const saving = item.phase === "saving";

  // ¿Otra factura del emisor con el número que se ha escrito? Solo si el socio los ha cambiado.
  const checkedFor = useRef<string | null>(null);
  const touchedNumber = item.edited.includes("number") || item.edited.includes("issuer");
  useEffect(() => {
    if (!touchedNumber || !form.issuerId || !form.number.trim()) return;
    const key = `${form.issuerId}|${form.number.trim()}`;
    if (checkedFor.current === key) return;
    const timer = setTimeout(async () => {
      checkedFor.current = key;
      const result = await checkExistingInvoice(slug, form.issuerId, form.number.trim());
      onNumberTaken(result.ok ? result.existing : null);
    }, 450);
    return () => clearTimeout(timer);
  }, [form.issuerId, form.number, onNumberTaken, slug, touchedNumber]);

  const message = (issue: FormIssue) => {
    const params = { ...issue.params };
    if (issue.code === "pdf_total_mismatch") {
      params.pdf = money(Number(issue.params?.pdf ?? 0));
      params.computed = money(Number(issue.params?.computed ?? 0));
    }
    if (issue.code === "partial_amount") params.total = money(Number(issue.params?.total ?? 0));
    return tIssue(issue.code, params);
  };
  const errorOf = (field: string) => {
    const issue = view.issues.find((i) => i.field === field && i.severity === "error");
    return issue ? message(issue) : undefined;
  };
  const invalid = useMemo(() => new Set(view.issues.filter((i) => i.severity === "error" && i.field).map((i) => i.field!)), [view.issues]);

  const issuers = [...setup.issuers].sort((a, b) => Number(a.archived) - Number(b.archived));
  const series = setup.series.filter((s) => s.issuerId === form.issuerId).sort((a, b) => Number(a.archived) - Number(b.archived));
  const client = setup.clients.find((c) => c.id === form.clientId) ?? null;
  const pdfTaxId = taxIdKey(extraction.recipient.taxId?.value);
  const taxIdMismatch = client?.taxId && pdfTaxId && taxIdKey(client.taxId) !== pdfTaxId && !(item.matches?.issuer.swapped ?? false);
  const numberIssue = view.issues.find((i) => i.code === "number_format");
  const dueDefault = defaultDueOn(form, setup);
  const irpfOptions = [...new Set([0, ...setup.irpfRates.map((r) => r.rateBps), form.irpfBps])].sort((a, b) => a - b);
  const warnings = extraction.warnings;
  // En la lista: los avisos, los errores sin campo y los de las líneas (en la tabla solo se marcan en rojo).
  const generalIssues = view.issues.filter((i) => !i.field || i.field === "total" || i.field.startsWith("lines") || i.severity === "warning");
  const draft = form.newClient;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          {item.engine === "claude" ? tRow("engineClaude") : tRow("engineText")}
        </span>
        <PdfToggle file={item.file} />
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
              {tWarning(w)}
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2">
        {lockedClient ? (
          <FormField label={t("client")}>
            <p className="flex h-8 items-center gap-2 font-semibold">
              <Lock className="size-3.5 text-muted-foreground" />
              {lockedClient.name}
            </p>
          </FormField>
        ) : (
          <FormField
            id={`${item.id}-client`}
            label={
              <span className="inline-flex items-center gap-1.5">
                {t("client")}
                <ConfidenceDot value={confidenceOf(item, "client", item.matches?.client?.confidence)} />
              </span>
            }
            error={errorOf("client")}
          >
            <ClientSelect
              id={`${item.id}-client`}
              clients={setup.clients}
              value={form.clientId}
              invalid={invalid.has("client")}
              onChange={(clientId) => onUpdate("client", (f) => ({ ...f, clientId }))}
            />
          </FormField>
        )}
        {taxIdMismatch && (
          <p className="flex items-start gap-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {tClient("taxIdMismatch", { pdf: pdfTaxId, client: client!.taxId! })}
          </p>
        )}
        {!form.clientId && draft && !lockedClient && (
          <div className="rounded-xl border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground">
                {draft.taxId ? tClient("missing", { taxId: draft.taxId }) : tClient("missingNoTaxId")}
              </p>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditClient((v) => !v)}>
                  {tClient("edit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={onCreateClient}
                  disabled={creatingClient || !draft.name.trim() || !newClientTaxIdValid(draft)}
                >
                  <UserPlus data-icon="inline-start" />
                  {creatingClient ? tClient("creating") : tClient("create", { name: draft.name })}
                </Button>
              </div>
            </div>
            {editClient && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["name", tClient("name")],
                    ["legalName", tClient("legalName")],
                    ["taxId", tClient("taxId")],
                    ["address", tClient("address")],
                    ["postalCode", tClient("postalCode")],
                    ["city", tClient("city")],
                    ["province", tClient("province")],
                    ["countryCode", tClient("country")],
                  ] as const
                ).map(([key, label]) => (
                  <FormField key={key} id={`${item.id}-nc-${key}`} label={label} error={key === "taxId" && !newClientTaxIdValid(draft) ? tClient("taxIdInvalid") : undefined}>
                    <Input
                      id={`${item.id}-nc-${key}`}
                      value={draft[key]}
                      maxLength={key === "countryCode" ? 2 : 200}
                      onChange={(e) =>
                        onUpdate("newClient", (f) => (f.newClient ? { ...f, newClient: { ...f.newClient, [key]: key === "countryCode" ? e.target.value.toUpperCase() : e.target.value } } : f))
                      }
                    />
                  </FormField>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <FormField
          id={`${item.id}-issuer`}
          label={
            <span className="inline-flex items-center gap-1.5">
              {t("issuer")}
              <ConfidenceDot value={confidenceOf(item, "issuer", item.matches?.issuer.confidence)} />
            </span>
          }
          error={errorOf("issuer")}
        >
          <OptionSelect
            id={`${item.id}-issuer`}
            value={form.issuerId}
            invalid={invalid.has("issuer")}
            onChange={(issuerId) =>
              onUpdate("issuer", (f) => {
                const next = setup.series.find((s) => s.issuerId === issuerId && s.isDefault && !s.archived) ?? setup.series.find((s) => s.issuerId === issuerId);
                return { ...f, issuerId, seriesId: next?.id ?? "" };
              })
            }
            options={issuers.map((i) => ({ value: i.id, label: i.name, hint: i.taxId ?? undefined }))}
          />
        </FormField>
        <FormField id={`${item.id}-series`} label={t("series")} error={errorOf("series")}>
          <OptionSelect
            id={`${item.id}-series`}
            value={form.seriesId}
            invalid={invalid.has("series")}
            onChange={(seriesId) => onUpdate("series", (f) => ({ ...f, seriesId }))}
            options={series.map((s) => ({ value: s.id, label: s.code, hint: `${s.format}${s.archived ? ` · ${t("archived")}` : ""}` }))}
          />
        </FormField>
        <FormField
          id={`${item.id}-number`}
          label={
            <span className="inline-flex items-center gap-1.5">
              {t("number")}
              <ConfidenceDot value={confidenceOf(item, "number", item.matches?.series ? "high" : extraction.number?.confidence)} />
            </span>
          }
          error={errorOf("number")}
        >
          <Input
            id={`${item.id}-number`}
            value={form.number}
            maxLength={40}
            aria-invalid={invalid.has("number")}
            className="font-mono"
            onChange={(e) => onUpdate("number", (f) => ({ ...f, number: e.target.value }))}
          />
        </FormField>
        {numberIssue?.params?.suggested ? (
          // El número es el de la factura y no se cambia: lo que falta es una serie con su formato.
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm sm:col-span-full">
            <span className="min-w-0 flex-1">
              {tIssue(canCreateSeries ? "number_format_create" : "number_format_ask", { suggested: String(numberIssue.params.suggested) })}
            </span>
            {canCreateSeries && (
              <Button type="button" size="xs" onClick={() => onCreateSeries(String(numberIssue.params!.suggested))} disabled={creatingSeries}>
                <ListPlus data-icon="inline-start" />
                {creatingSeries ? tIssue("number_format_creating") : tIssue("number_format_button", { suggested: String(numberIssue.params.suggested) })}
              </Button>
            )}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        <FormField
          id={`${item.id}-issued`}
          label={
            <span className="inline-flex items-center gap-1.5">
              {t("issuedOn")}
              <ConfidenceDot value={confidenceOf(item, "issuedOn", extraction.issuedOn?.confidence)} />
            </span>
          }
          error={errorOf("issuedOn")}
        >
          <Input
            id={`${item.id}-issued`}
            type="date"
            value={form.issuedOn}
            aria-invalid={invalid.has("issuedOn")}
            onChange={(e) => onUpdate("issuedOn", (f) => ({ ...f, issuedOn: e.target.value }))}
          />
        </FormField>
        <FormField id={`${item.id}-operation`} label={t("operationOn")} optional error={errorOf("operationOn")}>
          <Input id={`${item.id}-operation`} type="date" value={form.operationOn} onChange={(e) => onUpdate("operationOn", (f) => ({ ...f, operationOn: e.target.value }))} />
        </FormField>
        <FormField
          id={`${item.id}-due`}
          label={
            <span className="inline-flex items-center gap-1.5">
              {t("dueOn")}
              <ConfidenceDot value={confidenceOf(item, "dueOn", extraction.dueOn?.confidence)} />
            </span>
          }
          optional
          error={errorOf("dueOn")}
          description={!form.dueOn && dueDefault ? t("dueDefault", { date: date(dueDefault) }) : undefined}
        >
          <Input id={`${item.id}-due`} type="date" value={form.dueOn} onChange={(e) => onUpdate("dueOn", (f) => ({ ...f, dueOn: e.target.value }))} />
        </FormField>
        <FormField
          id={`${item.id}-irpf`}
          label={
            <span className="inline-flex items-center gap-1.5">
              {t("irpf")}
              <ConfidenceDot value={confidenceOf(item, "irpf", extraction.irpfBps?.confidence)} />
            </span>
          }
        >
          <OptionSelect
            id={`${item.id}-irpf`}
            value={String(form.irpfBps)}
            onChange={(v) => onUpdate("irpf", (f) => ({ ...f, irpfBps: Number(v), lines: f.lines.map((l) => ({ ...l, irpfApplies: Number(v) > 0 })) }))}
            options={irpfOptions.map((bps) => ({ value: String(bps), label: bps === 0 ? t("noIrpf") : `${bpsToInput(bps)} %` }))}
          />
        </FormField>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("lines")}</h4>
        <LinesEditor
          idPrefix={item.id}
          lines={form.lines}
          computed={totals?.lines ?? []}
          vatRates={setup.vatRates}
          irpf={form.irpfBps > 0}
          invalid={invalid}
          onChange={(lines) => onUpdate("lines", (f) => ({ ...f, lines }))}
        />
      </section>

      {totals && (
        <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("payment")}</h4>
            <PaymentFields
              idPrefix={item.id}
              value={form.payment}
              onChange={(patch) => onUpdate(patch.paidOn !== undefined ? "paidOn" : "payment", (f) => ({ ...f, payment: { ...f.payment, ...patch } }))}
              totalCents={totals.totalCents}
              issuedOn={form.issuedOn}
              dueOn={form.dueOn || dueDefault || ""}
              paidOnConfidence={form.payment.paidOn && form.payment.paidOn === extraction.paidOn?.value ? confidenceOf(item, "paidOn", extraction.paidOn.confidence) : null}
              errors={{ paidOn: errorOf("paidOn"), amount: errorOf("paidAmount") }}
            />
          </div>
          <dl className="space-y-1.5 rounded-xl border bg-muted/30 p-3 text-sm">
            <Row label={tTotals("base")} value={money(totals.subtotalCents)} />
            <Row label={tTotals("vat")} value={money(totals.vatCents)} />
            {totals.irpfCents !== 0 && <Row label={tTotals("irpf")} value={money(-totals.irpfCents)} />}
            <Row label={tTotals("total")} value={money(totals.totalCents)} strong />
            <div className="border-t pt-1.5 text-xs">
              {form.pdf.totalCents === null ? (
                <p className="text-warning">{tTotals("noPdf")}</p>
              ) : totals.pdfDiffCents === 0 ? (
                <p className="text-success">{tTotals("matches", { total: money(form.pdf.totalCents) })}</p>
              ) : (
                <p className="text-destructive">{tTotals("differs", { pdf: money(form.pdf.totalCents), computed: money(totals.totalCents) })}</p>
              )}
              {totals.adjustedCents > 0 && <p className="mt-1 text-muted-foreground">{tTotals("adjusted", { count: totals.adjustedCents })}</p>}
            </div>
          </dl>
        </section>
      )}

      {(generalIssues.length > 0 || item.error) && (
        <ul className="space-y-1 text-sm">
          {item.error && (
            <li className="flex items-start gap-2 text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {item.error}
            </li>
          )}
          {generalIssues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} className={cn("flex items-start gap-2", issue.severity === "error" ? "text-destructive" : "text-warning")}>
              {issue.severity === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
              {message(issue)}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <Button type="button" variant="ghost" onClick={onRemove} disabled={saving}>
          {t("discard")}
        </Button>
        <Button type="button" onClick={onSave} disabled={saving || view.issues.some((i) => i.severity === "error")}>
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn(strong ? "font-semibold" : "text-muted-foreground")}>{label}</dt>
      <dd className={cn("tabular", strong ? "font-bold" : "font-semibold")}>{value}</dd>
    </div>
  );
}
