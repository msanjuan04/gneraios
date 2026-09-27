"use client";

import { Banknote, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { loadPaymentContext, recordClientPayment } from "@/app/[org]/invoices/payment-actions";
import { centsToInput, clientPaymentSchema, PAYMENT_METHODS, type PaymentMethod } from "@/app/[org]/invoices/schema";
import { ReceiptForm } from "@/components/clients/receipt-form";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { allocateReceived, allocationTotal, paidBeforeIssue } from "@/domain/invoicing/payment-allocation";
import { parseMoneyInput } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { PayableInvoice } from "@/server/invoices/payables";
import { useInvoiceFormat, useInvoiceValidationMessage } from "./format";

type Context = {
  slug: string;
  clientId: string;
  /** Abierto desde un proyecto: sus facturas (las de su contrato) se marcan, un cobro sin factura ya lo lleva y se revalida su página. */
  projectId?: string;
  contractId?: string | null;
};

type Mode = "receipt" | "invoices";

/**
 * «Registrar cobro» en la ficha del cliente o en un proyecto suyo. Dos formas, en el mismo panel:
 * - Sin factura: lo que pagó, con su fecha, concepto y proyecto (mientras no se factura desde aquí).
 * - A facturas: sus facturas pendientes, para marcar las que paga el cobro (o escribir lo recibido y
 *   repartirlo solo, de la más antigua a la más nueva). Solo aparece si tiene alguna.
 * Solo socios.
 */
export function RecordPaymentButton({
  clientName,
  variant = "outline",
  size = "sm",
  className,
  ...context
}: Context & {
  clientName: string;
  variant?: "outline" | "secondary" | "default" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  const t = useTranslations("invoices.recordPayment");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <Banknote data-icon="inline-start" />
        {t("button")}
      </Button>
      <SettingsSheet open={open} onOpenChange={setOpen} title={t("title")} description={t("description", { client: clientName })}>
        <RecordPaymentPanel {...context} onDone={() => setOpen(false)} />
      </SettingsSheet>
    </>
  );
}

type Loaded = { invoices: PayableInvoice[]; projects: { id: string; name: string }[]; today: string };

/** Carga lo pendiente al abrir: el panel se monta con cada apertura, así que siempre está al día. */
function RecordPaymentPanel({ onDone, ...context }: Context & { onDone: () => void }) {
  const t = useTranslations("invoices.recordPayment");
  const tCommon = useTranslations("common");
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; error: string } | ({ status: "ready" } & Loaded)>({
    status: "loading",
  });
  const [mode, setMode] = useState<Mode | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPaymentContext(context.slug, context.clientId).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { status: "ready", invoices: result.invoices, projects: result.projects, today: result.today }
          : { status: "error", error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [context.slug, context.clientId]);

  if (state.status === "loading") {
    return (
      <div className="space-y-3 px-5 py-5" aria-busy>
        <Skeleton className="h-9 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="px-5 py-8 text-center">
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={onDone}>
          {tCommon("close")}
        </Button>
      </div>
    );
  }

  // Con facturas pendientes se empieza por ellas; sin ninguna, solo hay «sin factura».
  const current: Mode = state.invoices.length === 0 ? "receipt" : (mode ?? "invoices");
  return (
    <>
      {state.invoices.length > 0 && (
        <div className="border-b px-5 py-3">
          <div role="tablist" aria-label={t("mode")} className="flex w-fit gap-1 rounded-full border bg-card/60 p-1">
            {(["invoices", "receipt"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={current === m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3.5 py-1 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  current === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`modes.${m}`)}
                {m === "invoices" && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] leading-5 font-bold text-primary-foreground tabular">
                    {state.invoices.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
      {current === "receipt" ? (
        <ReceiptForm
          slug={context.slug}
          clientId={context.clientId}
          projects={state.projects}
          today={state.today}
          defaultProjectId={context.projectId}
          onDone={onDone}
        />
      ) : (
        <PaymentAllocationForm {...context} invoices={state.invoices} today={state.today} onDone={onDone} />
      )}
    </>
  );
}

function PaymentAllocationForm({
  slug,
  clientId,
  projectId,
  contractId,
  invoices,
  today,
  onDone,
}: Context & Omit<Loaded, "projects"> & { onDone: () => void }) {
  const t = useTranslations("invoices.recordPayment");
  const tPayments = useTranslations("invoices.payments");
  const tMethod = useTranslations("billing.paymentMethod");
  const tCommon = useTranslations("common");
  const { money, date } = useInvoiceFormat();
  const message = useInvoiceValidationMessage();
  const [pending, startTransition] = useTransition();

  // Con una sola candidata (del cliente o del contrato del proyecto) se marca ya; si hay varias,
  // las marca quien registra el cobro o el reparto de lo recibido.
  const initial = useMemo(() => {
    const fromContract = contractId ? invoices.filter((i) => i.contractIds.includes(contractId)) : [];
    const only = invoices.length === 1 ? invoices[0] : fromContract.length === 1 ? fromContract[0] : undefined;
    return only ? { [only.id]: centsToInput(only.outstandingCents) } : {};
  }, [invoices, contractId]);

  const [selected, setSelected] = useState<Record<string, string>>(initial);
  const [received, setReceived] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>(() => invoices.find((i) => initial[i.id])?.paymentMethod ?? invoices[0]?.paymentMethod ?? "transfer");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const receivedCents = parseMoneyInput(received);
  const surplusCents = receivedCents && receivedCents > 0 ? allocateReceived(receivedCents, invoices).unallocatedCents : 0;
  const chosen = invoices.filter((i) => selected[i.id] !== undefined);
  const totalCents = allocationTotal(chosen.map((i) => ({ amountCents: Math.max(0, parseMoneyInput(selected[i.id] ?? "") ?? 0) })));
  const early = chosen.filter((i) => paidBeforeIssue(paidOn, i.issuedOn));

  /** Lo recibido manda: marca las facturas que cubre, de la más antigua a la más nueva. */
  const distribute = (value: string) => {
    setReceived(value);
    setErrors((e) => ({ ...e, allocations: undefined }));
    const cents = parseMoneyInput(value);
    if (cents === null || cents <= 0) return;
    const { allocations } = allocateReceived(cents, invoices);
    setSelected(Object.fromEntries(allocations.map((a) => [a.invoiceId, centsToInput(a.amountCents)])));
  };

  // Tocar una factura a mano deja de seguir el importe recibido.
  const toggle = (invoice: PayableInvoice, checked: boolean) => {
    setReceived("");
    setErrors((e) => ({ ...e, allocations: undefined, [invoice.id]: undefined }));
    setSelected((current) => {
      const next = { ...current };
      if (checked) next[invoice.id] = centsToInput(invoice.outstandingCents);
      else delete next[invoice.id];
      return next;
    });
  };
  const setAmount = (invoiceId: string, value: string) => {
    setReceived("");
    setErrors((e) => ({ ...e, [invoiceId]: undefined }));
    setSelected((current) => ({ ...current, [invoiceId]: value }));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = {
      paid_on: paidOn,
      method,
      reference,
      allocations: chosen.map((i) => ({ invoice_id: i.id, amount: selected[i.id] ?? "" })),
    };
    const parsed = clientPaymentSchema(today).safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string | undefined> = {};
      for (const issue of parsed.error.issues) {
        const [field, index] = issue.path;
        const key = field === "allocations" && typeof index === "number" ? chosen[index]?.id : String(field ?? "allocations");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    startTransition(async () => {
      const result = await recordClientPayment(slug, clientId, input, projectId ? { projectId } : {});
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("savedToast", { count: result.count, amount: money(result.totalCents) }));
      onDone();
    });
  };

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground tabular">
            {chosen.length > 0 ? t("total", { amount: money(totalCents), count: chosen.length }) : t("noneSelected")}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={pending || chosen.length === 0}>
            {pending ? tCommon("saving") : t("save")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">{t("invoicesHint")}</p>
        {invoices.length > 1 && (
          <FormField
            id="payment-received"
            label={t("received")}
            optional
            description={
              surplusCents > 0 ? <span className="text-warning">{t("surplus", { amount: money(surplusCents) })}</span> : t("receivedHint")
            }
          >
            <InputGroup>
              <InputGroupInput
                id="payment-received"
                value={received}
                onChange={(e) => distribute(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder={centsToInput(allocationTotal(invoices.map((i) => ({ amountCents: i.outstandingCents }))))}
                className="text-right tabular"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>€</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </FormField>
        )}

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium">{t("invoices", { count: invoices.length })}</legend>
          <ul className="divide-y overflow-hidden rounded-xl border">
            {invoices.map((invoice) => {
              const checked = selected[invoice.id] !== undefined;
              const amount = parseMoneyInput(selected[invoice.id] ?? "");
              const partial = checked && amount !== null && amount > 0 && amount < invoice.outstandingCents;
              const over = checked && amount !== null && amount > invoice.outstandingCents;
              const error = message(errors[invoice.id]);
              return (
                <li key={invoice.id} className={cn("px-3 py-2.5 transition-colors", checked && "bg-primary/5")}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) => toggle(invoice, value === true)}
                      className="mt-0.5"
                      aria-label={t("select", { number: invoice.number })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono font-semibold">{invoice.number}</span>
                        {contractId && invoice.contractIds.includes(contractId) && (
                          <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                            {t("thisProject")}
                          </Badge>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground tabular">
                        {t("issuedOn", { date: date(invoice.issuedOn) })}
                        {invoice.dueOn && (
                          <span className={cn(invoice.overdue && "text-destructive")}>
                            {" · "}
                            {invoice.overdue ? t("overdueOn", { date: date(invoice.dueOn) }) : t("dueOn", { date: date(invoice.dueOn) })}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular">{money(invoice.outstandingCents)}</span>
                      {invoice.outstandingCents !== invoice.netTotalCents && (
                        <span className="block text-xs text-muted-foreground tabular">{t("ofTotal", { amount: money(invoice.netTotalCents) })}</span>
                      )}
                    </span>
                  </label>
                  {checked && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                      <InputGroup className="w-36">
                        <InputGroupInput
                          value={selected[invoice.id] ?? ""}
                          onChange={(e) => setAmount(invoice.id, e.target.value)}
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={t("amountFor", { number: invoice.number })}
                          aria-invalid={Boolean(error)}
                          className="text-right tabular"
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>€</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                      <span className={cn("text-xs", error || over ? "text-destructive" : "text-muted-foreground")}>
                        {error ??
                          (over
                            ? tPayments("overpaid", { amount: money(invoice.outstandingCents) })
                            : partial
                              ? t("partial", { amount: money(invoice.outstandingCents - (amount ?? 0)) })
                              : t("full"))}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {errors.allocations && (
            <p role="alert" className="text-sm text-destructive">
              {message(errors.allocations)}
            </p>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="payment-paid-on"
            label={tPayments("paidOn")}
            error={message(errors.paid_on)}
            description={
              early.length > 0 ? (
                <span className="inline-flex items-start gap-1 text-warning">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                  {t("beforeIssue", { number: early[0]!.number, count: early.length })}
                </span>
              ) : (
                t("paidOnHint")
              )
            }
          >
            <Input
              id="payment-paid-on"
              type="date"
              max={today}
              value={paidOn}
              onChange={(e) => {
                setPaidOn(e.target.value);
                setErrors((x) => ({ ...x, paid_on: undefined }));
              }}
              aria-invalid={Boolean(errors.paid_on)}
              className="tabular"
            />
          </FormField>
          <FormField id="payment-method" label={tPayments("method")}>
            <Select value={method} onValueChange={(v) => setMethod(PAYMENT_METHODS.find((m) => m === v) ?? "transfer")}>
              <SelectTrigger id="payment-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {tMethod(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="payment-reference" label={tPayments("reference")} optional error={message(errors.reference)} className="sm:col-span-2">
            <Input
              id="payment-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={tPayments("referencePlaceholder")}
              autoComplete="off"
              maxLength={200}
            />
          </FormField>
        </div>
      </div>
    </SheetForm>
  );
}
