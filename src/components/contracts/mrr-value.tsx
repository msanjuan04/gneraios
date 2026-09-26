"use client";

import { useTranslations } from "next-intl";
import { useContractFormat } from "./format";
import type { ContractListItem } from "./types";

/** MRR de hoy; si todo empieza más adelante, lo que será y desde cuándo. */
export function MrrValue({ item }: { item: Pick<ContractListItem, "mrrCents" | "upcomingMrr" | "status"> }) {
  const t = useTranslations("contracts");
  const fmt = useContractFormat();
  if (item.mrrCents > 0) {
    return (
      <span title={item.status === "draft" ? t("list.unsignedMrr") : undefined}>{fmt.perCycle(item.mrrCents, "monthly", true)}</span>
    );
  }
  if (item.upcomingMrr) {
    return (
      <span className="font-normal text-muted-foreground" title={t("list.upcomingMrr", { date: fmt.date(item.upcomingMrr.from) })}>
        {fmt.perCycle(item.upcomingMrr.cents, "monthly", true)}
      </span>
    );
  }
  return <span className="font-normal text-muted-foreground">—</span>;
}
