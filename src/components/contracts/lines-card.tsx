"use client";

import {
  Ban,
  CalendarX,
  CornerDownRight,
  GitBranchPlus,
  ListPlus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteLine, resumeLine } from "@/app/[org]/contracts/actions";
import { isRecurring } from "@/app/[org]/contracts/schema";
import { potentialMrrCents } from "@/app/[org]/contracts/summary";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useContractFormat } from "./format";
import type { LineActionKind } from "./line-action-sheet";
import { canCreateVersion } from "./line-sheet";
import { LineStatusBadge } from "./status-badges";
import type { ContractDetailData, ContractLineView, PauseView } from "./types";

export type LineAction = "edit" | "version" | LineActionKind;

type Props = {
  data: ContractDetailData;
  onAction: (action: LineAction, line: ContractLineView) => void;
  onAdd: () => void;
};

const GROUPS = [
  { key: "recurring", match: (l: ContractLineView) => isRecurring(l.billingType) },
  { key: "usage", match: (l: ContractLineView) => l.billingType === "usage" },
  { key: "oneOff", match: (l: ContractLineView) => l.billingType === "one_off" },
] as const;

/**
 * Líneas del contrato agrupadas en recurrentes, por uso y puntuales: condiciones, fechas,
 * estado, hasta dónde están facturadas y la cadena de versiones. Lo terminado se oculta.
 */
