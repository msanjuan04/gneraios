"use client";

import { Activity, ListPlus, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useShell } from "@/components/app-shell/shell-context";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BulkSitesSheet } from "./bulk-sheet";
import { SITES_FILTERS, type SitesFilter } from "./filters";
import { useSiteFormat } from "./format";
import { useCheckNow } from "./site-actions";
import { SiteSheet } from "./site-sheet";
import { SitesTable } from "./sites-table";
import { ThresholdsSheet } from "./thresholds-sheet";
import type { SiteListItem, SitesPageData } from "./types";

/** Cada cuánto se vuelve a pedir la página (el cron comprueba cada 5 minutos). */
const REFRESH_MS = 60_000;

/** Minúsculas y sin acentos: "Mataró" y "mataro" son lo mismo al buscar. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

type Editing = { open: boolean; site: SiteListItem | null };

type Props = {
  slug: string;
  basePath: string;
  data: SitesPageData;
  canEdit: boolean;
  isOwner: boolean;
  initialFilter: SitesFilter;
  /** Abrir el alta nada más llegar (?new=1, p. ej. desde la ficha de un cliente). */
  openNew: boolean;
  newClientId: string | null;
};

/** Webs: el estado de todas las webs vigiladas, con sus filtros y los paneles de alta y edición. */
export function SitesView({ slug, basePath, data, canEdit, isOwner, initialFilter, openNew, newClientId }: Props) {
  const t = useTranslations("sites");
  const router = useRouter();
  const pathname = usePathname();
  const { preview } = useShell();
  const fmt = useSiteFormat();
  const { check, pendingId } = useCheckNow(slug);

  const [filter, setFilter] = useState<SitesFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>({ open: canEdit && openNew, site: null });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [thresholdsOpen, setThresholdsOpen] = useState(false);
  const anySheetOpen = editing.open || bulkOpen || thresholdsOpen;

  // Los estados cambian solos (el cron): la página se vuelve a pedir cada minuto, salvo con un panel abierto.
  useEffect(() => {
    if (preview || anySheetOpen) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router, preview, anySheetOpen]);

  const changeFilter = (next: SitesFilter) => {
    setFilter(next);
    window.history.replaceState(null, "", next === "all" ? pathname : `${pathname}?filter=${next}`);
  };

  const closeEditing = (open: boolean) => {
    setEditing((e) => ({ ...e, open }));
    if (!open && openNew) window.history.replaceState(null, "", pathname);
  };

  const { sites } = data;
  const counts = useMemo(
    () => ({
      all: sites.length,
      problems: sites.filter((s) => s.problem).length,
      hosted: sites.filter((s) => s.hostedByUs).length,
      up: sites.filter((s) => s.status === "up" || s.status === "slow").length,
      down: sites.filter((s) => s.status === "down").length,
      slow: sites.filter((s) => s.status === "slow").length,
      expiring: sites.filter((s) => s.status !== "paused" && (s.ssl?.severity === "warning" || s.ssl?.severity === "expired" || s.domain?.severity === "warning" || s.domain?.severity === "expired")).length,
      unknown: sites.filter((s) => s.status === "unknown").length,
      paused: sites.filter((s) => s.status === "paused").length,
    }),
    [sites],
  );

  const visible = useMemo(() => {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    return sites.filter((s) => {
      if (filter === "problems" && !s.problem) return false;
      if (filter === "hosted" && !s.hostedByUs) return false;
      const haystack = fold(`${s.name} ${s.displayUrl} ${s.clientName ?? ""}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [sites, filter, query]);

  const actions = (
    <>
      {isOwner && (
        <Button variant="ghost" onClick={() => setThresholdsOpen(true)}>
          <SlidersHorizontal data-icon="inline-start" />
          {t("thresholds.open")}
        </Button>
      )}
      {canEdit && (
        <>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <ListPlus data-icon="inline-start" />
            {t("bulk.open")}
          </Button>
          <Button onClick={() => setEditing({ open: true, site: null })}>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        </>
      )}
    </>
  );

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} actions={canEdit || isOwner ? actions : undefined} />
      {!canEdit && <ReadOnlyNotice className="-mt-4 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      {sites.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={() => setEditing({ open: true, site: null })} onBulk={() => setBulkOpen(true)} />
      ) : (
        <>
          <section aria-label={t("summary.label")} className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border bg-card/60 px-4 py-3">
            <SummaryItem dot="bg-success" value={counts.up} label={t("summary.up", { count: counts.up })} />
            <SummaryItem
              dot="bg-destructive"
              value={counts.down}
              label={t("summary.down", { count: counts.down })}
              onClick={counts.down > 0 ? () => changeFilter("problems") : undefined}
              emphasis={counts.down > 0}
            />
            <SummaryItem
              dot="bg-warning"
              value={counts.expiring}
              label={t("summary.expiring", { count: counts.expiring })}
              onClick={counts.expiring > 0 ? () => changeFilter("problems") : undefined}
            />
            <p className="ml-auto text-xs text-muted-foreground">
              {[
                counts.slow > 0 ? t("summary.slow", { count: counts.slow }) : null,
                counts.unknown > 0 ? t("summary.unknown", { count: counts.unknown }) : null,
                counts.paused > 0 ? t("summary.paused", { count: counts.paused }) : null,
                t("summary.cadence"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </section>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("filters.label")} className="flex flex-wrap items-center gap-1">
              {SITES_FILTERS.map((f) => (
                <FilterChip key={f} active={filter === f} count={counts[f]} onClick={() => changeFilter(f)}>
                  {t(`filters.${f}`)}
                </FilterChip>
              ))}
            </div>
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                placeholder={t("filters.search")}
                aria-label={t("filters.search")}
                className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  aria-label={t("filters.clear")}
                  onClick={() => setQuery("")}
                >
                  <X />
                </Button>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <Search className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 font-semibold">{filter === "problems" && !query ? t("filters.noProblemsTitle") : t("filters.noResultsTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{filter === "problems" && !query ? t("filters.noProblemsBody") : t("filters.noResultsBody")}</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setQuery("");
                  changeFilter("all");
                }}
              >
                {t("filters.showAll")}
              </Button>
            </div>
          ) : (
            <SitesTable
              slug={slug}
              basePath={basePath}
              sites={visible}
              fmt={fmt}
              slowMs={data.thresholds.slowMs}
              canEdit={canEdit}
              checkingId={pendingId}
              onCheck={check}
              onEdit={(site) => setEditing({ open: true, site })}
            />
          )}
        </>
      )}

      {canEdit && (
        <>
          <SiteSheet
            slug={slug}
            open={editing.open}
            onOpenChange={closeEditing}
            clients={data.clients}
            site={editing.site}
            defaultClientId={editing.site ? null : newClientId}
          />
          <BulkSitesSheet
            slug={slug}
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            clients={data.clients}
            existingUrls={sites.map((s) => s.url)}
            onAdded={(added) => {
              // Las primeras comprobaciones se hacen justo después: se vuelve a pedir la página al rato.
              if (added > 0) setTimeout(() => router.refresh(), 15_000);
            }}
          />
        </>
      )}
      {isOwner && <ThresholdsSheet slug={slug} open={thresholdsOpen} onOpenChange={setThresholdsOpen} thresholds={data.thresholds} />}
    </div>
  );
}

function SummaryItem({ dot, value, label, onClick, emphasis }: { dot: string; value: number; label: string; onClick?: () => void; emphasis?: boolean }) {
  const content = (
    <>
      <span aria-hidden className={cn("size-2 rounded-full", value === 0 ? "bg-muted-foreground/30" : dot)} />
      <span className={cn("text-lg font-bold heading-tight", emphasis && "text-destructive")}>{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-lg outline-none hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50">
      {content}
    </button>
  ) : (
    <div className="flex items-center gap-2">{content}</div>
  );
}

function FilterChip({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[0.8rem] font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "border-primary/40 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      <span className={cn("tabular", active ? "text-primary/80" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

function EmptyState({ canEdit, onCreate, onBulk }: { canEdit: boolean; onCreate: () => void; onBulk: () => void }) {
  const t = useTranslations("sites.empty");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground">
        <Activity className="size-5" />
      </div>
      <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("title")}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("body")}</p>
      {canEdit ? (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={onBulk}>
            <ListPlus data-icon="inline-start" />
            {t("bulk")}
          </Button>
          <Button variant="outline" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {t("one")}
          </Button>
        </div>
      ) : (
        <p className="mt-6 text-xs text-muted-foreground">{t("readOnly")}</p>
      )}
    </div>
  );
}
