"use client";

import { CircleCheck, Paperclip, Plus, ReceiptEuro, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import { setExpensePaid } from "@/app/[org]/finance/actions";
import { EXPENSE_STATUSES } from "@/app/[org]/finance/schema";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AllocationBadge, ExpenseStatusBadge, SubscriptionMark } from "./badges";
import { ExpenseSheet, type ExpenseSheetInitial } from "./expense-sheet";
import { useFinanceFormat } from "./format";
import { RebillPanel } from "./rebill-panel";
import type { ExpenseFilters, ExpenseListItem, ExpensesSummary, FinanceConfig, RebillClientGroup } from "./types";

const ALL = "all";
// Ventana de tinykeys para las secuencias "g …": la "c" de "g c" no debe abrir el panel.
const SEQUENCE_MS = 1000;
const SEARCH_DEBOUNCE_MS = 250;
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [role="combobox"], [role="option"], [role="menuitem"]';

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

function filtersQuery(filters: ExpenseFilters): string {
  const params = new URLSearchParams();
  if (filters.month) params.set("month", filters.month);
  if (filters.category) params.set("category", filters.category);
  if (filters.issuer) params.set("issuer", filters.issuer);
  if (filters.status) params.set("status", filters.status);
  if (filters.vendor) params.set("vendor", filters.vendor);
  if (filters.client) params.set("client", filters.client);
  if (filters.rebill) params.set("rebill", filters.rebill);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  const query = params.toString();
  return query ? `?${query}` : "";
}

type Sheet = { mode: "closed" } | { mode: "create" } | { mode: "edit"; id: string };

const CLEARED: Partial<ExpenseFilters> = { month: "", category: "", issuer: "", status: "", vendor: "", client: "", rebill: "", q: "" };

type Props = {
  slug: string;
  rows: ExpenseListItem[];
  truncated: boolean;
  summary: ExpensesSummary;
  filters: ExpenseFilters;
  /** Meses (YYYY-MM) con gastos, del más reciente al más antiguo. */
  months: string[];
  config: FinanceConfig;
  /** Socio u owner: registra, edita y paga gastos. */
  canEdit: boolean;
  today: string;
  /** Gastos de clientes pendientes de repercutir (en toda la org, sin filtros). */
  rebillCount: number;
  /** Con el filtro «Por repercutir»: lo pendiente de cada cliente, para añadirlo a su factura. */
  rebillGroups: RebillClientGroup[] | null;
};

/**
 * Gastos: cifras del filtro, filtros en la URL (mes, categoría, pagador, estado y búsqueda) y la
 * tabla. j/k para moverse, Enter para abrir, c para registrar uno nuevo. El detalle, en un panel.
 */
