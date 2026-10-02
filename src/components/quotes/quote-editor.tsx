"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, BookmarkPlus, CircleCheck, CircleX, Copy, FileSignature, Hash, Lock, Mail, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { CatalogPicker } from "@/components/catalog/catalog-picker";
import { CreateProjectButton } from "@/components/projects/create-project-button";
import { toast } from "sonner";
import { discountToBps, moneyInputToCents, parseQuantity } from "@/app/[org]/contracts/schema";
import { acceptQuote, deleteQuote, duplicateQuote, prepareQuoteEmail, rejectQuote, saveQuote } from "@/app/[org]/quotes/actions";
import {
  hasOneOff,
  newLineDefaults,
  planItemsFromForm,
  presetPlan,
  type QuoteFormInput,
  quoteFormSchema,
  type QuoteFormValues,
  type QuoteLineInput,
} from "@/app/[org]/quotes/schema";
import {
  effectiveDates,
  milestoneAmounts,
  type QuoteBillingType,
  type QuoteCalcLine,
  quoteLineBaseCents,
  quoteTotals,
} from "@/app/[org]/quotes/summary";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { ClientPicker } from "@/components/crm/client-picker";
import { FormField } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { localeNames, locales } from "@/i18n/config";
import { getPdfLabels } from "@/pdf/labels";
import { useQuoteFormat, useQuoteValidationMessage } from "./format";
import { InlineConfirm } from "./inline-confirm";
import { PaymentPlanFields } from "./payment-plan-fields";
import { QuoteActivityCard } from "./quote-activity-card";
import { QuoteLines } from "./quote-lines";
import { QuotePdfPreview } from "./quote-pdf-preview";
import { QuoteStateBadge } from "./quote-state-badge";
import { QuoteSummaryCard } from "./quote-summary-card";
import { SaveTemplateSheet } from "./save-template-sheet";
import { SendQuoteSheet } from "./send-quote-sheet";
import type { AppLocale, FinalizedQuote, QuoteEditorData, QuoteEmailDraft } from "./types";

const NO_DEAL = "__none__";

/** Id de una línea nueva, estable entre guardados (así conserva su sitio). */
function newLineId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fuera de un contexto seguro (http en la red local) no hay randomUUID: UUID v4 a mano.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Confirm = { kind: "accept" } | { kind: "reject"; reason: string } | { kind: "delete" } | null;
type Activity = "save" | "send" | "accept" | "reject" | "delete" | "duplicate" | null;

type Props = {
  slug: string;
  basePath: string;
  /** Hoy en la zona de la org (YYYY-MM-DD). */
  today: string;
  data: QuoteEditorData;
  /** «Compartir enlace» (src/components/quotes/quote-share-card.tsx), debajo de la actividad. */
  share?: ReactNode;
};

/**
 * Editor de un presupuesto (o de uno nuevo): cabecera, líneas agrupadas por tipo, plan de pagos
 * con planes habituales, totales en vivo separados por tipo, vista previa del PDF y las acciones
 * Guardar (⌘S), Enviar, Marcar aceptado, Rechazar, Duplicar y Borrar. Un aceptado o un rechazado
 * se ve pero no se edita. Los importes se calculan aquí solo para verlos: al guardar, el servidor
 * los recalcula con el dominio.
 */
