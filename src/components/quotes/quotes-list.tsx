"use client";

import { FileText, LayoutTemplate, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, useMemo, useRef, useState } from "react";
import { QUOTE_STATES, readStateFilter } from "@/app/[org]/quotes/schema";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useQuoteFormat } from "./format";
import { QuoteStateBadge } from "./quote-state-badge";
import type { QuoteListItem, QuoteState } from "./types";

type Filters = { q: string; state: QuoteState | "" };

// Ventana de tinykeys para las secuencias "g …": la "c" de "g c" no debe crear nada.
const SEQUENCE_MS = 1000;
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [role="combobox"], [role="option"], [role="menuitem"]';

function filtersQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.state) params.set("state", filters.state);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Minúsculas y sin acentos: "Mataró" y "mataro" son lo mismo al buscar. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/** Importe del listado: lo puntual y cada cuota por separado, nunca sumados. */
function QuoteAmounts({ quote }: { quote: QuoteListItem }) {
  const t = useTranslations("quotes.list");
  const { whole, perCycle } = useQuoteFormat();
  const parts = [
    quote.oneOffCents > 0 ? whole(quote.oneOffCents) : null,
    quote.monthlyCents > 0 ? perCycle(quote.monthlyCents, "monthly", true) : null,
    quote.yearlyCents > 0 ? perCycle(quote.yearlyCents, "yearly", true) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) {
    return <span className="text-muted-foreground">{quote.usageCount > 0 ? t("usageOnly") : "—"}</span>;
  }
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="font-semibold tabular">{parts.join(" + ")}</span>
      {quote.usageCount > 0 && <span className="text-xs text-muted-foreground">{t("plusUsage")}</span>}
    </span>
  );
}

type Props = {
  basePath: string;
  quotes: QuoteListItem[];
  /** Socio u owner: puede crear presupuestos. */
  canEdit: boolean;
};

