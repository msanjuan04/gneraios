"use client";

import { FilePlus2, HandCoins } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFinanceFormat } from "./format";
import type { RebillClientGroup } from "./types";
import { useAddRebills } from "./use-add-rebills";

/**
 * «Por repercutir» en Gastos: lo pendiente de cada cliente (de más a menos importe) con su
 * «Añadir a factura». Se ve con el filtro «Por repercutir», adonde lleva el «Por hacer».
 */
export function RebillPanel({ slug, groups, canEdit, className }: { slug: string; groups: RebillClientGroup[]; canEdit: boolean; className?: string }) {
  const t = useTranslations("finance.rebill");
  const { money } = useFinanceFormat();
  const { add, busyClientId, isPending } = useAddRebills(slug);

  if (groups.length === 0) return null;

  return (
    <section className={cn("rounded-2xl border bg-card text-sm", className)}>
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <HandCoins aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="font-bold">{t("panel.title")}</h3>
          <p className="mt-1 text-muted-foreground">{t("panel.description")}</p>
        </div>
      </header>
      <ul className="divide-y">
        {groups.map((group) => (
          <li key={group.clientId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/${slug}/clients/${group.clientId}`} className="block truncate font-semibold outline-none hover:text-primary focus-visible:text-primary">
                {group.clientName}
              </Link>
              <p className="truncate text-xs text-muted-foreground tabular">
                {t("panel.summary", { count: group.count, amount: money(group.amountCents) })}
              </p>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => add(group.clientId, group.clientName)}
                disabled={isPending}
                title={t("addHint")}
              >
                <FilePlus2 data-icon="inline-start" />
                {busyClientId === group.clientId ? t("adding") : t("add")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!canEdit && <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">{t("panel.readOnly")}</p>}
    </section>
  );
}
