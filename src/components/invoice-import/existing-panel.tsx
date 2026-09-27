"use client";

import { CircleAlert, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useInvoiceFormat } from "@/components/invoices/format";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { ToggleField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import type { ImportSetup } from "@/domain/invoice-import/match";
import { parseMoneyInput } from "@/domain/money";
import { PaymentFields } from "./payment-fields";
import { PdfToggle } from "./row-form";
import { type ImportItem, openAmount } from "./use-invoice-import";

/**
 * Una factura que ya estaba en la org (importada antes o emitida desde GNERAI OS). Si le queda algo
 * por cobrar, se registra su cobro (lo mismo que «Registrar cobro» en la factura) con la fecha del
 * PDF si la trae; si es una importada sin su PDF, se puede guardar este. Nada más: no se duplica.
 */
export function ExistingPanel({
  basePath,
  item,
  setup,
  onChange,
  onSettle,
  onRemove,
}: {
  basePath: string;
  item: ImportItem;
  setup: ImportSetup | null;
  onChange: (fn: (a: NonNullable<ImportItem["existingAction"]>) => NonNullable<ImportItem["existingAction"]>) => void;
  onSettle: (withPayment: boolean) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("invoiceImport.existing");
  const { money, date } = useInvoiceFormat();
  const existing = item.existing!;
  const action = item.existingAction!;
  const open = openAmount(existing);
  const saving = item.phase === "saving";
  const canAttach = existing.source === "import" && !existing.hasOriginal;
  const today = setup?.today ?? "";
  const paidOnError =
    action.paidOn === "" ? t("paidOnRequired") : today && action.paidOn > today ? t("paidOnFuture") : undefined;
  const partial = action.status === "partial" ? parseMoneyInput(action.amount) : null;
  const amountError = action.status === "partial" && (partial === null || partial <= 0 || partial >= open) ? t("partialAmount") : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-muted/30 p-3 text-sm">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">
            {existing.matchedBy === "file" ? t("sameFile") : existing.source === "import" ? t("imported") : t("fromApp")}
          </p>
          <p className="text-muted-foreground">
            {t("summary", {
              number: existing.number,
              client: existing.clientName,
              date: existing.issuedOn ? date(existing.issuedOn) : "—",
              total: money(existing.netTotalCents),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <InvoiceStatusBadge status={existing.status} />
            {open > 0 && <span className="text-xs text-muted-foreground tabular">{t("outstanding", { amount: money(open) })}</span>}
          </div>
        </div>
        <Button asChild variant="ghost" size="sm">
          <a href={`${basePath}/invoices/${existing.id}`} target="_blank" rel="noreferrer">
            <ExternalLink data-icon="inline-start" />
            {t("open")}
          </a>
        </Button>
      </div>

      <PdfToggle file={item.file} />

      {open > 0 ? (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("registerTitle")}</h4>
          <PaymentFields
            idPrefix={`${item.id}-existing`}
            value={{ status: action.status, paidOn: action.paidOn, amount: action.amount, method: action.method, reference: action.reference }}
            onChange={(patch) => onChange((a) => ({ ...a, ...patch, status: patch.status === "pending" ? a.status : (patch.status ?? a.status) }))}
            statuses={["paid", "partial"]}
            totalCents={open}
            issuedOn={existing.issuedOn ?? ""}
            dueOn=""
            paidOnConfidence={action.paidOn && action.paidOn === item.extraction?.paidOn?.value ? item.extraction.paidOn.confidence : null}
            errors={{ paidOn: paidOnError, amount: amountError }}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{existing.status === "voided" ? t("voided") : t("paid")}</p>
      )}

      {canAttach && (
        <ToggleField
          id={`${item.id}-attach`}
          label={t("attach")}
          description={t("attachHint")}
          checked={action.attach}
          onCheckedChange={(attach) => onChange((a) => ({ ...a, attach }))}
          control="checkbox"
        />
      )}

      {item.error && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {item.error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        <Button type="button" variant="ghost" onClick={onRemove} disabled={saving}>
          {t("dismiss")}
        </Button>
        {open > 0 ? (
          <Button type="button" onClick={() => onSettle(true)} disabled={saving || Boolean(paidOnError) || Boolean(amountError)}>
            {saving ? t("registering") : t("register")}
          </Button>
        ) : (
          canAttach && (
            <Button type="button" onClick={() => onSettle(false)} disabled={saving || !action.attach}>
              {saving ? t("attaching") : t("attachOnly")}
            </Button>
          )
        )}
      </div>
    </div>
  );
}
