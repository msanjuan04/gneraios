"use client";

import { Building2, type LucideIcon, Server, UserRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { COST_ALLOCATIONS, type CostAllocation, parseMarkupInput } from "@/app/[org]/finance/schema";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { rebillAmountCents, rebillMarkupCents } from "@/domain/finance/rebill";
import { cn } from "@/lib/utils";
import { useFinanceFormat } from "./format";
import { ClientSelect, PercentInput } from "./inputs";
import type { ClientOption } from "./types";

const ICONS: Record<CostAllocation, LucideIcon> = { company: Building2, client: UserRound, hosted_sites: Server };

/** Los cuatro campos de «¿A quién sirve?» tal como están en el formulario. */
export type AllocationValue = { allocation: CostAllocation; clientId: string; rebill: boolean; markup: string };

/** Ya repercutido: dónde está (el borrador o la factura emitida), para enlazarlo. */
export type AllocationLock = { state: "drafted" | "invoiced"; href: string | null; number: string | null };

/**
 * «¿A quién sirve?» de un gasto o una suscripción: la empresa, un cliente (con «Repercutir al
 * cliente» y su margen) o las webs que alojamos. Lo que se le facturará se calcula con el dominio
 * (base + margen, sin IVA). Un gasto ya repercutido se enseña bloqueado, con su factura.
 */
export function AllocationFields({
  idPrefix,
  kind,
  value,
  onChange,
  errors,
  clients,
  baseCents,
  disabled = false,
  lock = null,
  showSubscriptionNote = false,
}: {
  idPrefix: string;
  kind: "expense" | "subscription";
  value: AllocationValue;
  onChange: (patch: Partial<AllocationValue>) => void;
  /** Ya traducidos. */
  errors: { clientId?: string; rebill?: string; markup?: string };
  clients: ClientOption[];
  /** La base del gasto (o de cada cargo), o null si lo escrito no es un importe. */
  baseCents: number | null;
  disabled?: boolean;
  lock?: AllocationLock | null;
  /** Una suscripción que ya ha generado gastos: lo que cambie aquí solo vale para los próximos. */
  showSubscriptionNote?: boolean;
}) {
  const t = useTranslations("finance.allocationField");
  const { money } = useFinanceFormat();
  const locked = disabled || lock !== null;
  const markupBps = parseMarkupInput(value.markup);

  const select = (allocation: CostAllocation) =>
    onChange(allocation === "client" ? { allocation } : { allocation, clientId: "", rebill: false });

  let preview: string | null = null;
  if (value.allocation === "client" && value.rebill && baseCents !== null && markupBps !== null) {
    const amount = money(rebillAmountCents(baseCents, markupBps));
    preview =
      kind === "subscription"
        ? t("previewSubscription", { amount })
        : markupBps > 0
          ? t("previewMarkup", { amount, base: money(baseCents), markup: money(rebillMarkupCents(baseCents, markupBps)) })
          : t("preview", { amount });
  }

  const lockLink = (chunks: ReactNode) =>
    lock?.href ? (
      <Link href={lock.href} className="font-semibold text-foreground underline-offset-2 hover:underline">
        {chunks}
      </Link>
    ) : (
      chunks
    );

  return (
    <div className="grid gap-3 sm:col-span-2">
      <div role="radiogroup" aria-label={t("label")} className="grid gap-2 sm:grid-cols-3">
        {COST_ALLOCATIONS.map((allocation) => {
          const checked = value.allocation === allocation;
          const Icon = ICONS[allocation];
          return (
            <button
              key={allocation}
              type="button"
              role="radio"
              id={`${idPrefix}-allocation-${allocation}`}
              aria-checked={checked}
              disabled={locked}
              onClick={() => select(allocation)}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
                checked ? "border-primary bg-primary/10" : "bg-muted/30 hover:bg-muted/60",
              )}
            >
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", checked ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0">
                <span className="block text-sm leading-snug font-semibold">{t(`options.${allocation}.title`)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t(`options.${allocation}.hint`)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {value.allocation === "client" && (
        <>
          <FormField id={`${idPrefix}-client`} label={t("client")} error={errors.clientId}>
            <ClientSelect
              id={`${idPrefix}-client`}
              clients={clients}
              clientId={value.clientId}
              onChange={(clientId) => onChange({ clientId })}
              invalid={Boolean(errors.clientId)}
              disabled={locked}
            />
          </FormField>
          <ToggleField
            id={`${idPrefix}-rebill`}
            label={t("rebill")}
            description={errors.rebill ?? (kind === "subscription" ? t("rebillHintSubscription") : t("rebillHint"))}
            checked={value.rebill}
            onCheckedChange={(rebill) => onChange({ rebill })}
            disabled={locked}
          />
          {value.rebill && (
            <div className="grid items-end gap-3 sm:grid-cols-[auto_1fr]">
              <FormField id={`${idPrefix}-markup`} label={t("markup")} optional description={t("markupHint")} error={errors.markup}>
                <PercentInput
                  id={`${idPrefix}-markup`}
                  value={value.markup}
                  onChange={(e) => onChange({ markup: e.target.value })}
                  inputMode="decimal"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.markup)}
                  disabled={locked}
                  className="w-32 tabular"
                />
              </FormField>
              {preview && (
                <p className="rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground tabular" aria-live="polite">
                  {preview}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {value.allocation === "hosted_sites" && <p className="text-xs text-muted-foreground">{t("hostedNote")}</p>}
      {showSubscriptionNote && <p className="text-xs text-muted-foreground">{t("subscriptionNote")}</p>}
      {lock && (
        <p className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {lock.state === "drafted"
            ? t.rich("lockedDrafted", { link: lockLink })
            : lock.number
              ? t.rich("lockedInvoiced", { number: lock.number, link: lockLink })
              : t.rich("lockedInvoicedNoNumber", { link: lockLink })}
        </p>
      )}
    </div>
  );
}
