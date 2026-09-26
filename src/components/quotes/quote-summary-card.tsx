"use client";

import { Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import type { MilestoneAmount, QuoteTotals, SectionTotals } from "@/app/[org]/quotes/summary";
import { SettingsCard } from "@/components/settings/settings-card";
import { useQuoteFormat } from "./format";

type Cycle = "one_off" | "monthly" | "yearly";

function Section({ label, totals, cycle }: { label: string; totals: SectionTotals; cycle: Cycle }) {
  const t = useTranslations("quotes.summary");
  const { money, perCycle } = useQuoteFormat();
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground tabular">
          {t("breakdown", { base: money(totals.subtotalCents), vat: money(totals.vatCents) })}
        </p>
      </div>
      <p className="shrink-0 text-right text-base font-bold tabular">{perCycle(totals.totalCents, cycle)}</p>
    </div>
  );
}

/**
 * Totales en vivo, cada tipo por su lado (lo puntual, lo mensual y lo anual nunca se suman), con
 * la misma implementación del redondeo que usará el servidor. Si el primer pago es a la
 * aceptación, lo que se facturará en cuanto se acepte.
 */
export function QuoteSummaryCard({
  totals,
  firstPayment,
  validUntil,
}: {
  totals: QuoteTotals;
  /** El primer pago del plan si es «a la aceptación». */
  firstPayment: MilestoneAmount | null;
  /** Validez que lleva (o llevará al enviarlo). */
  validUntil: { date: string; derived: boolean } | null;
}) {
  const t = useTranslations("quotes.summary");
  const { money, date } = useQuoteFormat();
  const empty = !totals.oneOff && !totals.monthly && !totals.yearly && totals.usageCount === 0;

  return (
    <SettingsCard title={t("title")} description={t("description")}>
      {empty ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="divide-y">
          {totals.oneOff && <Section label={t("oneOff")} totals={totals.oneOff} cycle="one_off" />}
          {totals.monthly && <Section label={t("monthly")} totals={totals.monthly} cycle="monthly" />}
          {totals.yearly && <Section label={t("yearly")} totals={totals.yearly} cycle="yearly" />}
          {totals.usageCount > 0 && (
            <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-semibold">{t("usage")}</p>
                <p className="text-xs text-muted-foreground">{t("usageHint", { count: totals.usageCount })}</p>
              </div>
            </div>
          )}
        </div>
      )}
      {firstPayment && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
          <Receipt className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>{t("firstInvoice", { label: firstPayment.label, amount: money(firstPayment.totalCents) })}</span>
        </p>
      )}
      {validUntil && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t(validUntil.derived ? "validUntilDerived" : "validUntil", { date: date(validUntil.date) })}
        </p>
      )}
    </SettingsCard>
  );
}