export function LinesCard({ data, onAction, onAdd }: Props) {
  const t = useTranslations("contracts.lines");
  const fmt = useContractFormat();
  const { lines, canEdit, kpis } = data;
  const endedCount = lines.filter((l) => l.status === "ended").length;
  // Si todo ha terminado, se enseña igualmente: la ficha no puede quedarse vacía.
  const [showEnded, setShowEnded] = useState(() => endedCount === lines.length);
  const visible = showEnded ? lines : lines.filter((l) => l.status !== "ended");
  const byId = new Map(lines.map((l) => [l.id, l]));
  const liveCount = lines.length - endedCount;

  const goTo = (lineId: string) => {
    setShowEnded(true);
    requestAnimationFrame(() => document.getElementById(`line-${lineId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  const groupTotal = (key: (typeof GROUPS)[number]["key"]) =>
    key === "recurring" && kpis.mrrCents > 0
      ? fmt.perCycle(kpis.mrrCents, "monthly")
      : key === "oneOff" && kpis.oneOffCents > 0
        ? fmt.money(kpis.oneOffCents)
        : null;

  return (
    <SettingsCard
      title={t("title")}
      description={lines.length > 0 ? t("summary", { live: liveCount, ended: endedCount }) : undefined}
      actions={
        <>
          {endedCount > 0 && endedCount < lines.length && (
            <label className="flex h-7 cursor-pointer items-center gap-2 rounded-full px-2 text-[0.8rem] font-semibold text-muted-foreground hover:text-foreground">
              <Switch size="sm" checked={showEnded} onCheckedChange={setShowEnded} />
              {t("showEnded", { count: endedCount })}
            </label>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onAdd}>
              <Plus data-icon="inline-start" />
              {t("add")}
            </Button>
          )}
        </>
      }
      bodyClassName={lines.length > 0 ? "p-0" : undefined}
    >
      {lines.length === 0 ? (
        <div className="text-center">
          <ListPlus className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onAdd}>
              <Plus data-icon="inline-start" />
              {t("add")}
            </Button>
          )}
        </div>
      ) : (
        GROUPS.map((group) => {
          const groupLines = visible.filter(group.match);
          if (groupLines.length === 0) return null;
          const total = groupTotal(group.key);
          return (
            <section key={group.key} className="border-b last:border-b-0">
              <header className="flex items-center justify-between gap-3 border-b bg-muted/30 px-5 py-1.5">
                <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t(`groups.${group.key}`)}</h4>
                {total && <span className="text-xs font-semibold text-muted-foreground tabular">{total}</span>}
              </header>
              <ul className="divide-y">
                {groupLines.map((line) => (
                  <LineRow key={line.id} line={line} data={data} byId={byId} onAction={onAction} goTo={goTo} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </SettingsCard>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1">{children}</span>;
}

function LineRow({
  line,
  data,
  byId,
  onAction,
  goTo,
}: {
  line: ContractLineView;
  data: ContractDetailData;
  byId: Map<string, ContractLineView>;
  onAction: Props["onAction"];
  goTo: (lineId: string) => void;
}) {
  const t = useTranslations("contracts.lines");
  const tType = useTranslations("billing.billingType");
  const tCommon = useTranslations("common");
  const fmt = useContractFormat();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  // Si una opción del menú abre un panel, el foco no vuelve al botón del menú.
  const openingSheet = useRef(false);
  const { slug, canEdit } = data;
  const signed = data.contract.signedOn !== null;
  const recurring = isRecurring(line.billingType);
  const ended = line.status === "ended";
  const previous = line.replacesLineId ? byId.get(line.replacesLineId) : undefined;
  const next = line.replacedByLineId ? byId.get(line.replacedByLineId) : undefined;
  const period =
    line.billingType === "one_off"
      ? null
      : line.startsOn && line.endsOn
        ? fmt.period(line.startsOn, line.endsOn)
        : line.startsOn
          ? t("since", { date: fmt.date(line.startsOn) })
          : line.endsOn
            ? t("until", { date: fmt.date(line.endsOn) })
            : null;
  const pauseText = (pause: PauseView) =>
    pause.endsOn ? fmt.period(pause.startsOn, pause.endsOn) : t("pauseOpenEnded", { date: fmt.date(pause.startsOn) });

  const act = (action: LineAction) => {
    openingSheet.current = true;
    onAction(action, line);
  };

  const endPause = (pause: PauseView) =>
    startTransition(async () => {
      const result = await resumeLine(slug, pause.id);
      if (!result.ok) toast.error(result.error);
      else toast.success(result.result === "resumed" ? t("resumedToast") : t("pauseCancelledToast"));
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteLine(slug, line.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirmDelete(false);
      toast.success(result.restoredPrevious ? t("deletedRestoredToast") : t("deletedToast"));
    });

  return (
    <li id={`line-${line.id}`} className={cn("scroll-mt-24 px-5 py-3", ended && "text-muted-foreground")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={cn("font-semibold", !ended && "text-foreground")}>{line.description}</p>
            <LineStatusBadge status={line.status} />
            {recurring && <Badge variant="outline">{tType(line.billingType)}</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular">
            <Meta>
              {fmt.quantity(line.quantity)} × {fmt.money(line.unitPriceCents)}
              {line.discountBps > 0 && ` · −${fmt.percent(line.discountBps)}`}
            </Meta>
            <Meta>
              {line.taxRateName}
              {!line.irpfApplies && ` · ${t("noIrpf")}`}
            </Meta>
            {period && <Meta>{period}</Meta>}
            {line.billingType === "monthly" && line.billingDay !== null && <Meta>{t("billingDay", { day: line.billingDay })}</Meta>}
            {line.billingType === "yearly" && line.startsOn && <Meta>{t("anniversary", { date: fmt.date(line.startsOn, "short") })}</Meta>}
            {recurring && (
              <Meta>{line.billedUntil ? t("billedUntil", { date: fmt.date(line.billedUntil) }) : t("notBilledYet")}</Meta>
            )}
            {line.nextBillingOn && !ended && (
              <Meta>
                <span className="text-foreground/80">{t("nextBilling", { date: fmt.date(line.nextBillingOn) })}</span>
              </Meta>
            )}
          </p>

          {(line.currentPause || line.upcomingPause || line.cancelledOn || previous || next) && (
            <div className="mt-1.5 flex flex-col gap-1 text-xs">
              {line.currentPause && (
                <p className="text-warning">
                  {t("pausedNow", { period: pauseText(line.currentPause) })}
                  {line.currentPause.reason && <span className="text-muted-foreground"> · {line.currentPause.reason}</span>}
                </p>
              )}
              {line.upcomingPause && (
                <p className="text-muted-foreground">{t("pauseScheduled", { period: pauseText(line.upcomingPause) })}</p>
              )}
              {line.cancelledOn && line.endsOn && (
                <p className="text-muted-foreground">
                  {t("cancelled", { on: fmt.date(line.cancelledOn), end: fmt.date(line.endsOn) })}
                  {line.cancelReason && <span> · {line.cancelReason}</span>}
                </p>
              )}
              {previous && (
                <button
                  type="button"
                  onClick={() => goTo(previous.id)}
                  className="inline-flex w-fit items-center gap-1 font-semibold text-primary hover:underline"
                >
                  <CornerDownRight className="size-3" />
                  {previous.endsOn
                    ? t("replaces", {
                        price: fmt.perCycle(previous.baseCents, previous.billingType),
                        date: fmt.date(previous.endsOn),
                      })
                    : t("replacesOpen", { price: fmt.perCycle(previous.baseCents, previous.billingType) })}
                </button>
              )}
              {next && (
                <button
                  type="button"
                  onClick={() => goTo(next.id)}
                  className="inline-flex w-fit items-center gap-1 font-semibold text-primary hover:underline"
                >
                  <GitBranchPlus className="size-3" />
                  {next.startsOn
                    ? t("replacedBy", { price: fmt.perCycle(next.baseCents, next.billingType), date: fmt.date(next.startsOn) })
                    : t("replacedByOpen", { price: fmt.perCycle(next.baseCents, next.billingType) })}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className={cn("font-semibold tabular", !ended && "text-foreground")}>{fmt.perCycle(line.baseCents, line.billingType)}</p>
          {line.billingType === "yearly" && (
            <p className="text-xs text-muted-foreground tabular">
              {t("yearlyAsMrr", {
                amount: fmt.perCycle(
                  potentialMrrCents([{ billingType: "yearly", quantity: 1, unitPriceCents: line.baseCents, discountBps: 0 }]),
                  "monthly",
                ),
              })}
            </p>
          )}
        </div>

        {canEdit && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("actions")} disabled={pending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-60"
              onCloseAutoFocus={(event) => {
                if (openingSheet.current) event.preventDefault();
                openingSheet.current = false;
              }}
            >
              <DropdownMenuItem onSelect={() => act("edit")}>
                <Pencil />
                {t("menu.edit")}
              </DropdownMenuItem>
              {canCreateVersion(line) && (
                <DropdownMenuItem onSelect={() => act("version")}>
                  <GitBranchPlus />
                  {t("menu.version")}
                </DropdownMenuItem>
              )}
              {line.billingType === "usage" && !ended && (
                <DropdownMenuItem disabled={!signed} onSelect={() => act("usage")}>
                  <Plus />
                  {signed ? t("menu.usage") : t("menu.usageUnsigned")}
                </DropdownMenuItem>
              )}
              {recurring && !ended && !line.currentPause && !line.upcomingPause && (
                <DropdownMenuItem onSelect={() => act("pause")}>
                  <Pause />
                  {t("menu.pause")}
                </DropdownMenuItem>
              )}
              {line.currentPause && (
                <DropdownMenuItem onSelect={() => line.currentPause && endPause(line.currentPause)}>
                  <Play />
                  {t("menu.resume")}
                </DropdownMenuItem>
              )}
              {!line.currentPause && line.upcomingPause && (
                <DropdownMenuItem onSelect={() => line.upcomingPause && endPause(line.upcomingPause)}>
                  <CalendarX />
                  {t("menu.cancelPause")}
                </DropdownMenuItem>
              )}
              {line.billingType !== "one_off" && !ended && (
                <DropdownMenuItem onSelect={() => act("cancel")}>
                  <Ban />
                  {line.cancelledOn ? t("menu.changeCancel") : t("menu.cancel")}
                </DropdownMenuItem>
              )}
              {line.billedItemsCount === 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                    <Trash2 />
                    {t("menu.delete")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Confirmación en línea: nunca un modal encima de la ficha. */}
      {confirmDelete && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-2 pl-3">
          <p className="mr-auto text-xs">{previous ? t("deleteConfirmVersion") : t("deleteConfirm")}</p>
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={pending}>
            {tCommon("cancel")}
          </Button>
          <Button variant="destructive" size="sm" onClick={remove} disabled={pending} autoFocus>
            {t("delete")}
          </Button>
        </div>
      )}
    </li>
  );
}
