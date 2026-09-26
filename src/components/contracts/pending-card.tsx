"use client";

import { Hourglass, Receipt } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { restoreBillableItem, waiveBillableItem } from "@/app/[org]/contracts/actions";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useContractFormat } from "./format";
import { BillableStateBadge } from "./status-badges";
import type { BillableItemView, BillableState, ContractDetailData } from "./types";

/** Lo que se enseña de lo ya facturado o condonado antes de «Ver todo». */
const SETTLED_PREVIEW = 6;

const STATE_ORDER: Record<BillableState, number> = { pending: 0, drafted: 1, invoiced: 2, waived: 3 };

/**
 * «Pendiente de facturar» del contrato: cada periodo, uso o hito con su estado. Lo pendiente
 * primero (lo más antiguo arriba); después, lo último que se ha facturado o condonado.
 */
export function PendingCard({ data }: { data: ContractDetailData }) {
  const t = useTranslations("contracts.pending");
  const fmt = useContractFormat();
  const [showAll, setShowAll] = useState(false);
  const { items, kpis } = data;

  const open = items
    .filter((i) => i.state === "pending" || i.state === "drafted")
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.billableOn.localeCompare(b.billableOn));
  const settled = items
    .filter((i) => i.state === "invoiced" || i.state === "waived")
    .sort((a, b) => b.billableOn.localeCompare(a.billableOn));
  const shownSettled = showAll ? settled : settled.slice(0, SETTLED_PREVIEW);
  const hidden = settled.length - shownSettled.length;

  return (
    <SettingsCard
      title={t("title")}
      description={
        items.length === 0
          ? undefined
          : open.length === 0
            ? t("nothingPending")
            : [
                t("pendingSummary", { amount: fmt.money(kpis.pendingCents - kpis.draftedCents) }),
                kpis.draftedCents > 0 ? t("draftedSummary", { amount: fmt.money(kpis.draftedCents) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")
      }
      bodyClassName={items.length > 0 ? "p-0" : undefined}
    >
      {items.length === 0 ? (
        <div className="text-center">
          <Hourglass className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{data.contract.signedOn ? t("empty") : t("emptyUnsigned")}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y">
            {[...open, ...shownSettled].map((item) => (
              <ItemRow key={item.id} item={item} data={data} />
            ))}
          </ul>
          {hidden > 0 && (
            <div className="border-t px-5 py-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                {t("showAll", { count: hidden })}
              </Button>
            </div>
          )}
        </>
      )}
    </SettingsCard>
  );
}

function ItemRow({ item, data }: { item: BillableItemView; data: ContractDetailData }) {
  const t = useTranslations("contracts.pending");
  const tSource = useTranslations("billing.billableSource");
  const fmt = useContractFormat();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const { slug, basePath } = data;

  const restore = () =>
    startTransition(async () => {
      const result = await restoreBillableItem(slug, item.id);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("restoredToast"));
    });

  const waive = () =>
    startTransition(async () => {
      const result = await waiveBillableItem(slug, item.id, { reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirming(false);
      toast.success(t("waivedToast"), { action: { label: t("undo"), onClick: restore } });
    });

  return (
    <li className={cn("px-5 py-3", item.state === "waived" && "text-muted-foreground")}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{item.description}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="outline">{tSource(item.source)}</Badge>
            <span className="tabular">
              {item.periodStart && item.periodEnd ? fmt.period(item.periodStart, item.periodEnd) : fmt.date(item.billableOn)}
            </span>
            {item.source === "usage" && item.quantity !== 1 && <span className="tabular">× {fmt.quantity(item.quantity)}</span>}
            {item.invoiceId && (
              <Link
                href={`${basePath}/invoices/${item.invoiceId}`}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                <Receipt className="size-3" />
                {item.invoiceNumber ?? t("draft")}
              </Link>
            )}
            {item.state === "waived" && item.waiveReason && <span className="italic">{item.waiveReason}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("font-semibold tabular", item.state === "waived" && "line-through")}>{fmt.money(item.amountCents)}</span>
          <BillableStateBadge state={item.state} />
        </div>
        {data.canEdit && item.state === "pending" && !confirming && (
          <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
            {t("waive")}
          </Button>
        )}
      </div>

      {/* Confirmación en línea: nunca un modal encima de la ficha. */}
      {confirming && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            waive();
          }}
        >
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            aria-label={t("reason")}
            maxLength={300}
            autoFocus
            className="h-7 min-w-48 flex-1"
          />
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            {t("confirmWaive")}
          </Button>
          <p className="w-full px-1 text-xs text-muted-foreground">{t("waiveExplain")}</p>
        </form>
      )}
    </li>
  );
}
