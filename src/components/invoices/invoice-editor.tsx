"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CircleAlert, FileSignature, Hash, Lock, Save, Send, Trash2, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { deleteDraft, issueDrafts, prepareIssue, saveInvoiceDraft } from "@/app/[org]/invoices/actions";
import {
  BILLING_TYPES,
  type DraftFormInput,
  draftFormSchema,
  type DraftFormValues,
  type DraftLineInput,
  PAYMENT_METHODS,
  parseDiscountInput,
  parseQuantityInput,
} from "@/app/[org]/invoices/schema";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { ClientPicker } from "@/components/crm/client-picker";
import { FormField } from "@/components/settings/form-field";
import { CatalogPicker } from "@/components/catalog/catalog-picker";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDays } from "@/domain/dates/civil-date";
import { defaultIrpfBps } from "@/domain/invoicing/draft-line";
import { formatInvoiceNumber } from "@/domain/invoicing/number-format";
import { parseMoneyInput } from "@/domain/money";
import { computeLine, type LineAmounts } from "@/domain/tax";
import { localeNames, locales } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { EditorLines, type RemovedLine } from "./editor-lines";
import { useInvoiceFormat, useInvoiceValidationMessage } from "./format";
import { InlineConfirm } from "./inline-confirm";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { InvoiceTotals, type TotalsLine } from "./invoice-totals";
import { PdfPreview } from "./pdf-preview";
import type { DraftEditorData, EditorIssuer, EditorSeries, EditorTaxRate } from "./types";
import { VerifactuBanner, verifactuBlocks } from "./verifactu-banner";

const DEFAULT_SERIES = "__default";

/** Id de una línea nueva, estable entre guardados (así conserva su sitio y su pendiente). */
function newLineId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fuera de un contexto seguro (http en la red local) no hay randomUUID: UUID v4 a mano.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Importes de una línea con lo escrito ahora; null si falta algo por completar. */
function lineAmounts(line: DraftLineInput | undefined, rate: EditorTaxRate | undefined, irpfBps: number): LineAmounts | null {
  if (!line || !rate) return null;
  const quantity = parseQuantityInput(line.quantity ?? "");
  const price = parseMoneyInput(line.unit_price ?? "");
  const discount = parseDiscountInput(line.discount ?? "");
  if (quantity === null || price === null || discount === null) return null;
  try {
    return computeLine({
      quantity,
      unitPriceCents: price,
      discountBps: discount,
      vatBps: rate.rateBps,
      irpfBps,
      irpfApplies: Boolean(line.irpf_applies),
    });
  } catch {
    return null;
  }
}

/** Número que llevaría con la serie y la fecha de ahora (el mismo cálculo que invoice_next_number). */
function previewNumber(series: EditorSeries | null, issuer: EditorIssuer | null, issueDate: string): string | null {
  if (!series || !issuer || issuer.fiscalProvider !== "internal") return null;
  const year = Number(issueDate.slice(0, 4));
  const last = series.lastByYear[series.resetYearly ? year : 0] ?? 0;
  try {
    return formatInvoiceNumber(series.format, year, last + 1);
  } catch {
    return null;
  }
}

function safeAddDays(date: string, days: number | null): string | null {
  if (days === null) return null;
  try {
    return addDays(date, days);
  } catch {
    return null;
  }
}

type Confirm = { kind: "issue"; number: string | null; issuedOn: string; version: string | null } | { kind: "delete" } | null;
type Activity = "save" | "issue" | "delete" | null;

type Props = {
  slug: string;
  basePath: string;
  /** Hoy en la zona de la org (YYYY-MM-DD). */
  today: string;
  /** Socio u owner: puede editar, emitir y borrar. */
  canEdit: boolean;
  data: DraftEditorData;
};

/**
 * Editor de un borrador (o de una factura manual nueva): cabecera, líneas con sus totales en
 * vivo, vista previa del PDF y las acciones Guardar (⌘S), Emitir y Borrar. Los importes se
 * calculan aquí solo para verlos: al guardar, el servidor los recalcula con el dominio.
 */
