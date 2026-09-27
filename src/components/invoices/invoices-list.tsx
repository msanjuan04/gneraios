"use client";

import { CircleCheck, CircleX, Clock, Plus, Receipt, RefreshCw, Search, Send, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { issueDrafts, runBillingNow } from "@/app/[org]/invoices/actions";
import { LIST_FILTERS, type ListFilter } from "@/app/[org]/invoices/schema";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { daysBetween } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { InvoiceImportButton } from "@/components/invoice-import/invoice-import-button";
import { useInvoiceFormat } from "./format";
import { InlineConfirm } from "./inline-confirm";
import { InvoiceKindBadge, InvoiceStatusBadge } from "./invoice-status-badge";
import { InvoicesNav } from "./invoices-nav";
import type { InvoiceListItem, InvoicesSummary, IssueResult, LastBillingRun } from "./types";

const TABS: ListFilter[] = [...LIST_FILTERS, "all"];
// Ventana de tinykeys para las secuencias "g …": la "c" de "g c" no debe crear nada.
const SEQUENCE_MS = 1000;
const SEARCH_DEBOUNCE_MS = 250;
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [role="checkbox"], [role="combobox"], [role="option"], [role="menuitem"]';

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

function listHref(basePath: string, params: { filter: ListFilter; q: string; clientId: string | null }): string {
  const search = new URLSearchParams();
  if (params.filter !== "all") search.set("status", params.filter);
  if (params.q.trim()) search.set("q", params.q.trim());
  if (params.clientId) search.set("client", params.clientId);
  const query = search.toString();
  return `${basePath}/invoices${query ? `?${query}` : ""}`;
}

type ResultRow = IssueResult & { clientName: string };

type Props = {
  basePath: string;
  slug: string;
  filter: ListFilter;
  q: string;
  client: { id: string; name: string } | null;
  rows: InvoiceListItem[];
  truncated: boolean;
  summary: InvoicesSummary;
  lastRun: LastBillingRun | null;
  /** Socio u owner: emite, factura ahora y crea facturas manuales. */
  canEdit: boolean;
  today: string;
  timeZone: string;
  outboxCount: number;
};

/**
 * Listado de facturas: cifras de lo pendiente, pestañas por estado (en la URL), búsqueda por
 * número o cliente y, en borradores, selección para emitir en bloque y «Facturar ahora».
 */
export function InvoicesList({
  basePath,
  slug,
  filter,
  q,
  client,
  rows,
  truncated,
  summary,
  lastRun,
  canEdit,
  today,
  timeZone,
  outboxCount,
}: Props) {
  const t = useTranslations("invoices");
  const tFilter = useTranslations("invoices.filters");
  const { money, date } = useInvoiceFormat();
  const router = useRouter();
  const { commandOpen, shortcutsOpen } = useShell();

  const [query, setQuery] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  // La URL manda (atrás/adelante del navegador); lo que se está escribiendo no se pisa.
  if (q !== syncedQ) {
    setSyncedQ(q);
    if (q !== query.trim()) setQuery(q);
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [busy, setBusy] = useState<"issue" | "billing" | null>(null);
  const [navigating, startNavigation] = useTransition();
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | undefined>(undefined);
  const lastG = useRef(Number.NEGATIVE_INFINITY);

  const selectable = filter === "draft" && canEdit;
  const chosen = selectable ? rows.filter((r) => selected.has(r.id)) : [];
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const ownDates = chosen.filter((r) => r.issuedOn !== null).length;
  const activeIndex = activeId ? rows.findIndex((r) => r.id === activeId) : -1;
  const invoiceHref = (id: string) => `${basePath}/invoices/${id}`;
  const hrefFor = (patch: Partial<{ filter: ListFilter; q: string; clientId: string | null }>) =>
    listHref(basePath, { filter, q: query, clientId: client?.id ?? null, ...patch });

  const navigate = (href: string) => startNavigation(() => router.replace(href, { scroll: false }));

  // Una búsqueda pendiente nunca debe devolver al listado a quien ya ha abierto otra página.
  const cancelSearch = () => window.clearTimeout(searchTimer.current);
  useEffect(() => {
    const timer = searchTimer;
    return () => window.clearTimeout(timer.current);
  }, []);

  const onSearchChange = (value: string) => {
    setQuery(value);
    cancelSearch();
    searchTimer.current = window.setTimeout(() => {
      if (window.location.pathname === `${basePath}/invoices`) navigate(hrefFor({ q: value }));
    }, SEARCH_DEBOUNCE_MS);
  };

  const clearSearch = () => {
    cancelSearch();
    setQuery("");
    navigate(hrefFor({ q: "" }));
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = (delta: 1 | -1) => {
    if (rows.length === 0) return;
    const nextIndex = activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + delta, 0), rows.length - 1);
    const next = rows[nextIndex]!;
    setActiveId(next.id);
    document.getElementById(`invoice-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
  };

  const openActive = (fallbackToFirst: boolean) => {
    const target = rows[activeIndex] ?? (fallbackToFirst ? rows[0] : undefined);
    if (!target) return;
    cancelSearch();
    router.push(invoiceHref(target.id));
  };

  const listIsFocused = (event: KeyboardEvent) =>
    !commandOpen && !shortcutsOpen && results === null && !closest(event.target, OVERLAY);

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
    x: (event) => {
      if (!selectable || !listIsFocused(event) || activeIndex === -1) return;
      event.preventDefault();
      toggle(rows[activeIndex]!.id);
    },
    Enter: (event) => {
      if (!listIsFocused(event) || closest(event.target, INTERACTIVE) || activeIndex === -1) return;
      event.preventDefault();
      openActive(false);
    },
    Escape: (event) => {
      if (!listIsFocused(event) || selected.size === 0) return;
      setSelected(new Set());
      setConfirmBulk(false);
    },
    c: (event) => {
      if (!canEdit || !listIsFocused(event) || event.timeStamp - lastG.current < SEQUENCE_MS) return;
      event.preventDefault();
      cancelSearch();
      router.push(`${basePath}/invoices/new${client ? `?client=${client.id}` : ""}`);
    },
  });

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openActive(true);
    } else if (event.key === "Escape") {
      if (query) clearSearch();
      else searchRef.current?.blur();
    }
  };

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if (closest(event.target, "a, button, [role='checkbox']")) return;
    if (event.metaKey || event.ctrlKey) window.open(invoiceHref(id), "_blank", "noopener");
    else {
      cancelSearch();
      router.push(invoiceHref(id));
    }
  };

  const issueSelected = () => {
    const ids = chosen.map((r) => r.id);
    const names = new Map(chosen.map((r) => [r.id, r.clientName]));
    setBusy("issue");
    startTransition(async () => {
      const result = await issueDrafts(slug, ids);
      setBusy(null);
      setConfirmBulk(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const failed = result.results.filter((r) => !r.ok);
      const ok = result.results.length - failed.length;
      // Las que fallan siguen seleccionadas para reintentarlas cuando estén corregidas.
      setSelected(new Set(failed.map((r) => r.invoiceId)));
      setResults(result.results.map((r) => ({ ...r, clientName: names.get(r.invoiceId) ?? "" })));
      if (failed.length === 0) toast.success(t("bulk.toastOk", { count: ok }));
      else toast.warning(t("bulk.toastPartial", { ok, failed: failed.length }));
    });
  };

  const runBilling = () => {
    setBusy("billing");
    startTransition(async () => {
      const result = await runBillingNow(slug);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.drafts === 0 && result.itemsCreated === 0 && result.emails === 0
          ? t("billingRun.nothing")
          : t("billingRun.done", { drafts: result.drafts, items: result.itemsCreated, emails: result.emails }),
      );
    });
  };

  const newHref = `${basePath}/invoices/new${client ? `?client=${client.id}` : ""}`;
  const headerActions = canEdit ? (
    <div className="flex flex-wrap items-center gap-2">
      {/* Las facturas emitidas con otra herramienta: se leen del PDF y quedan con su original. */}
      <InvoiceImportButton slug={slug} clientId={client?.id ?? null} />
      <Button asChild>
        <Link href={newHref}>
          <Plus data-icon="inline-start" />
          {t("new")}
          <Kbd className="ml-1 hidden bg-white/15 text-white sm:inline-flex">C</Kbd>
        </Link>
      </Button>
    </div>
  ) : undefined;

  const billingControls = (
    <div className="ml-auto flex flex-wrap items-center gap-3">
      <LastRun run={lastRun} timeZone={timeZone} />
      {canEdit && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={runBilling} disabled={busy !== null}>
              <RefreshCw data-icon="inline-start" className={cn(busy === "billing" && "animate-spin")} />
              {busy === "billing" ? t("billingRun.running") : t("billingRun.run")}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{t("billingRun.hint")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={t("title")} description={t("description")} actions={headerActions} />
      <InvoicesNav basePath={basePath} outboxCount={outboxCount} />
      {!canEdit && <ReadOnlyNotice className="-mt-2 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label={t("summary.pending")}
          value={money(summary.pendingCents)}
          hint={t("summary.pendingHint", { count: summary.pendingCount })}
        />
        <Stat
          label={t("summary.overdue")}
          value={money(summary.overdueCents)}
          hint={t("summary.overdueHint", { count: summary.overdueCount })}
          tone={summary.overdueCents > 0 ? "destructive" : undefined}
          href={summary.overdueCount > 0 ? hrefFor({ filter: "overdue" }) : undefined}
        />
        <Stat
          label={t("summary.drafts")}
          value={String(summary.draftsCount)}
          hint={t("summary.draftsHint", { count: summary.draftsCount, amount: money(summary.draftsTotalCents) })}
          href={summary.draftsCount > 0 ? hrefFor({ filter: "draft" }) : undefined}
        />
      </div>

      {summary.counts.all === 0 ? (
        <EmptyState canEdit={canEdit} newHref={newHref} billing={billingControls} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <nav aria-label={tFilter("label")} className="flex flex-wrap gap-1 rounded-full border bg-card/60 p-1">
              {TABS.map((tab) => {
                const active = tab === filter;
                return (
                  <Link
                    key={tab}
                    href={hrefFor({ filter: tab })}
                    scroll={false}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8rem] font-semibold transition-colors",
                      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tFilter(tab)}
                    <span className={cn("tabular", active ? "text-muted-foreground" : "text-muted-foreground/70", tab === "overdue" && summary.counts.overdue > 0 && "text-destructive")}>
                      {summary.counts[tab]}
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={t("list.searchPlaceholder")}
                aria-label={t("list.searchLabel")}
                className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  aria-label={t("list.clearSearch")}
                  onClick={clearSearch}
                >
                  <X />
                </Button>
              )}
            </div>

            {client && (
              <Link
                href={hrefFor({ clientId: null })}
                scroll={false}
                aria-label={t("list.clearClient")}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-primary/10 px-3 text-[0.8rem] font-semibold text-primary hover:bg-primary/15"
              >
                {t("list.clientFilter", { name: client.name })}
                <X className="size-3.5" />
              </Link>
            )}

            <p className="ml-auto text-xs text-muted-foreground tabular">{t("list.count", { count: rows.length })}</p>
          </div>

          {filter === "draft" && (
            <div className="mb-3 flex min-h-9 flex-wrap items-center gap-3">
              {confirmBulk && chosen.length > 0 ? (
                <InlineConfirm
                  className="w-full"
                  icon={<Send className="text-primary" />}
                  confirmLabel={busy === "issue" ? t("bulk.issuing") : t("bulk.confirmAction", { count: chosen.length })}
                  onConfirm={issueSelected}
                  onCancel={() => setConfirmBulk(false)}
                  pending={busy === "issue"}
                >
                  <p>{t("bulk.confirm", { count: chosen.length, date: date(today) })}</p>
                  {ownDates > 0 && <p className="mt-0.5 text-muted-foreground">{t("bulk.confirmOwnDates", { count: ownDates })}</p>}
                </InlineConfirm>
              ) : (
                <>
                  {selectable && rows.length > 0 && (
                    <>
                      <label className="flex h-7 cursor-pointer items-center gap-2 rounded-full px-2 text-[0.8rem] font-semibold text-muted-foreground hover:text-foreground">
                        <Checkbox
                          checked={allChosen ? true : chosen.length > 0 ? "indeterminate" : false}
                          onCheckedChange={() => setSelected(allChosen ? new Set() : new Set(rows.map((r) => r.id)))}
                          aria-label={t("list.selectAll")}
                        />
                        {chosen.length > 0 ? t("list.selection", { count: chosen.length }) : t("list.selectAll")}
                      </label>
                      <Button size="sm" onClick={() => setConfirmBulk(true)} disabled={chosen.length === 0 || busy !== null}>
                        <Send data-icon="inline-start" />
                        {t("list.issueSelected")}
                      </Button>
                    </>
                  )}
                  {billingControls}
                </>
              )}
            </div>
          )}

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <Search className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 font-semibold">{query || client ? t("list.noResultsTitle") : t("list.emptyFilterTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {query || client ? t("list.noResultsBody") : t(`list.emptyFilter.${filter}`)}
              </p>
              {(query || client || filter !== "all") && (
                <Button asChild variant="ghost" size="sm" className="mt-4">
                  <Link href={listHref(basePath, { filter: "all", q: "", clientId: null })} scroll={false}>
                    {t("list.clearFilters")}
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div className={cn("overflow-hidden rounded-2xl border bg-card transition-opacity", navigating && "opacity-60")}>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {selectable && <TableHead className="w-10 pl-5" />}
                    <TableHead className={cn("text-xs text-muted-foreground", !selectable && "pl-5")}>{t("list.columns.number")}</TableHead>
                    <TableHead className="text-xs text-muted-foreground">{t("list.columns.client")}</TableHead>
                    <TableHead className="hidden text-xs text-muted-foreground 2xl:table-cell">{t("list.columns.issuer")}</TableHead>
                    <TableHead className="hidden text-xs text-muted-foreground sm:table-cell">{t("list.columns.date")}</TableHead>
                    <TableHead className="hidden text-xs text-muted-foreground md:table-cell">{t("list.columns.due")}</TableHead>
                    <TableHead className="hidden text-right text-xs text-muted-foreground xl:table-cell">
                      <ColumnHint label={t("list.columns.base")} hint={t("list.columns.baseHint")} />
                    </TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">
                      <ColumnHint label={t("list.columns.total")} hint={t("list.columns.totalHint")} />
                    </TableHead>
                    <TableHead className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                      <ColumnHint label={t("list.columns.outstanding")} hint={t("list.columns.outstandingHint")} />
                    </TableHead>
                    <TableHead className="pr-5 text-xs text-muted-foreground">{t("list.columns.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const active = row.id === activeId;
                    const isSelected = selected.has(row.id);
                    const overdueDays = row.status === "overdue" && row.dueOn ? daysBetween(row.dueOn, today) : 0;
                    const collectible = row.kind === "ordinary" && ["issued", "overdue", "paid"].includes(row.status);
                    return (
                      <TableRow
                        key={row.id}
                        id={`invoice-row-${row.id}`}
                        data-active={active}
                        data-state={isSelected ? "selected" : undefined}
                        aria-selected={active}
                        onClick={(e) => onRowClick(e, row.id)}
                        onMouseMove={() => !active && setActiveId(row.id)}
                        className={cn(
                          "group cursor-pointer hover:bg-transparent data-[active=true]:bg-muted/60 data-[state=selected]:bg-primary/10",
                          row.status === "voided" && "text-muted-foreground",
                        )}
                      >
                        {selectable && (
                          <TableCell className="relative w-10 pl-5">
                            <span
                              aria-hidden
                              className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100"
                            />
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggle(row.id)}
                              aria-label={t("list.selectRow", { name: row.clientName })}
                            />
                          </TableCell>
                        )}
                        <TableCell className={cn("relative py-2.5", !selectable && "pl-5")}>
                          {!selectable && (
                            <span
                              aria-hidden
                              className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100"
                            />
                          )}
                          <div className="flex items-center gap-2">
                            <Link
                              href={invoiceHref(row.id)}
                              className={cn(
                                "outline-none hover:text-primary focus-visible:text-primary focus-visible:underline",
                                row.number ? "font-mono font-semibold" : "font-semibold text-muted-foreground italic",
                              )}
                            >
                              {row.number ?? t("list.draft")}
                            </Link>
                            <InvoiceKindBadge kind={row.kind} />
                          </div>
                        </TableCell>
                        <TableCell className="min-w-44 max-w-72">
                          <span className="block truncate font-medium">{row.clientName}</span>
                          {/* Emisor y serie como subtítulo: la columna propia solo en pantallas muy anchas. */}
                          <span className="block truncate text-xs text-muted-foreground 2xl:hidden">
                            {row.issuerName}
                            {row.seriesCode && <span className="text-muted-foreground/70"> · {row.seriesCode}</span>}
                          </span>
                        </TableCell>
                        <TableCell className="hidden max-w-48 text-muted-foreground 2xl:table-cell">
                          <span className="block truncate">
                            {row.issuerName}
                            {row.seriesCode && <span className="text-muted-foreground/70"> · {row.seriesCode}</span>}
                          </span>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground tabular sm:table-cell">
                          {row.issuedOn ? date(row.issuedOn) : <span className="text-muted-foreground/70">{t("list.onIssue")}</span>}
                        </TableCell>
                        <TableCell className="hidden tabular md:table-cell">
                          {row.dueOn && row.kind === "ordinary" ? (
                            <span className={cn(row.status === "overdue" ? "text-destructive" : "text-muted-foreground")}>
                              {date(row.dueOn)}
                              {overdueDays > 0 && <span className="ml-1 text-xs">({t("list.overdueDays", { count: overdueDays })})</span>}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/70">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-right text-muted-foreground tabular xl:table-cell">{money(row.subtotalCents)}</TableCell>
                        <TableCell className="text-right font-semibold tabular">{money(row.totalCents)}</TableCell>
                        <TableCell
                          className={cn(
                            "hidden text-right tabular sm:table-cell",
                            row.status === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground",
                          )}
                        >
                          {collectible ? money(row.outstandingCents) : "—"}
                        </TableCell>
                        <TableCell className="pr-5">
                          <InvoiceStatusBadge status={row.status} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {truncated && <p className="mt-3 text-xs text-muted-foreground">{t("list.truncated", { count: rows.length })}</p>}

          <p className="mt-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            {t.rich(selectable ? "list.keyboardHintDrafts" : canEdit ? "list.keyboardHint" : "list.keyboardHintReadOnly", {
              kbd: (chunks) => <Kbd>{chunks}</Kbd>,
            })}
          </p>
        </>
      )}

      <IssueResultsSheet basePath={basePath} results={results} onClose={() => setResults(null)} />
    </div>
  );
}

function ColumnHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  hint: ReactNode;
  tone?: "destructive";
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-1 truncate text-2xl font-bold tabular heading-tight", tone === "destructive" && "text-destructive")}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </>
  );
  const className = "block min-w-0 rounded-2xl border bg-card px-4 py-3.5";
  return href ? (
    <Link href={href} scroll={false} className={cn(className, "transition-colors hover:bg-muted/40")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

function LastRun({ run, timeZone }: { run: LastBillingRun | null; timeZone: string }) {
  const t = useTranslations("invoices.billingRun");
  const { time, date } = useInvoiceFormat();
  if (!run) return <span className="text-xs text-muted-foreground">{t("never")}</span>;
  const at = time(run.startedAt, timeZone);
  const when = run.day === "earlier" ? t("when.earlier", { date: date(run.runOn), time: at }) : t(`when.${run.day}`, { time: at });
  const Icon = run.status === "succeeded" ? CircleCheck : run.status === "failed" ? CircleX : Clock;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        run.status === "failed" ? "text-destructive" : "text-muted-foreground",
      )}
      title={run.error ?? undefined}
    >
      <Icon className={cn("size-3.5", run.status === "succeeded" && "text-success")} />
      {t("last", { when, status: t(`status.${run.status}`) })}
    </span>
  );
}

function EmptyState({ canEdit, newHref, billing }: { canEdit: boolean; newHref: string; billing: ReactNode }) {
  const t = useTranslations("invoices.list");
  const tRoot = useTranslations("invoices");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white">
        <Receipt className="size-5" />
      </div>
      <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("emptyTitle")}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
      {canEdit ? (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button asChild>
              <Link href={newHref}>
                <Plus data-icon="inline-start" />
                {tRoot("new")}
              </Link>
            </Button>
          </div>
          <div className="mx-auto mt-4 flex max-w-md justify-center">{billing}</div>
          <p className="mt-3 text-xs text-muted-foreground">{t.rich("emptyHint", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}</p>
        </>
      ) : (
        <p className="mt-6 text-xs text-muted-foreground">{t("emptyReadOnly")}</p>
      )}
    </div>
  );
}

/** Resultado de la emisión en bloque, factura por factura: su número o por qué no se emitió. */
function IssueResultsSheet({ basePath, results, onClose }: { basePath: string; results: ResultRow[] | null; onClose: () => void }) {
  const t = useTranslations("invoices.bulk");
  const ok = results?.filter((r) => r.ok).length ?? 0;
  const failed = (results?.length ?? 0) - ok;
  return (
    <SettingsSheet
      open={results !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("resultsTitle")}
      description={t("resultsDescription", { ok, failed })}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {failed > 0 && <p className="mb-3 text-xs text-muted-foreground">{t("failedHint")}</p>}
        <ul className="divide-y rounded-xl border">
          {(results ?? []).map((r) => (
            <li key={r.invoiceId} className="flex items-start gap-3 px-4 py-3 text-sm">
              {r.ok ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.clientName || "—"}</p>
                {r.ok ? (
                  <p className="text-xs text-muted-foreground">
                    {t.rich("issuedAs", { number: r.number, strong: (chunks) => <strong className="font-mono text-foreground">{chunks}</strong> })}
                  </p>
                ) : (
                  <p className="text-xs text-destructive">{r.error}</p>
                )}
              </div>
              <Button asChild variant="ghost" size="xs">
                <Link href={`${basePath}/invoices/${r.invoiceId}`} onClick={onClose}>
                  {t("open")}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end border-t px-5 py-3">
        <Button variant="secondary" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </SettingsSheet>
  );
}
