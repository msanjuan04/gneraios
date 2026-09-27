"use client";

import { FilePlus2, Repeat } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { useFinanceFormat } from "./format";
import type { ClientRebillData } from "./types";
import { useAddRebills } from "./use-add-rebills";

/**
 * «Por repercutir» en la ficha del cliente: sus gastos marcados para repercutir que aún no están
 * en ninguna factura, con lo que se le facturará (base + margen, sin IVA), y «Añadir a factura».
 * Los datos salen de `getClientRebills(orgId, clientId)` (src/server/finance/rebill.ts). Si no
 * hay nada pendiente ni en un borrador suyo, no se pinta.
 */
export function ClientRebillCard({
  slug,
  clientId,
  clientName,
  data,
  canEdit,
}: {
  /** El slug de la org. */
  slug: string;
  clientId: string;
  /** Para el aviso («… al borrador de Acme»). */
  clientName: string;
  data: ClientRebillData;
  /** Socio u owner: puede añadirlos a su factura. */
  canEdit: boolean;
}) {
  const t = useTranslations("finance.rebill");
  const { money, percent, dateShort } = useFinanceFormat();
  const { add, busyClientId } = useAddRebills(slug);
  const busy = busyClientId === clientId;
  const { pending, totals, drafted } = data;

  if (pending.length === 0 && drafted.count === 0) return null;

  const expensesHref = `/${slug}/finance/expenses?client=${clientId}`;
  const draftHref = drafted.invoiceId ? `/${slug}/invoices/${drafted.invoiceId}` : null;

  return (
    <SettingsCard
      title={t("card.title")}
      description={pending.length > 0 ? t("card.description", { count: totals.count, amount: money(totals.amountCents) }) : undefined}
      actions={
        canEdit && pending.length > 0 ? (
          <Button size="sm" onClick={() => add(clientId, clientName)} disabled={busy} title={t("addHint")}>
            <FilePlus2 data-icon="inline-start" />
            {busy ? t("adding") : t("add")}
          </Button>
        ) : undefined
      }
      bodyClassName={pending.length > 0 ? "p-0" : undefined}
      footer={
        <>
          {drafted.count > 0 && pending.length > 0 && (
            <span className="mr-auto text-xs text-muted-foreground tabular">
              {t("card.drafted", { count: drafted.count, amount: money(drafted.amountCents) })}
            </span>
          )}
          {draftHref && (
            <Button asChild variant="ghost" size="sm">
              <Link href={draftHref}>{t("card.viewDraft")}</Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href={expensesHref}>{t("card.viewExpenses")}</Link>
          </Button>
        </>
      }
    >
      {pending.length === 0 ? (
        <p className="text-muted-foreground">{t("card.drafted", { count: drafted.count, amount: money(drafted.amountCents) })}</p>
      ) : (
        <ul className="divide-y">
          {pending.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-semibold">{item.vendorName ?? item.description}</span>
                  {item.fromSubscription && (
                    <span title={t("fromSubscription")} className="inline-flex shrink-0 text-muted-foreground">
                      <Repeat aria-hidden className="size-3.5" />
                      <span className="sr-only">{t("fromSubscription")}</span>
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground tabular">
                  {dateShort(item.periodStart ?? item.issuedOn)}
                  {item.vendorName && ` · ${item.description}`}
                </p>
              </div>
              <div className="shrink-0 text-right tabular">
                <p className="font-semibold">{money(item.amountCents)}</p>
                {item.markupBps > 0 && (
                  <p className="text-[11px] text-muted-foreground" title={t("markupTitle", { percent: percent(item.markupBps), base: money(item.baseCents) })}>
                    {t("markup", { percent: percent(item.markupBps) })}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!canEdit && pending.length > 0 && <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">{t("card.readOnly")}</p>}
    </SettingsCard>
  );
}