export function QuoteEditor({ slug, basePath, today, data, share }: Props) {
  const t = useTranslations("quotes.editor");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("quotes.errors");
  const tTemplates = useTranslations("quotes.templates");
  const { date, money } = useQuoteFormat();
  const message = useQuoteValidationMessage();
  const router = useRouter();
  const { options } = data;
  const creating = data.mode === "create";
  const editable = data.editable;
  const quoteId = data.quoteId;

  const schema = useMemo(() => quoteFormSchema(today), [today]);
  const form = useForm<QuoteFormInput, unknown, QuoteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: data.defaults,
    mode: "onTouched",
  });
  const { control, register, getValues, setValue, resetField, handleSubmit, reset, formState } = form;
  const lines = useFieldArray({ control, name: "lines", keyName: "key" });
  const plan = useFieldArray({ control, name: "plan", keyName: "key" });

  // La versión que se envía al guardar. Si el servidor cambia el presupuesto (se envía, se
  // rechaza…), la página llega con otra y esta la sigue.
  const [version, setVersion] = useState(data.updatedAt);
  const [serverVersion, setServerVersion] = useState(data.updatedAt);
  if (data.updatedAt !== serverVersion) {
    setServerVersion(data.updatedAt);
    setVersion(data.updatedAt);
  }
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [activity, setActivity] = useState<Activity>(null);
  const [emailDraft, setEmailDraft] = useState<QuoteEmailDraft | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [, startTransition] = useTransition();
  const busy = activity !== null;

  const watchedLines: QuoteLineInput[] = useWatch({ control, name: "lines" }) ?? [];
  const watchedPlan = useWatch({ control, name: "plan" }) ?? [];
  const [clientId, newClientName, dealId, language, issuedOn, validUntil, title] = useWatch({
    control,
    name: ["client_id", "new_client_name", "deal_id", "language", "issued_on", "valid_until", "title"],
  });

  // Totales en vivo, con la misma implementación del redondeo que usará el servidor.
  const rateById = useMemo(() => new Map(options.vatRates.map((r) => [r.id, r])), [options.vatRates]);
  const calc = watchedLines.map((line): { base: number | null; line: QuoteCalcLine | null } => {
    const quantity = parseQuantity(line?.quantity ?? "");
    const price = moneyInputToCents(line?.unit_price ?? "");
    const discount = discountToBps(line?.discount ?? "");
    if (!line || quantity === null || price === null || discount === null) return { base: null, line: null };
    const rate = rateById.get(line.tax_rate_id ?? "");
    try {
      const base = quoteLineBaseCents({ quantity, unitPriceCents: price, discountBps: discount });
      const calcLine: QuoteCalcLine = {
        billingType: line.billing_type,
        quantity,
        unitPriceCents: price,
        discountBps: discount,
        vatBps: rate?.rateBps ?? 0,
        vatRegime: rate?.regime ?? "general",
      };
      return { base, line: rate ? calcLine : null };
    } catch {
      return { base: null, line: null };
    }
  });
  const calcLines = calc.flatMap((c) => (c.line ? [c.line] : []));
  const totals = quoteTotals(calcLines);
  const oneOffLines = hasOneOff(watchedLines);
  const amounts = oneOffLines ? milestoneAmounts(calcLines, planItemsFromForm(watchedPlan)) : null;
  const firstPayment = amounts?.[0]?.when === "on_accept" ? amounts[0] : null;
  const dates = effectiveDates(issuedOn || null, validUntil || null, today, options.validityDays);

  const dirty = formState.isDirty;
  const deals = options.deals.filter((d) => d.clientId === clientId);
  const clientName = options.clients.find((c) => c.id === clientId)?.name ?? newClientName;
  const isDraft = data.status === "draft";
  const canAccept = data.canAct && !creating && data.status !== "accepted";
  const canReject = data.canAct && data.status === "sent";

  // Avisa antes de salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty || !editable) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, editable]);

  const notifyFailure = (error: string) => {
    if (error === tErrors("quoteChanged")) {
      toast.error(error, { action: { label: t("reload"), onClick: () => window.location.reload() } });
    } else toast.error(error);
  };

  /** Guarda (o crea) el presupuesto. Devuelve el id y la versión nueva, o null si no se pudo. */
  const persist = async (): Promise<{ id: string; updatedAt: string } | null> => {
    const out: { saved: { id: string; updatedAt: string } | null } = { saved: null };
    await handleSubmit(
      async () => {
        const values = getValues();
        const result = await saveQuote(slug, quoteId, values, version);
        if (!result.ok) {
          notifyFailure(result.error);
          return;
        }
        out.saved = { id: result.id, updatedAt: result.updatedAt };
        if (!creating) {
          setVersion(result.updatedAt);
          reset(values, { keepValues: true });
        }
      },
      () => toast.error(t("invalid")),
    )();
    return out.saved;
  };

  /** Lo guardado es lo que se envía, se acepta o se duplica: si hay cambios, primero se guardan. */
  const ensureSaved = async (): Promise<boolean> => (editable && dirty ? (await persist()) !== null : true);

  const onSave = () => {
    if (!editable || busy) return;
    setActivity("save");
    startTransition(async () => {
      const saved = await persist();
      if (!saved) {
        setActivity(null);
        return;
      }
      if (creating) {
        toast.success(t("createdToast"));
        router.push(`${basePath}/quotes/${saved.id}`);
        return;
      }
      setActivity(null);
      toast.success(t("savedToast"));
    });
  };

  const onSend = () => {
    if (!quoteId || busy) return;
    setActivity("send");
    startTransition(async () => {
      if (!(await ensureSaved())) {
        setActivity(null);
        return;
      }
      const result = await prepareQuoteEmail(slug, quoteId);
      setActivity(null);
      if (!result.ok) {
        notifyFailure(result.error);
        return;
      }
      setEmailDraft(result.email);
    });
  };

  const onSent = (finalized: FinalizedQuote) => {
    // El primer envío fija las fechas: el formulario las enseña sin darse por cambiado.
    if (finalized.issuedOn && !getValues("issued_on")) resetField("issued_on", { defaultValue: finalized.issuedOn });
    if (finalized.validUntil && !getValues("valid_until")) resetField("valid_until", { defaultValue: finalized.validUntil });
    router.refresh();
  };

  const onConfirmAccept = () => {
    if (!quoteId) return;
    setActivity("accept");
    startTransition(async () => {
      if (!(await ensureSaved())) {
        setActivity(null);
        return;
      }
      const result = await acceptQuote(slug, quoteId);
      if (!result.ok) {
        setActivity(null);
        notifyFailure(result.error);
        return;
      }
      if (result.invoiceId) {
        toast.success(t("acceptedToastInvoice"));
        router.push(`${basePath}/invoices/${result.invoiceId}`);
        return;
      }
      if (result.warning) toast.warning(t("acceptedToastWarning", { error: result.warning }));
      else toast.success(t("acceptedToast"));
      router.push(`${basePath}/contracts/${result.contractId}`);
    });
  };

  const onConfirmReject = () => {
    if (!quoteId || confirm?.kind !== "reject") return;
    const reason = confirm.reason;
    setActivity("reject");
    startTransition(async () => {
      const result = await rejectQuote(slug, quoteId, { reason });
      setActivity(null);
      if (!result.ok) {
        notifyFailure(result.error);
        return;
      }
      setConfirm(null);
      toast.success(t("rejectedToast"));
      router.refresh();
    });
  };

  const onDuplicate = () => {
    if (!quoteId || busy) return;
    setActivity("duplicate");
    startTransition(async () => {
      if (!(await ensureSaved())) {
        setActivity(null);
        return;
      }
      const result = await duplicateQuote(slug, quoteId);
      if (!result.ok) {
        setActivity(null);
        notifyFailure(result.error);
        return;
      }
      toast.success(t("duplicatedToast"));
      router.push(`${basePath}/quotes/${result.id}`);
    });
  };

  const onConfirmDelete = () => {
    if (!quoteId) return;
    setActivity("delete");
    startTransition(async () => {
      const result = await deleteQuote(slug, quoteId);
      if (!result.ok) {
        setActivity(null);
        notifyFailure(result.error);
        return;
      }
      toast.success(t("deletedToast"));
      router.push(`${basePath}/quotes`);
    });
  };

  useHotkeys({
    "$mod+s": (event) => {
      event.preventDefault();
      onSave();
    },
  });

  const onAddLine = (type: QuoteBillingType) => {
    const current = getValues("lines");
    const previous = current.at(-1);
    const defaultVat = previous?.tax_rate_id || options.defaultVatRateId;
    lines.append({ ...newLineDefaults(type, newLineId(), defaultVat ?? null), irpf_applies: previous?.irpf_applies ?? true });
    // La primera línea puntual trae un plan: el 100 % a la aceptación, en el idioma del presupuesto.
    if (type === "one_off" && !hasOneOff(current) && getValues("plan").length === 0) {
      plan.replace(presetPlan("full", getValues("language")));
    }
  };

  /** Líneas del catálogo: sustituyen a la línea vacía de un presupuesto nuevo y, si traen la primera puntual, su plan. */
  const onPickCatalog = (picked: QuoteLineInput[]) => {
    if (picked.length === 0) return;
    const current = getValues("lines");
    const onlyEmpty = current.length === 1 && current[0]!.description.trim() === "" && current[0]!.unit_price.trim() === "";
    if (onlyEmpty) lines.replace(picked);
    else lines.append(picked);
    if (!hasOneOff(current) && hasOneOff(picked) && getValues("plan").length === 0) {
      plan.replace(presetPlan("full", getValues("language")));
    }
  };

  /** Al cambiar de idioma, las etiquetas de los planes habituales se traducen con él. */
  const onLanguageChange = (next: AppLocale) => {
    const previous = getValues("language");
    setValue("language", next, { shouldDirty: true });
    if (previous === next) return;
    const from = getPdfLabels(previous).quote.plan.presets;
    const to = getPdfLabels(next).quote.plan.presets;
    getValues("plan").forEach((item, index) => {
      const key = (Object.keys(from) as (keyof typeof from)[]).find((k) => from[k] === item.label);
      if (key) setValue(`plan.${index}.label`, to[key], { shouldDirty: true });
    });
  };

  const heading = creating ? t("titleNew") : data.number ?? t("titleDraft");
  const validityText = dates.validUntil
    ? { date: dates.validUntil, derived: !validUntil && (isDraft || creating) }
    : null;

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        href={`${basePath}/quotes`}
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
              <h2 className="text-3xl font-extrabold heading-tight md:text-4xl">{heading}</h2>
              {!creating && <QuoteStateBadge state={data.state} />}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
              {title && <span className="font-medium text-foreground">{title}</span>}
              {clientName && <span>{clientName}</span>}
              {!data.number && (
                <span className="inline-flex items-center gap-1.5">
                  <Hash className="size-3.5" />
                  {t("numberPending")}
                </span>
              )}
              {data.contract && (
                <Link href={`${basePath}/contracts/${data.contract.id}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <FileSignature className="size-3.5" />
                  {t("viewContract")}
                </Link>
              )}
              {data.contract && clientId && data.canAct && (
                <CreateProjectButton
                  slug={slug}
                  clientId={clientId}
                  contractId={data.contract.id}
                  defaultName={title || null}
                  variant="ghost"
                  size="sm"
                  className="-my-1 h-7 px-2"
                />
              )}
              {dirty && editable && <span className="text-warning">{t("unsaved")}</span>}
            </div>
          </div>

          {data.canAct && (
            <div className="flex flex-wrap items-center gap-2">
              {!creating && isDraft && (
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
              {!creating && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label={t("duplicate")} disabled={busy} onClick={onDuplicate}>
                      <Copy />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("duplicate")}</TooltipContent>
                </Tooltip>
              )}
              {!creating && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label={tTemplates("saveAs.title")} disabled={busy} onClick={() => setTemplateOpen(true)}>
                      <BookmarkPlus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{tTemplates("saveAs.title")}</TooltipContent>
                </Tooltip>
              )}
              {creating && (
                <Button asChild variant="ghost">
                  <Link href={`${basePath}/quotes`}>{tCommon("cancel")}</Link>
                </Button>
              )}
              {editable && (
                <Button type="submit" variant={creating ? "default" : "outline"} disabled={busy || (!dirty && !creating)}>
                  <Save data-icon="inline-start" />
                  {activity === "save" ? tCommon("saving") : creating ? t("create") : tCommon("save")}
                  <Kbd className="ml-1 hidden sm:inline-flex">⌘S</Kbd>
                </Button>
              )}
              {canReject && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm({ kind: "reject", reason: "" })}>
                  <CircleX data-icon="inline-start" />
                  {t("reject")}
                </Button>
              )}
              {canAccept && (
                <Button type="button" variant={isDraft ? "outline" : "default"} disabled={busy} onClick={() => setConfirm({ kind: "accept" })}>
                  <CircleCheck data-icon="inline-start" />
                  {t("accept")}
                </Button>
              )}
              {editable && !creating && (
                <Button type="button" variant={isDraft ? "default" : "outline"} disabled={busy} onClick={onSend}>
                  <Mail data-icon="inline-start" />
                  {activity === "send" ? t("preparing") : isDraft ? t("send") : t("resend")}
                </Button>
              )}
            </div>
          )}
        </header>

        <div className="mb-6 space-y-3 empty:hidden">
          {!data.canAct && <ReadOnlyNotice>{t("readOnly")}</ReadOnlyNotice>}
          {data.canAct && !editable && !creating && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5 shrink-0" />
              {data.status === "accepted" ? t("frozenAccepted") : t("frozenRejected")}
            </p>
          )}
          {data.status === "sent" && editable && <p className="text-xs text-muted-foreground">{t("sentEditHint")}</p>}
          {confirm?.kind === "accept" && (
            <InlineConfirm
              tone="success"
              icon={<CircleCheck className="text-success" />}
              confirmLabel={activity === "accept" ? t("accepting") : t("acceptConfirmAction")}
              onConfirm={onConfirmAccept}
              onCancel={() => setConfirm(null)}
              pending={activity === "accept"}
            >
              <p className="font-semibold">{t("acceptConfirmTitle")}</p>
              <p className="mt-0.5 text-muted-foreground">
                {t("acceptConfirm")}{" "}
                {firstPayment
                  ? t("acceptConfirmInvoice", { amount: money(firstPayment.totalCents) })
                  : t("acceptConfirmNoInvoice")}
                {data.state === "expired" && ` ${t("acceptConfirmExpired")}`}
              </p>
            </InlineConfirm>
          )}
          {confirm?.kind === "reject" && (
            <InlineConfirm
              tone="warning"
              icon={<CircleX className="text-warning" />}
              confirmLabel={activity === "reject" ? t("rejecting") : t("rejectConfirmAction")}
              onConfirm={onConfirmReject}
              onCancel={() => setConfirm(null)}
              pending={activity === "reject"}
              focusConfirm={false}
            >
              <p className="font-semibold">{t("rejectConfirm")}</p>
              <Input
                autoFocus
                value={confirm.reason}
                maxLength={500}
                onChange={(e) => setConfirm({ kind: "reject", reason: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onConfirmReject();
                  }
                }}
                placeholder={t("rejectReasonPlaceholder")}
                aria-label={t("rejectReason")}
                className="mt-2 bg-background"
              />
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
        </div>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <fieldset disabled={!editable} className="min-w-0 space-y-6">
            <SettingsCard title={t("sections.header")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={control}
                  name="client_id"
                  render={({ field, fieldState }) => (
                    <FormField id="quote-client" label={t("client")} error={message(fieldState.error?.message)}>
                      <ClientPicker
                        clients={options.clients.map((c) => ({ id: c.id, name: c.name }))}
                        clientId={field.value}
                        newClientName={newClientName}
                        invalid={Boolean(fieldState.error)}
                        disabled={!editable}
                        onChange={({ clientId: next, newClientName: typed }) => {
                          field.onChange(next);
                          setValue("new_client_name", typed, { shouldDirty: true });
                          // El deal tiene que ser de ese cliente.
                          if (getValues("deal_id") && !options.deals.some((d) => d.id === getValues("deal_id") && d.clientId === next)) {
                            setValue("deal_id", "", { shouldDirty: true });
                          }
                          const client = options.clients.find((c) => c.id === next);
                          if (client) onLanguageChange(client.language);
                        }}
                      />
                      {newClientName && !field.value && <p className="text-xs text-muted-foreground">{t("newClientHint", { name: newClientName })}</p>}
                    </FormField>
                  )}
                />
                <Controller
                  control={control}
                  name="deal_id"
                  render={({ field }) => (
                    <FormField id="quote-deal" label={t("deal")} optional description={t("dealHint")}>
                      <Select
                        value={field.value || NO_DEAL}
                        onValueChange={(v) => field.onChange(v === NO_DEAL ? "" : v)}
                        disabled={!editable || !clientId}
                      >
                        <SelectTrigger id="quote-deal" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_DEAL}>{t("noDeal")}</SelectItem>
                          {deals.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.title}
                            </SelectItem>
                          ))}
                          {dealId && !deals.some((d) => d.id === dealId) && <SelectItem value={dealId}>{t("dealUnknown")}</SelectItem>}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />
                <FormField id="quote-title" label={t("quoteTitle")} error={message(formState.errors.title?.message)} className="sm:col-span-2">
                  <Input
                    id="quote-title"
                    {...register("title")}
                    placeholder={t("quoteTitlePlaceholder")}
                    aria-invalid={Boolean(formState.errors.title)}
                  />
                </FormField>
                <Controller
                  control={control}
                  name="issuer_id"
                  render={({ field, fieldState }) => (
                    <FormField
                      id="quote-issuer"
                      label={t("issuer")}
                      description={options.issuers.find((i) => i.id === field.value)?.pendingConstitution ? t("issuerPending") : t("issuerHint")}
                      error={message(fieldState.error?.message)}
                    >
                      <Select value={field.value} onValueChange={field.onChange} disabled={!editable}>
                        <SelectTrigger id="quote-issuer" className="w-full" aria-invalid={Boolean(fieldState.error)}>
                          <SelectValue placeholder={t("issuerPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.issuers.map((i) => (
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
                  name="language"
                  render={({ field }) => (
                    <FormField id="quote-language" label={t("language")} description={t("languageHint")}>
                      <Select value={field.value} onValueChange={(v) => onLanguageChange(locales.find((l) => l === v) ?? "es")} disabled={!editable}>
                        <SelectTrigger id="quote-language" className="w-full">
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
                <FormField
                  id="quote-issued-on"
                  label={t("issuedOn")}
                  optional={isDraft || creating}
                  description={issuedOn ? undefined : t("issuedOnHint", { date: date(today) })}
                  error={message(formState.errors.issued_on?.message)}
                >
                  <Input
                    id="quote-issued-on"
                    type="date"
                    max={today}
                    {...register("issued_on")}
                    aria-invalid={Boolean(formState.errors.issued_on)}
                    className="tabular"
                  />
                </FormField>
                <FormField
                  id="quote-valid-until"
                  label={t("validUntil")}
                  optional={isDraft || creating}
                  description={validUntil ? undefined : t("validUntilHint", { days: options.validityDays })}
                  error={message(formState.errors.valid_until?.message)}
                >
                  <Input
                    id="quote-valid-until"
                    type="date"
                    min={issuedOn || undefined}
                    {...register("valid_until")}
                    aria-invalid={Boolean(formState.errors.valid_until)}
                    className="tabular"
                  />
                </FormField>
              </div>
            </SettingsCard>

            <SettingsCard
              title={t("sections.lines")}
              description={t("linesHint")}
              actions={
                editable ? (
                  <CatalogPicker slug={slug} locale={language} target="quote" onPick={onPickCatalog} variant="outline" size="sm" align="start" />
                ) : undefined
              }
            >
              <QuoteLines
                form={form}
                fieldArray={lines}
                vatRates={options.vatRates}
                bases={calc.map((c) => c.base)}
                billingDay={options.billingDay}
                onAdd={onAddLine}
                disabled={!editable}
              />
              {formState.errors.lines?.message && <p className="mt-3 text-sm text-destructive">{message(formState.errors.lines.message)}</p>}
            </SettingsCard>

            {oneOffLines && (
              <SettingsCard title={t("sections.plan")} description={t("planHint")}>
                <PaymentPlanFields form={form} fieldArray={plan} language={language} amounts={amounts} disabled={!editable} />
              </SettingsCard>
            )}

            <SettingsCard title={t("sections.notes")}>
              <FormField id="quote-notes" label={<span className="sr-only">{t("notes")}</span>} error={message(formState.errors.notes?.message)}>
                <Textarea id="quote-notes" {...register("notes")} rows={3} placeholder={t("notesPlaceholder")} />
              </FormField>
            </SettingsCard>
          </fieldset>

          <aside className="min-w-0 space-y-6 xl:sticky xl:top-20 xl:self-start">
            <QuoteSummaryCard totals={totals} firstPayment={firstPayment} validUntil={validityText} />
            {!creating && <QuoteActivityCard basePath={basePath} data={data} />}
            {!creating && share}
          </aside>
        </div>
      </form>

      <QuotePdfPreview className="mt-6" quoteId={quoteId} title={t("pdfTitle")} version={version} stale={dirty && editable} />

      {quoteId && (
        <SaveTemplateSheet slug={slug} basePath={basePath} quoteId={quoteId} defaultName={title || data.defaults.title} open={templateOpen} onClose={() => setTemplateOpen(false)} />
      )}
      {quoteId && (
        <SendQuoteSheet
          slug={slug}
          quoteId={quoteId}
          title={title || data.defaults.title}
          isDraft={isDraft}
          draft={emailDraft}
          onClose={() => setEmailDraft(null)}
          onSent={onSent}
        />
      )}
    </div>
  );
}
