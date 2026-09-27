"use client";

import { Plus, RefreshCw, Repeat } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type MouseEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { generateSubscriptionsNow, setSubscriptionActive } from "@/app/[org]/finance/actions";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { addDays } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { AllocationBadge } from "./badges";
import { useFinanceFormat } from "./format";
import { SubscriptionSheet } from "./subscription-sheet";
import type { FinanceConfig, SubscriptionListItem } from "./types";

const SEQUENCE_MS = 1000;
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [role="switch"], [role="combobox"], [role="option"]';
const closest = (target: EventTarget | null, selector: string) => target instanceof Element && target.closest(selector) !== null;

type Sheet = { mode: "closed" } | { mode: "create" } | { mode: "edit"; id: string };

/**
 * Suscripciones de gasto: lo que se paga cada mes o cada año. Cada una genera sus gastos el día
 * del cargo (el cron, cada día; o «Generar ahora»). j/k, Enter y c como en los demás listados.
 */
export function SubscriptionsList({
  slug,
  rows,
  config,
  canEdit,
  today,
}: {
  slug: string;
  rows: SubscriptionListItem[];
  config: FinanceConfig;
  canEdit: boolean;
  today: string;
}) {
  const t = useTranslations("finance.subscriptions");
  const tInterval = useTranslations("finance.intervals");
  const tAllocation = useTranslations("finance.allocation");
  const { money, date, dateShort, percent } = useFinanceFormat();
  const { commandOpen, shortcutsOpen } = useShell();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [opened, setSheet] = useState<Sheet>({ mode: "closed" });
  // «Nueva suscripción» desde un enlace (?new=1), también con el listado ya abierto.
  const sheet: Sheet = opened.mode !== "closed" ? opened : canEdit && searchParams.get("new") === "1" ? { mode: "create" } : opened;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const lastG = useRef(Number.NEGATIVE_INFINITY);

  const active = rows.filter((r) => r.isActive);
  const monthlyTotal = active.reduce((sum, r) => sum + r.monthlyCostCents, 0);
  const soon = addDays(today, 30);
  const next30 = active.filter((r) => r.nextChargeOn && r.nextChargeOn <= soon).reduce((sum, r) => sum + r.chargeTotalCents, 0);
  const editing = sheet.mode === "edit" ? (rows.find((r) => r.id === sheet.id) ?? null) : null;
  const sheetOpen = sheet.mode === "create" || editing !== null;
  const activeIndex = activeId ? rows.findIndex((r) => r.id === activeId) : -1;

  const move = (delta: 1 | -1) => {
    if (rows.length === 0) return;
    const next = rows[activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + delta, 0), rows.length - 1)]!;
    setActiveId(next.id);
    document.getElementById(`subscription-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
  };
  const listIsFocused = (event: KeyboardEvent) => !sheetOpen && !commandOpen && !shortcutsOpen && !closest(event.target, OVERLAY);

  useHotkeys({
    g: (event) => {
      lastG.current = event.timeStamp;
    },
    j: (event) => {
      if (!listIsFocused(event)) return;
      event.preventDefault();
      move(1);
    },
    k: (event) => {
      if (!listIsFocused(event)) return;
      event.preventDefault();
      move(-1);
    },
    Enter: (event) => {
      if (!listIsFocused(event) || closest(event.target, INTERACTIVE) || activeIndex === -1) return;
      event.preventDefault();
      setSheet({ mode: "edit", id: rows[activeIndex]!.id });
    },
    c: (event) => {
      if (!canEdit || !listIsFocused(event) || event.timeStamp - lastG.current < SEQUENCE_MS) return;
      event.preventDefault();
      setSheet({ mode: "create" });
    },
  });

  const toggle = (row: SubscriptionListItem, on: boolean) =>
    startTransition(async () => {
      const result = await setSubscriptionActive(slug, row.id, on);
      if (!result.ok) toast.error(result.error);
      else toast.success(on ? (result.generated > 0 ? t("onGenerated", { count: result.generated }) : t("onToast")) : t("offToast"));
    });

  const generate = () =>
    startTransition(async () => {
      const result = await generateSubscriptionsNow(slug);
      if (!result.ok) toast.error(result.error);
      else toast.success(result.created > 0 ? t("generated", { count: result.created }) : t("nothingToGenerate"));
    });

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if (closest(event.target, INTERACTIVE)) return;
    setSheet({ mode: "edit", id });
  };

  return (
    <div>
      {!canEdit && <ReadOnlyNotice className="mb-4">{t("readOnly")}</ReadOnlyNotice>}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border bg-card px-4 py-3.5">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("monthly")}</p>
          <p className="mt-1 text-2xl font-bold tabular heading-tight">{money(monthlyTotal)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("monthlyHint", { count: active.length })}</p>
        </div>
        <div className="rounded-2xl border bg-card px-4 py-3.5">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("next30")}</p>
          <p className="mt-1 text-2xl font-bold tabular heading-tight">{money(next30)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("next30Hint")}</p>
        </div>
        <div className="flex flex-col justify-center gap-2 rounded-2xl border bg-card px-4 py-3.5">
          {canEdit && (
            <>
              <Button onClick={() => setSheet({ mode: "create" })}>
                <Plus data-icon="inline-start" />
                {t("new")}
                <Kbd className="ml-1 hidden bg-white/15 text-white sm:inline-flex">C</Kbd>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={generate} disabled={pending}>
                    <RefreshCw data-icon="inline-start" className={cn(pending && "animate-spin")} />
                    {t("generate")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{t("generateHint")}</TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white">
            <Repeat className="size-5" />
          </div>
          <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("emptyTitle")}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5 text-xs text-muted-foreground">{t("columns.subscription")}</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground lg:table-cell">{t("columns.category")}</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground md:table-cell">{t("columns.schedule")}</TableHead>
                <TableHead className="text-right text-xs text-muted-foreground">{t("columns.charge")}</TableHead>
                <TableHead className="hidden text-right text-xs text-muted-foreground sm:table-cell">{t("columns.monthly")}</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground md:table-cell">{t("columns.next")}</TableHead>
                <TableHead className="pr-5 text-xs text-muted-foreground">{t("columns.active")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isActive = row.id === activeId;
                return (
                  <TableRow
                    key={row.id}
                    id={`subscription-row-${row.id}`}
                    data-active={isActive}
                    onClick={(e) => onRowClick(e, row.id)}
                    onMouseMove={() => !isActive && setActiveId(row.id)}
                    className={cn("group cursor-pointer hover:bg-transparent data-[active=true]:bg-muted/60", !row.isActive && "text-muted-foreground")}
                  >
                    <TableCell className="relative max-w-72 min-w-44 py-2.5 pl-5">
                      <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100" />
                      <button
                        type="button"
                        onClick={() => setSheet({ mode: "edit", id: row.id })}
                        className="block max-w-full truncate text-left font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                      >
                        {row.description}
                      </button>
                      <p className="truncate text-xs text-muted-foreground">
                        {[row.vendorName, row.issuerName, row.memberName].filter(Boolean).join(" · ")}
                      </p>
                      {row.allocation !== "company" && (
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                          <AllocationBadge allocation={row.allocation} clientName={row.clientName} />
                          {row.rebill && (
                            <span className="text-[10px] font-semibold text-warning">
                              {row.rebillMarkupBps ? tAllocation("rebillsMarkup", { percent: percent(row.rebillMarkupBps) }) : tAllocation("rebills")}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-44 text-muted-foreground lg:table-cell">
                      <span className="block truncate">{row.categoryName}</span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {row.interval === "monthly" ? t("monthlyOn", { day: row.billingDay ?? 1 }) : t("yearlyOn", { date: dateShort(row.startsOn) })}
                      {row.endsOn && <span className="block text-[11px]">{t("until", { date: date(row.endsOn) })}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      <span className="font-semibold">{money(row.chargeTotalCents)}</span>
                      <span className="block text-[11px] text-muted-foreground">{tInterval(`per.${row.interval}`)}</span>
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular sm:table-cell">{money(row.monthlyCostCents)}</TableCell>
                    <TableCell className="hidden text-muted-foreground tabular md:table-cell">
                      {row.nextChargeOn ? date(row.nextChargeOn) : "—"}
                      <span className="block text-[11px]">{t("generatedCount", { count: row.generatedCount })}</span>
                    </TableCell>
                    <TableCell className="pr-5">
                      <Switch
                        size="sm"
                        checked={row.isActive}
                        disabled={!canEdit || pending}
                        onCheckedChange={(on) => toggle(row, on)}
                        aria-label={t("toggle", { name: row.description })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t("footnote")}</p>

      <SubscriptionSheet
        slug={slug}
        open={sheetOpen}
        onOpenChange={(open) => {
          if (open) return;
          setSheet({ mode: "closed" });
          if (searchParams.has("new")) window.history.replaceState(null, "", pathname);
        }}
        subscription={editing}
        config={config}
        canEdit={canEdit}
        today={today}
      />
    </div>
  );
}