export function ExpensesList({ slug, rows, truncated, summary, filters, months, config, canEdit, today, rebillCount, rebillGroups }: Props) {
  const t = useTranslations("finance.expenses");
  const tStatus = useTranslations("finance.status");
  const { money, date, month: monthLabel } = useFinanceFormat();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { commandOpen, shortcutsOpen } = useShell();

  const [query, setQuery] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  // La URL manda (atrás/adelante del navegador); lo que se está escribiendo no se pisa.
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q);
    if (filters.q !== query.trim()) setQuery(filters.q);
  }
  const [opened, setSheet] = useState<Sheet>({ mode: "closed" });
  // «Nuevo gasto» desde ⌘K llega como ?new=1 y un gasto concreto como ?expense=<id>, también con el listado ya abierto.
  const expenseParam = searchParams.get("expense");
  const fromUrl: Sheet =
    canEdit && searchParams.get("new") === "1" ? { mode: "create" } : expenseParam ? { mode: "edit", id: expenseParam } : { mode: "closed" };
  const sheet = opened.mode !== "closed" ? opened : fromUrl;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();
  const [paying, startPaying] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  const lastG = useRef(Number.NEGATIVE_INFINITY);

  const activeIndex = activeId ? rows.findIndex((r) => r.id === activeId) : -1;
  const editing = sheet.mode === "edit" ? (rows.find((r) => r.id === sheet.id) ?? null) : null;
  const sheetOpen = sheet.mode === "create" || editing !== null;
  const filtering = Boolean(
    filters.month || filters.category || filters.issuer || filters.status || filters.vendor || filters.client || filters.rebill || filters.q,
  );
  const vendorName = filters.vendor ? (config.vendors.find((v) => v.id === filters.vendor)?.name ?? t("unknownFilter")) : null;
  const clientName = filters.client ? (config.clients.find((c) => c.id === filters.client)?.name ?? t("unknownFilter")) : null;
  // Un gasto nuevo desde la vista de un cliente o de un proveedor ya nace suyo.
  const initial: ExpenseSheetInitial | undefined = filters.client
    ? { allocation: "client", clientId: filters.client }
    : filters.vendor
      ? { vendorId: filters.vendor }
      : undefined;

  const navigate = (next: Partial<ExpenseFilters>) => {
    const href = `${pathname}${filtersQuery({ ...filters, q: query, ...next })}`;
    startNavigation(() => router.replace(href, { scroll: false }));
  };

  useEffect(() => {
    const timer = searchTimer;
    return () => window.clearTimeout(timer.current);
  }, []);

  // Al cerrar el panel, fuera ?new=1 y ?expense= de la URL (sin volver al servidor).
  const closeSheet = () => {
    setSheet({ mode: "closed" });
    if (window.location.search.includes("new=1") || window.location.search.includes("expense=")) {
      window.history.replaceState(null, "", `${pathname}${filtersQuery({ ...filters, q: query })}`);
    }
  };

  const onSearchChange = (value: string) => {
    setQuery(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => navigate({ q: value }), SEARCH_DEBOUNCE_MS);
  };

  const move = (delta: 1 | -1) => {
    if (rows.length === 0) return;
    const nextIndex = activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + delta, 0), rows.length - 1);
    const next = rows[nextIndex]!;
    setActiveId(next.id);
    document.getElementById(`expense-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
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

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = rows[activeIndex] ?? rows[0];
      if (target) setSheet({ mode: "edit", id: target.id });
    } else if (event.key === "Escape") {
      if (query) onSearchChange("");
      else searchRef.current?.blur();
    }
  };

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if (closest(event.target, "a, button")) return;
    setSheet({ mode: "edit", id });
  };

  const markPaid = (row: ExpenseListItem) =>
    startPaying(async () => {
      const result = await setExpensePaid(slug, row.id, { paid_on: today, payment_method: row.paymentMethod ?? "transfer" });
      if (!result.ok) toast.error(result.error);
      else toast.success(t("paidToast", { date: date(today) }));
    });

  const newButton = canEdit ? (
    <Button onClick={() => setSheet({ mode: "create" })}>
      <Plus data-icon="inline-start" />
      {t("new")}
      <Kbd className="ml-1 hidden bg-white/15 text-white sm:inline-flex">C</Kbd>
    </Button>
  ) : null;

  return (
    <div>
      {!canEdit && <ReadOnlyNotice className="mb-4">{t("readOnly")}</ReadOnlyNotice>}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label={t("summary.total")} value={money(summary.totalCents)} hint={t("summary.totalHint", { count: summary.count, base: money(summary.baseCents), vat: money(summary.vatCents) })} />
        <Stat
          label={t("summary.pending")}
          value={money(summary.pendingCents)}
          hint={t("summary.pendingHint", { count: summary.pendingCount })}
          onClick={summary.pendingCount > 0 && filters.status !== "pending" ? () => navigate({ status: "pending" }) : undefined}
        />
        <Stat
          label={t("summary.overdue")}
          value={money(summary.overdueCents)}
          hint={t("summary.overdueHint", { count: summary.overdueCount })}
          tone={summary.overdueCents > 0 ? "destructive" : undefined}
          onClick={summary.overdueCount > 0 && filters.status !== "overdue" ? () => navigate({ status: "overdue" }) : undefined}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              aria-label={t("clearSearch")}
              onClick={() => onSearchChange("")}
            >
              <X />
            </Button>
          )}
        </div>

        <Select value={filters.month || ALL} onValueChange={(v) => navigate({ month: v === ALL ? "" : v })}>
          <SelectTrigger size="sm" className="w-44" aria-label={t("monthFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("monthAll")}</SelectItem>
            {[...new Set([...(filters.month ? [filters.month] : []), ...months])].map((m) => (
              <SelectItem key={m} value={m}>
                <span className="capitalize">{monthLabel(`${m}-01`)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.category || ALL} onValueChange={(v) => navigate({ category: v === ALL ? "" : v })}>
          <SelectTrigger size="sm" className="w-52" aria-label={t("categoryFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("categoryAll")}</SelectItem>
            {config.categories
              .filter((c) => !c.archived || c.id === filters.category)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {config.issuers.length > 1 && (
          <Select value={filters.issuer || ALL} onValueChange={(v) => navigate({ issuer: v === ALL ? "" : v })}>
            <SelectTrigger size="sm" className="w-44" aria-label={t("issuerFilter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("issuerAll")}</SelectItem>
              {config.issuers.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={filters.status || ALL} onValueChange={(v) => navigate({ status: EXPENSE_STATUSES.find((s) => s === v) ?? "" })}>
          <SelectTrigger size="sm" className="w-36" aria-label={t("statusFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("statusAll")}</SelectItem>
            {EXPENSE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {tStatus(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {(rebillCount > 0 || filters.rebill) && (
          <button
            type="button"
            aria-pressed={filters.rebill === "pending"}
            onClick={() => navigate({ rebill: filters.rebill ? "" : "pending" })}
            title={t("rebillFilterHint")}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[0.8rem] font-semibold transition-colors",
              filters.rebill ? "border-warning/50 bg-warning/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span aria-hidden className="size-2 rounded-full bg-warning" />
            {t("rebillFilter")}
            {rebillCount > 0 && <span className="tabular">{rebillCount}</span>}
          </button>
        )}

        {vendorName && <FilterChip label={t("vendorChip", { name: vendorName })} onRemove={() => navigate({ vendor: "" })} />}
        {clientName && <FilterChip label={t("clientChip", { name: clientName })} onRemove={() => navigate({ client: "" })} />}

        {filtering && (
          <Button variant="ghost" size="sm" onClick={() => navigate(CLEARED)}>
            {t("clearFilters")}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <p className="text-xs text-muted-foreground tabular">{t("count", { count: rows.length })}</p>
          {newButton}
        </div>
      </div>

      {filters.rebill === "pending" && rebillGroups && <RebillPanel slug={slug} groups={rebillGroups} canEdit={canEdit} className="mb-4" />}

      {rows.length === 0 ? (
        filtering ? (
          <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
            <Search className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-3 font-semibold">{t("noResultsTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("noResultsBody")}</p>
            <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate(CLEARED)}>
              {t("clearFilters")}
            </Button>
          </div>
        ) : (
          <EmptyState canEdit={canEdit} onCreate={() => setSheet({ mode: "create" })} />
        )
      ) : (
        <div className={cn("overflow-x-auto rounded-2xl border bg-card transition-opacity", navigating && "opacity-60")}>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5 text-xs text-muted-foreground">{t("columns.date")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("columns.concept")}</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground lg:table-cell">{t("columns.category")}</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground 2xl:table-cell">{t("columns.issuer")}</TableHead>
                <TableHead className="hidden text-right text-xs text-muted-foreground 2xl:table-cell">{t("columns.base")}</TableHead>
                <TableHead className="hidden text-right text-xs text-muted-foreground 2xl:table-cell">{t("columns.vat")}</TableHead>
                <TableHead className="text-right text-xs text-muted-foreground">{t("columns.total")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("columns.status")}</TableHead>
                <TableHead className="w-0 pr-5">
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const active = row.id === activeId;
                return (
                  <TableRow
                    key={row.id}
                    id={`expense-row-${row.id}`}
                    data-active={active}
                    aria-selected={active}
                    onClick={(e) => onRowClick(e, row.id)}
                    onMouseMove={() => !active && setActiveId(row.id)}
                    className="group cursor-pointer hover:bg-transparent data-[active=true]:bg-muted/60"
                  >
                    <TableCell className="relative py-2.5 pl-5 text-muted-foreground tabular">
                      <span
                        aria-hidden
                        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100"
                      />
                      {date(row.issuedOn)}
                    </TableCell>
                    <TableCell className="max-w-72 min-w-44">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSheet({ mode: "edit", id: row.id })}
                          className="truncate text-left font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                        >
                          {row.vendorName ?? row.description}
                        </button>
                        {row.source === "subscription" && <SubscriptionMark />}
                        {row.hasAttachment && <Paperclip aria-label={t("hasAttachment")} className="size-3.5 shrink-0 text-muted-foreground" />}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.vendorName ? row.description : null}
                        <span className="lg:hidden">
                          {row.vendorName ? " · " : ""}
                          {row.categoryName}
                        </span>
                        {row.memberName && <span className="text-muted-foreground/80"> · {row.memberName}</span>}
                      </p>
                      {row.allocation !== "company" && (
                        <AllocationBadge allocation={row.allocation} clientName={row.clientName} rebillState={row.rebillState} className="mt-1" />
                      )}
                    </TableCell>
                    <TableCell className="hidden max-w-48 text-muted-foreground lg:table-cell">
                      <span className="block truncate">{row.categoryName}</span>
                    </TableCell>
                    <TableCell className="hidden max-w-40 text-muted-foreground 2xl:table-cell">
                      <span className="block truncate">{row.issuerName}</span>
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular 2xl:table-cell">{money(row.baseCents)}</TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular 2xl:table-cell">
                      {row.vatCents === 0 ? "—" : money(row.vatCents)}
                      {!row.vatDeductible && row.vatCents !== 0 && <span className="ml-1 text-[10px] text-warning">{t("notDeductibleShort")}</span>}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular">{money(row.totalCents)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-0.5">
                        <ExpenseStatusBadge status={row.status} />
                        {row.status !== "paid" && (
                          <span className={cn("text-[11px] tabular", row.status === "overdue" ? "text-destructive" : "text-muted-foreground")}>
                            {t("dueOn", { date: date(row.payableOn) })}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="pr-5">
                      {canEdit && row.status !== "paid" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={t("markPaid")} onClick={() => markPaid(row)} disabled={paying}>
                              <CircleCheck />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("markPaidHint", { date: date(today) })}</TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {truncated && <p className="mt-3 text-xs text-muted-foreground">{t("truncated", { count: rows.length })}</p>}
      {rows.length > 0 && (
        <p className="mt-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          {t.rich(canEdit ? "keyboardHint" : "keyboardHintReadOnly", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}
        </p>
      )}

      <ExpenseSheet
        slug={slug}
        open={sheetOpen}
        onOpenChange={(open) => !open && closeSheet()}
        expense={editing}
        config={config}
        canEdit={canEdit}
        today={today}
        initial={initial}
        onCreated={(id) => {
          setSheet({ mode: "edit", id });
          router.refresh();
        }}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  hint: ReactNode;
  tone?: "destructive";
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 truncate text-2xl font-bold tabular heading-tight", tone === "destructive" && "text-destructive")}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </>
  );
  const className = "block min-w-0 rounded-2xl border bg-card px-4 py-3.5 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(className, "transition-colors hover:bg-muted/40")}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Un filtro que llega por la URL (proveedor, cliente) y se quita con un clic. */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useTranslations("finance.expenses");
  return (
    <span className="inline-flex h-7 max-w-64 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 pr-1 pl-2.5 text-[0.8rem] font-semibold">
      <span className="truncate">{label}</span>
      <Button variant="ghost" size="icon-xs" className="rounded-full" aria-label={t("removeFilter", { name: label })} onClick={onRemove}>
        <X />
      </Button>
    </span>
  );
}

function EmptyState({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  const t = useTranslations("finance.expenses");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
        <ReceiptEuro className="size-5" />
      </div>
      <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("emptyTitle")}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
      {canEdit ? (
        <>
          <Button className="mt-6" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">{t.rich("emptyHint", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}</p>
        </>
      ) : (
        <p className="mt-6 text-xs text-muted-foreground">{t("emptyReadOnly")}</p>
      )}
    </div>
  );
}
