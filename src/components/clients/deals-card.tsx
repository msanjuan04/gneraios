"use client";

import { Clock, Plus, SquareKanban } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBps, formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "./member-avatar";
import type { ClientDeal, StageKind } from "./types";

const STAGE_STYLES: Record<StageKind, string> = {
  open: "bg-secondary text-secondary-foreground",
  won: "bg-success/15 text-success",
  lost: "bg-destructive/15 text-destructive",
};

type Props = {
  basePath: string;
  clientId: string;
  deals: ClientDeal[];
  canEdit: boolean;
};

/** Deals del cliente. Cada uno abre su panel en el pipeline; lo puntual y lo mensual nunca se suman. */
export function DealsCard({ basePath, clientId, deals, canEdit }: Props) {
  const t = useTranslations("clients.deals");
  const tCrm = useTranslations("crm");
  const locale = useLocale();
  const money = (cents: number) => formatMoney(cents, { locale, wholeUnits: true });
  const newDealHref = `${basePath}/pipeline?new=1&client=${clientId}`;

  const open = deals.filter((d) => d.stageKind === "open");
  const openOneOff = open.reduce((sum, d) => sum + d.oneOffCents, 0);
  const openMrr = open.reduce((sum, d) => sum + d.mrrCents, 0);
  const summary =
    open.length === 0
      ? undefined
      : [
          t("openCount", { count: open.length }),
          openOneOff > 0 ? t("openOneOff", { amount: money(openOneOff) }) : null,
          openMrr > 0 ? tCrm("amount.perMonth", { amount: money(openMrr) }) : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <SettingsCard
      title={t("title")}
      description={summary}
      actions={
        canEdit ? (
          <Button asChild variant="outline" size="sm">
            <Link href={newDealHref}>
              <Plus data-icon="inline-start" />
              {t("new")}
            </Link>
          </Button>
        ) : undefined
      }
      bodyClassName={deals.length > 0 ? "p-0" : undefined}
    >
      {deals.length === 0 ? (
        <div className="text-center">
          <SquareKanban className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button asChild variant="secondary" size="sm" className="mt-3">
              <Link href={newDealHref}>
                <Plus data-icon="inline-start" />
                {t("new")}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Link
                href={`${basePath}/pipeline?deal=${deal.id}`}
                className="group flex items-center gap-3 px-5 py-3 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate font-semibold group-hover:text-primary", deal.stageKind === "lost" && "text-muted-foreground")}>
                    {deal.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge className={STAGE_STYLES[deal.stageKind]}>{deal.stageName}</Badge>
                    <span className="tabular" title={t("probability")}>
                      {formatBps(deal.probabilityBps, locale)}
                    </span>
                    <span className="flex items-center gap-1 tabular" title={t("daysInStage")}>
                      <Clock className="size-3" />
                      {tCrm("daysInStage", { count: deal.daysInStage })}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right font-semibold tabular">
                  {deal.oneOffCents > 0 && <p title={tCrm("amount.oneOff")}>{money(deal.oneOffCents)}</p>}
                  {deal.mrrCents > 0 && (
                    <p className="text-primary" title={tCrm("amount.mrr")}>
                      {tCrm("amount.perMonth", { amount: money(deal.mrrCents) })}
                    </p>
                  )}
                  {deal.oneOffCents === 0 && deal.mrrCents === 0 && <p className="text-muted-foreground">—</p>}
                </div>
                {deal.owner && <MemberAvatar member={deal.owner} className="hidden sm:inline-flex" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