export function InvoiceEditor({ slug, basePath, today, canEdit, data }: Props) {
  const t = useTranslations("invoices.editor");
  const tCommon = useTranslations("common");
  const tPayment = useTranslations("billing.paymentMethod");
  const tErrors = useTranslations("billing.errors");
  const tFields = useTranslations("billing.fiscalFields");
  const tKind = useTranslations("billing.invoiceKind");
  const { percent, date } = useInvoiceFormat();
  const message = useInvoiceValidationMessage();
  const router = useRouter();
  const { context } = data;
  const creating = context.mode === "create";
  const locked = context.lockParties;

  const schema = useMemo(
    () => draftFormSchema({ kind: context.kind, today, minLines: creating ? 1 : 0 }),
    [context.kind, today, creating],
  );
  const form = useForm<DraftFormInput, unknown, DraftFormValues>({
    resolver: zodResolver(schema),
    defaultValues: data.defaults,
    mode: "onTouched",
  });
  const { control, register, getValues, setValue, handleSubmit, reset, formState } = form;
  const fieldArray = useFieldArray({ control, name: "lines", keyName: "key" });

  const [version, setVersion] = useState(context.updatedAt);
  const [removed, setRemoved] = useState<RemovedLine[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [activity, setActivity] = useState<Activity>(null);
  const [, startTransition] = useTransition();
  const busy = activity !== null;

  const watchedLines = useWatch({ control, name: "lines" });
  const invoiceLanguage = useWatch({ control, name: "language" });
  const [issuerId, clientId, seriesId, issuedOn, dueMode, dueOn, paymentTerms, irpfValue] = useWatch({
    control,
    name: ["issuer_id", "client_id", "series_id", "issued_on", "due_mode", "due_on", "payment_terms_days", "irpf_bps"],
  });

  const issuer = data.issuers.find((i) => i.id === issuerId) ?? null;
  const client = data.clients.find((c) => c.id === clientId) ?? null;
  const irpfBps = Number(irpfValue) || 0;

  // Totales en vivo, con la misma implementación del redondeo que usará el servidor.
  const rateById = new Map(data.vatRates.map((r) => [r.id, r]));
  const lines = watchedLines ?? [];
  const amounts = lines.map((line) => lineAmounts(line, rateById.get(line?.tax_rate_id ?? ""), irpfBps));
  const totalsLines: TotalsLine[] = lines.flatMap((line, index) => {
    const amount = amounts[index];
    const rate = rateById.get(line?.tax_rate_id ?? "");
    if (!amount || !rate) return [];
    return [
      {
        baseCents: amount.baseCents,
        vatCents: amount.vatCents,
        irpfCents: amount.irpfCents,
        vatBps: rate.rateBps,
        vatRegime: rate.regime,
        billingType: BILLING_TYPES.find((b) => b === line?.billing_type) ?? null,
      },
    ];
  });
  const legalNotes = [
    ...new Set(lines.map((l) => rateById.get(l?.tax_rate_id ?? "")?.legalNote?.trim()).filter((n): n is string => Boolean(n))),
  ];

  const seriesOptions = data.series.filter((s) => s.issuerId === issuerId && s.kind === context.kind);
  const defaultSeries = seriesOptions.find((s) => s.isDefault) ?? null;
  const selectedSeries = seriesId ? (data.series.find((s) => s.id === seriesId) ?? null) : defaultSeries;
  const issueDate = issuedOn || today;
  const nextNumber = previewNumber(selectedSeries, issuer, issueDate);

  const defaultTerms = client?.paymentTermsDays ?? data.orgPaymentTermsDays;
  const termsText = paymentTerms.trim();
  const termsDays = /^\d{1,3}$/.test(termsText) ? Number(termsText) : termsText === "" ? defaultTerms : null;
  const dueDate = dueMode === "date" ? dueOn || null : safeAddDays(issueDate, termsDays);
  const irpfDefault =
    issuer && client
      ? defaultIrpfBps(
          { defaultIrpfBps: issuer.defaultIrpfBps },
          { isBusiness: client.isBusiness, taxIdKind: client.taxIdKind, countryCode: client.countryCode },
        )
      : null;

  const irpfOptions: { bps: number; name: string }[] = [];
  for (const option of [{ bps: 0, name: t("irpfNone") }, ...data.irpfRates, { bps: irpfBps, name: percent(irpfBps) }]) {
    if (!irpfOptions.some((o) => o.bps === option.bps)) irpfOptions.push(option);
  }

  const dirty = formState.isDirty || removed.length > 0;
  const blocked = verifactuBlocks(issuer, today);
  const missing = [...(issuer?.missing ?? []), ...(client?.missing ?? [])];
  const lineCount = fieldArray.fields.length;

  // Avisa antes de salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty || !canEdit) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, canEdit]);

  const notifyFailure = (error: string) => {
    if (error === tErrors("draftChanged")) {
      toast.error(error, { action: { label: t("reload"), onClick: () => window.location.reload() } });
    } else toast.error(error);
  };

  const applyIrpfDefault = (nextIssuer: string, nextClient: string) => {
    const i = data.issuers.find((x) => x.id === nextIssuer);
    const c = data.clients.find((x) => x.id === nextClient);
    if (!i || !c) return;
    const bps = defaultIrpfBps(
      { defaultIrpfBps: i.defaultIrpfBps },
      { isBusiness: c.isBusiness, taxIdKind: c.taxIdKind, countryCode: c.countryCode },
    );
    setValue("irpf_bps", String(bps), { shouldDirty: true });
  };

  /** Guarda (o crea) el borrador. Devuelve el id y la versión nueva, o null si no se pudo. */
  const persist = async (): Promise<{ id: string; updatedAt: string } | null> => {
    const out: { saved: { id: string; updatedAt: string } | null } = { saved: null };
    await handleSubmit(
      async () => {
        const values = getValues();
        const result = await saveInvoiceDraft(slug, context.invoiceId, values, {
          expectedUpdatedAt: version,
          waiveLineIds: removed.filter((r) => r.waive).map((r) => r.line.id),
        });
        if (!result.ok) {
          notifyFailure(result.error);
          return;
        }
        out.saved = { id: result.id, updatedAt: result.updatedAt };
        if (!creating) {
          setVersion(result.updatedAt);
          setRemoved([]);
          reset(values, { keepValues: true });
        }
      },
      () => toast.error(t("invalid")),
    )();
    return out.saved;
  };

  const onSave = () => {
    if (!canEdit || busy || (!creating && !dirty)) return;
    setActivity("save");
    startTransition(async () => {
      const saved = await persist();
      if (!saved) {
        setActivity(null);
        return;
      }
      if (creating) {
        toast.success(t("createdToast"));
        router.push(`${basePath}/invoices/${saved.id}`);
        return;
      }
      setActivity(null);
      toast.success(t("savedToast"));
    });
  };

  const onIssue = () => {
    const invoiceId = context.invoiceId;
    if (!invoiceId || !canEdit || busy) return;
    setIssueError(null);
    setActivity("issue");
    startTransition(async () => {
      let current = version;
      if (dirty) {
        const saved = await persist();
        if (!saved) {
          setActivity(null);
          return;
        }
        current = saved.updatedAt;
      }
      const prepared = await prepareIssue(slug, invoiceId, current);
      setActivity(null);
      if (!prepared.ok) {
        notifyFailure(prepared.error);
        return;
      }
      setConfirm({ kind: "issue", number: prepared.number, issuedOn: prepared.issuedOn, version: current });
    });
  };

  const onConfirmIssue = () => {
    const invoiceId = context.invoiceId;
    if (!invoiceId || confirm?.kind !== "issue") return;
    const expected = confirm.version ? { [invoiceId]: confirm.version } : {};
    setActivity("issue");
    startTransition(async () => {
      const result = await issueDrafts(slug, [invoiceId], expected);
      setActivity(null);
      if (!result.ok) {
        notifyFailure(result.error);
        return;
      }
      const outcome = result.results[0];
      if (!outcome || !outcome.ok) {
        const error = outcome && !outcome.ok ? outcome.error : tCommon("errorGeneric");
        setIssueError(error);
        notifyFailure(error);
        return;
      }
      // La acción revalida: la página ya llega pintada como factura emitida.
      toast.success(t("issuedToast", { number: outcome.number }));
      setConfirm(null);
    });
  };

  const onConfirmDelete = () => {
    const invoiceId = context.invoiceId;
    if (!invoiceId) return;
    setActivity("delete");
    startTransition(async () => {
      const result = await deleteDraft(slug, invoiceId);
      if (!result.ok) {
        setActivity(null);
        toast.error(result.error);
        return;
      }
      toast.success(t("deletedToast"));
      router.push(`${basePath}/invoices?status=draft`);
    });
  };

  useHotkeys({
    "$mod+s": (event) => {
      event.preventDefault();
      onSave();
    },
  });

  const onRequestRemove = (index: number) => {
    const id = getValues(`lines.${index}.id`);
    if (context.lineOrigins[id]?.itemSource) setPendingRemoval(id);
    else fieldArray.remove(index);
  };

  const onConfirmRemove = (waive: boolean) => {
    const index = getValues("lines").findIndex((l) => l.id === pendingRemoval);
    setPendingRemoval(null);
    if (index === -1) return;
    setRemoved((r) => [...r, { line: getValues(`lines.${index}`), waive }]);
    fieldArray.remove(index);
  };

  const onAddLine = () => {
    const previous = getValues("lines").at(-1);
    const defaultVat = data.vatRates.find((r) => r.isDefault && !r.archived) ?? data.vatRates.find((r) => !r.archived);
    fieldArray.append({
      id: newLineId(),
      description: "",
      quantity: "1",
      unit_price: "",
      discount: "",
      // Lo habitual es que la línea nueva lleve el mismo IVA que la anterior.
      tax_rate_id: previous?.tax_rate_id || defaultVat?.id || "",
      irpf_applies: previous?.irpf_applies ?? true,
      // Como el IVA: el tipo de la anterior o, en la primera, puntual (lo habitual a mano).
      billing_type: previous?.billing_type || "one_off",
      period_start: "",
      period_end: "",
    });
  };

  const title = creating ? t("titleNew") : context.kind === "rectifying" ? t("titleRectifying") : t("titleDraft");
  const missingText = missing.map((key) => (tFields.has(key) ? tFields(key) : key)).join(", ");
  const linesError = message(formState.errors.lines?.message ?? formState.errors.lines?.root?.message);

  return (
    <div>
      <Link
        href={`${basePath}/invoices${creating ? "" : "?status=draft"}`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-3xl font-extrabold heading-tight md:text-4xl">{title}</h2>
              {!creating && <InvoiceStatusBadge status="draft" />}
              {context.kind === "rectifying" && (
                <span className="rounded-full border px-2 py-0.5 text-xs font-semibold text-muted-foreground">{tKind("rectifying")}</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5">
                    <Hash className="size-3.5" />
                    {nextNumber ? (
                      t.rich("nextNumber", { number: nextNumber, strong: (chunks) => <strong className="font-mono text-foreground">{chunks}</strong> })
                    ) : (
                      t("nextNumberUnknown")
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("nextNumberHint")}</TooltipContent>
              </Tooltip>
              {context.rectifies && (
                <span className="inline-flex items-center gap-1.5">
                  <FileSignature className="size-3.5" />
                  {t.rich("rectifies", {
                    number: context.rectifies.number,
                    link: (chunks) => (
                      <Link href={`${basePath}/invoices/${context.rectifies!.id}`} className="font-mono text-primary hover:underline">
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              )}
              {dirty && canEdit && <span className="text-warning">{t("unsaved")}</span>}
            </div>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {!creating && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("delete")}
                      disabled={busy}
                      onClick={() => setConfirm({ kind: "delete" })}
                      className="hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("delete")}</TooltipContent>
                </Tooltip>
              )}
              {creating ? (
                <Button asChild variant="ghost">
                  <Link href={`${basePath}/invoices`}>{tCommon("cancel")}</Link>
                </Button>
              ) : null}
              <Button type="submit" variant={creating ? "default" : "outline"} disabled={busy || (!dirty && !creating)}>
                <Save data-icon="inline-start" />
                {activity === "save" ? tCommon("saving") : creating ? t("create") : tCommon("save")}
                <Kbd className="ml-1 hidden sm:inline-flex">⌘S</Kbd>
              </Button>
              {!creating && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={blocked ? 0 : -1}>
                      <Button type="button" onClick={onIssue} disabled={busy || blocked || lineCount === 0}>
                        <Send data-icon="inline-start" />
                        {activity === "issue" ? t("issuing") : t("issue")}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {(blocked || lineCount === 0) && (
                    <TooltipContent>{blocked ? t("issueBlockedVerifactu") : t("issueNoLines")}</TooltipContent>
                  )}
                </Tooltip>
              )}
            </div>
          )}
        </header>

        <div className="mb-6 space-y-3 empty:hidden">
          {!canEdit && <ReadOnlyNotice>{t("readOnly")}</ReadOnlyNotice>}
          {confirm?.kind === "issue" && (
            <InlineConfirm
              icon={<Send className="text-primary" />}
              confirmLabel={activity === "issue" ? t("issuing") : t("issueConfirmAction")}
              onConfirm={onConfirmIssue}
              onCancel={() => {
                setConfirm(null);
                setIssueError(null);
              }}
              pending={activity === "issue"}
            >
              <p>
                {confirm.number
                  ? t.rich("issueConfirm", {
                      number: confirm.number,
                      date: date(confirm.issuedOn),
                      strong: (chunks) => <strong className="font-mono">{chunks}</strong>,
                    })
                  : t("issueConfirmNoNumber", { date: date(confirm.issuedOn) })}
              </p>
              {issueError && <p className="mt-1 font-medium text-destructive">{issueError}</p>}
            </InlineConfirm>
          )}
          {confirm?.kind === "delete" && (
            <InlineConfirm
              tone="destructive"
              icon={<Trash2 className="text-destructive" />}
              confirmLabel={activity === "delete" ? t("deleting") : t("deleteConfirmAction")}
              onConfirm={onConfirmDelete}
              onCancel={() => setConfirm(null)}
              pending={activity === "delete"}
            >
              {t("deleteConfirm")}
            </InlineConfirm>
          )}
          <VerifactuBanner issuer={issuer} today={today} />
          {issuer && !issuer.activeToday && (
            <Notice tone="warning">
              {t("issuerInactive")}{" "}
              <Link href={`${basePath}/settings/issuers`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                {t("fixIssuer")}
              </Link>
            </Notice>
          )}
          {missing.length > 0 && (
            <Notice tone="warning">
              {t("fiscalMissing", { fields: missingText })}{" "}
              {client && client.missing.length > 0 && (
                <Link href={`${basePath}/clients/${client.id}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                  {t("fixClient")}
                </Link>
              )}
              {issuer && issuer.missing.length > 0 && (
                <>
                  {client && client.missing.length > 0 && " · "}
                  <Link href={`${basePath}/settings/issuers`} className="font-semibold text-foreground underline-offset-4 hover:underline">
                    {t("fixIssuer")}
                  </Link>
                </>
              )}
            </Notice>
          )}
        </div>

        <fieldset disabled={!canEdit} className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            {context.kind === "rectifying" && (
              <SettingsCard title={t("sections.rectification")}>
                <FormField
                  id="inv-reason"
                  label={t("reason")}
                  error={message(formState.errors.rectification_reason?.message)}
                >
                  <Textarea
                    id="inv-reason"
                    {...register("rectification_reason")}
                    rows={2}
                    placeholder={t("reasonPlaceholder")}
                    aria-invalid={Boolean(formState.errors.rectification_reason)}
                  />
                </FormField>
              </SettingsCard>
            )}

            <SettingsCard title={t("sections.header")}>
              {locked && (
                <p className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5 shrink-0" />
                  {context.lockReason === "rectifying" ? t("lockedRectifying") : t("lockedContract")}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={control}
                  name="issuer_id"
                  render={({ field, fieldState }) => (
                    <FormField id="inv-issuer" label={t("issuer")} error={message(fieldState.error?.message)}>
                      <Select
                        value={field.value}
                        onValueChange={(next) => {
                          field.onChange(next);
                          setValue("series_id", "", { shouldDirty: true });
                          applyIrpfDefault(next, getValues("client_id"));
                        }}
                        disabled={locked || !canEdit}
                      >
                        <SelectTrigger id="inv-issuer" className="w-full" aria-invalid={Boolean(fieldState.error)}>
                          <SelectValue placeholder={t("issuerPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {data.issuers.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />
                <Controller
                  control={control}
                  name="client_id"
                  render={({ field, fieldState }) => (
                    <FormField id="inv-client" label={t("client")} error={message(fieldState.error?.message)}>
                      <ClientPicker
                        clients={data.clients.map((c) => ({ id: c.id, name: c.name }))}
                        clientId={field.value}
                        newClientName=""
                        invalid={Boolean(fieldState.error)}
                        disabled={locked || !canEdit}
                        onChange={({ clientId: next, newClientName: typed }) => {
                          if (!next) {
                            setNewClientName(typed);
                            return;
                          }
                          setNewClientName("");
                          field.onChange(next);
                          const c = data.clients.find((x) => x.id === next);
                          if (c) setValue("language", c.language, { shouldDirty: true });
                          applyIrpfDefault(getValues("issuer_id"), next);
                        }}
                      />
                      {newClientName && (
                        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {t("newClientHint", { name: newClientName })}
                          <Button asChild variant="link" size="xs" className="h-auto px-0">
                            <Link href={`${basePath}/clients?new=1`}>
                              <UserRoundPlus data-icon="inline-start" />
                              {t("createClient")}
                            </Link>
                          </Button>
                        </p>
                      )}
                    </FormField>
                  )}
                />
                <Controller
                  control={control}
                  name="series_id"
                  render={({ field }) => (
                    <FormField id="inv-series" label={t("series")} description={t("seriesHint")}>
                      <Select
                        value={field.value || DEFAULT_SERIES}
                        onValueChange={(v) => field.onChange(v === DEFAULT_SERIES ? "" : v)}
                        disabled={!issuer || !canEdit}
                      >
                        <SelectTrigger id="inv-series" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_SERIES}>
                            {defaultSeries ? t("seriesDefault", { code: defaultSeries.code }) : t("seriesDefaultMissing")}
                          </SelectItem>
                          {seriesOptions.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.code} · {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />
                <Controller
                  control={control}
                  name="language"
                  render={({ field }) => (
                    <FormField id="inv-language" label={t("language")} description={t("languageHint")}>
                      <Select value={field.value} onValueChange={(v) => field.onChange(locales.find((l) => l === v) ?? "es")}>
                        <SelectTrigger id="inv-language" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {locales.map((l) => (
                            <SelectItem key={l} value={l}>
                              {localeNames[l]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />
              </div>
            </SettingsCard>

            <SettingsCard title={t("sections.dates")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="inv-issued-on"
                  label={t("issuedOn")}
                  optional
                  description={issuedOn ? undefined : t("issuedOnHint", { date: date(today) })}
                  error={message(formState.errors.issued_on?.message)}
                >
                  <Input
                    id="inv-issued-on"
                    type="date"
                    max={today}
                    {...register("issued_on")}
                    aria-invalid={Boolean(formState.errors.issued_on)}
                    className="tabular"
                  />
                </FormField>
                <FormField
                  id="inv-operation-on"
                  label={t("operationOn")}
                  optional
                  description={t("operationOnHint")}
                  error={message(formState.errors.operation_on?.message)}
                >
                  <Input id="inv-operation-on" type="date" {...register("operation_on")} className="tabular" />
                </FormField>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{t("due")}</span>
                    <Controller
                      control={control}
                      name="due_mode"
                      render={({ field }) => (
                        <div role="radiogroup" aria-label={t("due")} className="inline-flex rounded-full border bg-muted/40 p-0.5">
                          {(["terms", "date"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              role="radio"
                              aria-checked={field.value === mode}
                              onClick={() => field.onChange(mode)}
                              className={cn(
                                "rounded-full px-3 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50",
                                field.value === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {t(`dueMode.${mode}`)}
                            </button>
                          ))}
                        </div>
                      )}
                    />
                  </div>
                  {dueMode === "date" ? (
                    <FormField id="inv-due-on" label={<span className="sr-only">{t("dueOn")}</span>} error={message(formState.errors.due_on?.message)}>
                      <Input
                        id="inv-due-on"
                        type="date"
                        min={issuedOn || undefined}
                        {...register("due_on")}
                        aria-invalid={Boolean(formState.errors.due_on)}
                        className="tabular"
                      />
                    </FormField>
                  ) : (
                    <FormField
                      id="inv-terms"
                      label={<span className="sr-only">{t("paymentTerms")}</span>}
                      error={message(formState.errors.payment_terms_days?.message)}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          id="inv-terms"
                          {...register("payment_terms_days")}
                          inputMode="numeric"
                          placeholder={String(defaultTerms)}
                          aria-invalid={Boolean(formState.errors.payment_terms_days)}
                          className="w-24 tabular"
                        />
                        <span className="text-sm text-muted-foreground">{t("days")}</span>
                      </div>
                    </FormField>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {dueMode === "terms" && termsText === ""
                      ? t("termsDefault", { days: defaultTerms, source: client?.paymentTermsDays != null ? "client" : "org" })
                      : null}
                    {dueDate && (
                      <span className="block tabular">
                        {issuedOn ? t("duePreview", { date: date(dueDate) }) : t("duePreviewToday", { date: date(dueDate) })}
                      </span>
                    )}
                  </p>
                </div>

                <Controller
                  control={control}
                  name="payment_method"
                  render={({ field }) => (
                    <FormField id="inv-method" label={t("paymentMethod")}>
                      <Select value={field.value} onValueChange={(v) => field.onChange(PAYMENT_METHODS.find((m) => m === v) ?? "transfer")}>
                        <SelectTrigger id="inv-method" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((m) => (
                            <SelectItem key={m} value={m}>
                              {tPayment(m)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />

                <Controller
                  control={control}
                  name="irpf_bps"
                  render={({ field }) => (
                    <FormField
                      id="inv-irpf"
                      label={t("irpf")}
                      description={
                        irpfDefault !== null && irpfDefault !== irpfBps
                          ? t("irpfDefault", { rate: percent(irpfDefault) })
                          : t("irpfHint")
                      }
                    >
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="inv-irpf" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {irpfOptions.map((o) => (
                            <SelectItem key={o.bps} value={String(o.bps)}>
                              {o.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />
              </div>
            </SettingsCard>

            <SettingsCard
              title={t("sections.lines")}
              description={t("linesHint")}
              actions={
                canEdit && context.kind !== "rectifying" ? (
                  <CatalogPicker
                    slug={slug}
                    locale={invoiceLanguage ?? "es"}
                    target="invoice"
                    onPick={(picked) => {
                      if (picked.length === 0) return;
                      const current = getValues("lines");
                      const onlyEmpty = current.length === 1 && current[0]!.description.trim() === "" && current[0]!.unit_price.trim() === "";
                      if (onlyEmpty) fieldArray.replace(picked);
                      else fieldArray.append(picked);
                    }}
                    variant="outline"
                    size="sm"
                    align="start"
                  />
                ) : undefined
              }
            >
              <EditorLines
                form={form}
                fieldArray={fieldArray}
                kind={context.kind}
                vatRates={data.vatRates}
                lineOrigins={context.lineOrigins}
                amounts={amounts}
                pendingRemoval={pendingRemoval}
                onRequestRemove={onRequestRemove}
                onConfirmRemove={onConfirmRemove}
                onCancelRemove={() => setPendingRemoval(null)}
                removed={removed}
                onUndoRemoved={() => {
                  fieldArray.append(removed.map((r) => r.line));
                  setRemoved([]);
                }}
                onAdd={onAddLine}
                disabled={!canEdit}
              />
              {linesError && <p className="mt-3 text-sm text-destructive">{linesError}</p>}
            </SettingsCard>

            <SettingsCard title={t("sections.notes")}>
              <FormField id="inv-notes" label={<span className="sr-only">{t("notes")}</span>} error={message(formState.errors.notes?.message)}>
                <Textarea id="inv-notes" {...register("notes")} rows={3} placeholder={t("notesPlaceholder")} />
              </FormField>
            </SettingsCard>
          </div>

          <aside className="min-w-0 space-y-6 xl:sticky xl:top-20 xl:self-start">
            <SettingsCard title={t("sections.totals")}>
              <InvoiceTotals
                lines={totalsLines}
                irpfBps={irpfBps}
                legalNotes={legalNotes}
                pendingLines={lines.length - totalsLines.length}
              />
            </SettingsCard>
          </aside>
        </fieldset>
      </form>

      {!creating && context.invoiceId && (
        <PdfPreview className="mt-6" invoiceId={context.invoiceId} title={t("pdfTitle")} version={version} stale={dirty} />
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: "warning" | "destructive"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
        tone === "warning" ? "border-warning/30 bg-warning/10" : "border-destructive/30 bg-destructive/10",
      )}
    >
      <CircleAlert className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-destructive")} />
      <p className="min-w-0 text-muted-foreground">{children}</p>
    </div>
  );
}