export function QuotesList({ basePath, quotes, canEdit }: Props) {
  const t = useTranslations("quotes");
  const tState = useTranslations("quotes.state");
  const { date } = useQuoteFormat();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { commandOpen, shortcutsOpen } = useShell();

  // Los filtros viven aquí y se copian a la URL (sin ir al servidor): se pueden compartir y sobreviven a recargar.
  const [filters, setFilters] = useState<Filters>(() => ({
    q: searchParams.get("q") ?? "",
    state: readStateFilter(searchParams.get("state")),
  }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastG = useRef(Number.NEGATIVE_INFINITY);

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    window.history.replaceState(null, "", `${pathname}${filtersQuery(next)}`);
  };

  const index = useMemo(
    () =>
      quotes.map((quote) => ({
        quote,
        haystack: fold([quote.number, quote.title, quote.clientName, quote.dealTitle].filter(Boolean).join(" ")),
      })),
    [quotes],
  );

  const counts = useMemo(() => {
    const out: Record<QuoteState, number> = { draft: 0, sent: 0, expired: 0, accepted: 0, rejected: 0 };
    for (const quote of quotes) out[quote.state] += 1;
    return out;
  }, [quotes]);

  const visible = useMemo(() => {
    const terms = fold(filters.q).split(/\s+/).filter(Boolean);
    return index
      .filter(({ quote, haystack }) => (!filters.state || quote.state === filters.state) && terms.every((term) => haystack.includes(term)))
      .map((entry) => entry.quote);
  }, [index, filters]);

  const activeIndex = activeId ? visible.findIndex((q) => q.id === activeId) : -1;
  const quoteHref = (id: string) => `${basePath}/quotes/${id}`;
  const newHref = `${basePath}/quotes/new`;
  const filtering = filters.q.trim() !== "" || filters.state !== "";

  const move = (delta: 1 | -1) => {
    if (visible.length === 0) return;
    const nextIndex = activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + delta, 0), visible.length - 1);
    const next = visible[nextIndex]!;
    setActiveId(next.id);
    document.getElementById(`quote-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
  };

  const openActive = (fallbackToFirst: boolean) => {
    const target = visible[activeIndex] ?? (fallbackToFirst ? visible[0] : undefined);
    if (target) router.push(quoteHref(target.id));
  };

  const listIsFocused = (event: KeyboardEvent) => !commandOpen && !shortcutsOpen && !closest(event.target, OVERLAY);

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
      openActive(false);
    },
    c: (event) => {
      if (!canEdit || !listIsFocused(event) || event.timeStamp - lastG.current < SEQUENCE_MS) return;
      event.preventDefault();
      router.push(newHref);
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
      if (filters.q) updateFilters({ q: "" });
      else searchRef.current?.blur();
    }
  };

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if (closest(event.target, "a, button")) return;
    if (event.metaKey || event.ctrlKey) window.open(quoteHref(id), "_blank", "noopener");
    else router.push(quoteHref(id));
  };

  const newButton = (
    <>
      <Button asChild variant="outline">
        <Link href={`${basePath}/quotes/templates`}>
          <LayoutTemplate data-icon="inline-start" />
          {t("templates.title")}
        </Link>
      </Button>
      {canEdit && (
        <Button asChild>
          <Link href={newHref}>
            <Plus data-icon="inline-start" />
            {t("new")}
            <Kbd className="ml-1 hidden bg-white/15 text-white sm:inline-flex">C</Kbd>
          </Link>
        </Button>
      )}
    </>
  );

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} actions={newButton} />
      {!canEdit && <ReadOnlyNotice className="-mt-4 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      {quotes.length === 0 ? (
        <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
            <FileText className="size-5" />
          </div>
          <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("list.emptyTitle")}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("list.emptyBody")}</p>
          {canEdit && (
            <>
              <Button asChild className="mt-6">
                <Link href={newHref}>
                  <Plus data-icon="inline-start" />
                  {t("new")}
                </Link>
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">{t.rich("list.emptyHint", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                value={filters.q}
                onChange={(e) => updateFilters({ q: e.target.value })}
                onKeyDown={onSearchKeyDown}
                placeholder={t("list.searchPlaceholder")}
                aria-label={t("list.searchLabel")}
                className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
              />
              {filters.q && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  aria-label={t("list.clearSearch")}
                  onClick={() => updateFilters({ q: "" })}
                >
                  <X />
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("list.stateFilter")}>
              <Button
                variant={filters.state === "" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={filters.state === ""}
                onClick={() => updateFilters({ state: "" })}
              >
                {t("list.stateAll")}
                <span className="text-muted-foreground tabular">{quotes.length}</span>
              </Button>
              {QUOTE_STATES.filter((state) => counts[state] > 0 || filters.state === state).map((state) => (
                <Button
                  key={state}
                  variant={filters.state === state ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={filters.state === state}
                  onClick={() => updateFilters({ state: filters.state === state ? "" : state })}
                >
                  {tState(state)}
                  <span className="text-muted-foreground tabular">{counts[state]}</span>
                </Button>
              ))}
            </div>

            <p className="ml-auto text-xs text-muted-foreground tabular">{t("list.count", { count: visible.length })}</p>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <Search className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 font-semibold">{t("list.noResultsTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("list.noResultsBody")}</p>
              {filtering && (
                <Button variant="ghost" size="sm" className="mt-4" onClick={() => updateFilters({ q: "", state: "" })}>
                  {t("list.clearFilters")}
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 text-xs text-muted-foreground">{t("list.columns.number")}</TableHead>
                    <TableHead className="text-xs text-muted-foreground">{t("list.columns.quote")}</TableHead>
                    <TableHead className="text-xs text-muted-foreground">{t("list.columns.state")}</TableHead>
                    <TableHead className="hidden text-xs text-muted-foreground md:table-cell">{t("list.columns.issuedOn")}</TableHead>
                    <TableHead className="hidden text-xs text-muted-foreground lg:table-cell">{t("list.columns.validUntil")}</TableHead>
                    <TableHead className="pr-5 text-right text-xs text-muted-foreground">{t("list.columns.amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((quote) => {
                    const active = quote.id === activeId;
                    return (
                      <TableRow
                        key={quote.id}
                        id={`quote-row-${quote.id}`}
                        data-active={active}
                        aria-selected={active}
                        onClick={(e) => onRowClick(e, quote.id)}
                        onMouseMove={() => !active && setActiveId(quote.id)}
                        className="group cursor-pointer hover:bg-transparent data-[active=true]:bg-muted/60"
                      >
                        <TableCell className="relative w-32 py-2.5 pl-5">
                          <span
                            aria-hidden
                            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100"
                          />
                          {quote.number ? (
                            <span className="font-mono text-[13px] font-semibold">{quote.number}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t("list.noNumber")}</span>
                          )}
                        </TableCell>
                        {/* max-w-0 + un ancho en % es lo que deja truncar dentro de una tabla. */}
                        <TableCell className="w-[45%] max-w-0 py-2.5">
                          <Link
                            href={quoteHref(quote.id)}
                            className="block truncate font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                          >
                            {quote.title}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {quote.dealTitle && quote.dealTitle !== quote.title ? `${quote.clientName} · ${quote.dealTitle}` : quote.clientName}
                          </p>
                        </TableCell>
                        <TableCell>
                          <QuoteStateBadge state={quote.state} />
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground tabular md:table-cell">
                          {quote.issuedOn ? date(quote.issuedOn) : "—"}
                        </TableCell>
                        <TableCell
                          className={cn("hidden tabular lg:table-cell", quote.state === "expired" ? "text-warning" : "text-muted-foreground")}
                        >
                          {quote.validUntil ? date(quote.validUntil) : "—"}
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <QuoteAmounts quote={quote} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="mt-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            {t.rich(canEdit ? "list.keyboardHint" : "list.keyboardHintReadOnly", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}
          </p>
        </>
      )}
    </div>
  );
}
