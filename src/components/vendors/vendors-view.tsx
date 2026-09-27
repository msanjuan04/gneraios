"use client";

import { ArrowDown, ArrowUp, Plus, Search, Truck, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type MouseEvent, type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  countVendorKinds,
  DEFAULT_VENDOR_SORT,
  filterVendors,
  nextVendorSort,
  sortVendors,
  VENDOR_KIND_FILTERS,
  type VendorKindFilter,
  vendorListTotals,
  type VendorSort,
  type VendorSortKey,
} from "@/domain/vendors";
import { cn } from "@/lib/utils";
import { useVendorFormat } from "./format";
import type { VendorListItem, VendorsPageData } from "./types";
import { VendorKindPill } from "./vendor-kind";
import { VendorSheet } from "./vendor-sheet";

type Props = {
  slug: string;
  basePath: string;
  data: VendorsPageData;
  /** Socio u owner: da de alta y edita proveedores. */
  canEdit: boolean;
  /** Lo que llega en la URL (?kind=…&archived=1&q=…&new=1). */
  initial: { kind: VendorKindFilter; showArchived: boolean; query: string; openNew: boolean };
};

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * Finanzas → Proveedores: quién nos factura (empresas y freelancers), cuánto nos cuesta este año y
 * en total, lo que falta pagarle y para cuántos clientes ha trabajado. Filtros en la URL; toda la
 * fila abre la ficha.
 */
export function VendorsView({ slug, basePath, data, canEdit, initial }: Props) {
  const t = useTranslations("vendors.list");
  const router = useRouter();
  const pathname = usePathname();
  const fmt = useVendorFormat();

  const [kind, setKind] = useState<VendorKindFilter>(initial.kind);
  const [showArchived, setShowArchived] = useState(initial.showArchived);
  const [query, setQuery] = useState(initial.query);
  const [sort, setSort] = useState<VendorSort>(DEFAULT_VENDOR_SORT);
  const [creating, setCreating] = useState(canEdit && initial.openNew);

  const { vendors } = data;
  const archivedCount = vendors.filter((v) => v.archived).length;
  const counts = countVendorKinds(vendors, showArchived);
  const visible = useMemo(() => sortVendors(filterVendors(vendors, { query, kind, showArchived }), sort), [vendors, query, kind, showArchived, sort]);
  const totals = vendorListTotals(visible);
  const overdueCents = visible.reduce((sum, v) => sum + v.overdueCents, 0);
  const filtering = query.trim() !== "" || kind !== "all";
  const href = (id: string) => `${basePath}/finance/vendors/${id}`;

  // Los filtros viven en la URL (atrás/adelante y enlaces), sin volver al servidor.
  const syncUrl = (next: { kind: VendorKindFilter; showArchived: boolean; query: string }) => {
    const params = new URLSearchParams();
    if (next.kind !== "all") params.set("kind", next.kind);
    if (next.showArchived) params.set("archived", "1");
    if (next.query.trim()) params.set("q", next.query.trim());
    const search = params.toString();
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
  };
  const changeKind = (next: VendorKindFilter) => {
    setKind(next);
    syncUrl({ kind: next, showArchived, query });
  };
  const changeArchived = (next: boolean) => {
    setShowArchived(next);
    syncUrl({ kind, showArchived: next, query });
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    syncUrl({ kind, showArchived, query: next });
  };
  const resetFilters = () => {
    setQuery("");
    setKind("all");
    syncUrl({ kind: "all", showArchived, query: "" });
  };
  const closeCreate = (open: boolean) => {
    setCreating(open);
    if (!open && initial.openNew) syncUrl({ kind, showArchived, query });
  };

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (closest(event.target, "a, button")) return;
    if (event.metaKey || event.ctrlKey) window.open(href(id), "_blank", "noopener");
    else router.push(href(id));
  };

  const newButton = canEdit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus data-icon="inline-start" />
      {t("new")}
    </Button>
  ) : null;

  const head = "h-9 text-xs text-muted-foreground";
  const sortable = (key: VendorSortKey, label: string, className?: string) => (
    <SortableHead
      key={key}
      label={label}
      sortLabel={t("columns.sortBy", { column: label })}
      active={sort.key === key}
      direction={sort.direction}
      onClick={() => setSort((s) => nextVendorSort(s, key))}
      className={cn(head, className)}
    />
  );

  return (
    <div>
      {!canEdit && <ReadOnlyNotice className="mb-4">{t("readOnly")}</ReadOnlyNotice>}

      {vendors.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={() => setCreating(true)} />
      ) : (
        <>
          <section aria-label={t("summary.label")} className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border bg-card/60 px-4 py-3">
            <p className="text-sm">
              <span className="font-bold">{t("summary.vendors", { count: visible.length })}</span>
              <span className="text-muted-foreground"> · {t("summary.freelancers", { count: visible.filter((v) => v.kind === "freelancer").length })}</span>
            </p>
            <SummaryFigure label={t("summary.year")} value={fmt.money(totals.yearCostCents)} />
            <SummaryFigure label={t("summary.total")} value={fmt.money(totals.costCents)} />
            <SummaryFigure
              label={t("summary.pending")}
              value={fmt.money(totals.pendingCents)}
              hint={overdueCents > 0 ? t("summary.overdue", { amount: fmt.money(overdueCents) }) : undefined}
            />
          </section>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && changeQuery("")}
                placeholder={t("search")}
                aria-label={t("search")}
                className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <Button variant="ghost" size="icon-xs" className="absolute top-1/2 right-1 -translate-y-1/2" aria-label={t("clearSearch")} onClick={() => changeQuery("")}>
                  <X />
                </Button>
              )}
            </div>
            <div role="group" aria-label={t("filters.label")} className="flex flex-wrap items-center gap-1">
              {VENDOR_KIND_FILTERS.map((f) => (
                <FilterChip key={f} active={kind === f} count={counts[f]} onClick={() => changeKind(f)}>
                  {t(`filters.${f}`)}
                </FilterChip>
              ))}
            </div>
            {archivedCount > 0 && (
              <label className="flex h-7 cursor-pointer items-center gap-2 rounded-full px-2 text-[0.8rem] font-semibold text-muted-foreground hover:text-foreground">
                <Switch size="sm" checked={showArchived} onCheckedChange={changeArchived} />
                {t("showArchived", { count: archivedCount })}
              </label>
            )}
            {newButton && <div className="ml-auto">{newButton}</div>}
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <Search className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 font-semibold">{t("noResultsTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("noResultsBody")}</p>
              {filtering && (
                <Button variant="ghost" size="sm" className="mt-4" onClick={resetFilters}>
                  {t("showAll")}
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {sortable("name", t("columns.vendor"), "pl-5")}
                    <TableHead className={cn(head, "hidden md:table-cell")}>{t("columns.taxId")}</TableHead>
                    {sortable("yearCost", t("columns.yearCost"), "text-right")}
                    {sortable("cost", t("columns.cost"), "hidden text-right sm:table-cell")}
                    {sortable("pending", t("columns.pending"), "text-right")}
                    {sortable("clients", t("columns.clients"), "hidden text-right lg:table-cell")}
                    {sortable("lastExpense", t("columns.lastExpense"), "hidden pr-5 text-right xl:table-cell")}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((vendor) => (
                    <VendorRow key={vendor.id} vendor={vendor} href={href(vendor.id)} fmt={fmt} onClick={(e) => onRowClick(e, vendor.id)} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {canEdit && (
        <VendorSheet
          slug={slug}
          open={creating}
          onOpenChange={closeCreate}
          categories={data.categories}
          onSaved={(id, _created, name) =>
            toast.success(t("createdToast", { name }), { action: { label: t("open"), onClick: () => router.push(href(id)) } })
          }
        />
      )}
    </div>
  );
}

function VendorRow({
  vendor,
  href,
  fmt,
  onClick,
}: {
  vendor: VendorListItem;
  href: string;
  fmt: ReturnType<typeof useVendorFormat>;
  onClick: (event: MouseEvent<HTMLTableRowElement>) => void;
}) {
  const t = useTranslations("vendors.list");
  const secondary = [vendor.contactName, vendor.email].filter(Boolean).join(" · ");
  const none = <span className="text-muted-foreground/60">—</span>;
  return (
    <TableRow onClick={onClick} className={cn("group cursor-pointer", vendor.archived && "text-muted-foreground")}>
      <TableCell className="max-w-0 py-2 pl-5 md:w-[34%]">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={href} className="truncate font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline">
            {vendor.name}
          </Link>
          <VendorKindPill kind={vendor.kind} />
          {vendor.archived && (
            <Badge variant="outline" className="text-muted-foreground">
              {t("archived")}
            </Badge>
          )}
        </div>
        {(secondary || vendor.taxId) && (
          <p className="truncate text-xs text-muted-foreground">
            {secondary}
            {vendor.taxId && (
              <span className="font-mono md:hidden">
                {secondary ? " · " : ""}
                {vendor.taxId}
              </span>
            )}
          </p>
        )}
      </TableCell>
      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">{vendor.taxId ?? none}</TableCell>
      <TableCell className="text-right font-semibold tabular">{vendor.yearCostCents === 0 && vendor.yearExpensesCount === 0 ? none : fmt.money(vendor.yearCostCents)}</TableCell>
      <TableCell className="hidden text-right text-muted-foreground tabular sm:table-cell">{vendor.expensesCount === 0 ? none : fmt.money(vendor.costCents)}</TableCell>
      <TableCell className="text-right tabular">
        {vendor.pendingCount === 0 ? (
          none
        ) : (
          <>
            <span className="font-semibold">{fmt.money(vendor.pendingCents)}</span>
            {vendor.overdueCents > 0 && <span className="block text-[11px] text-destructive">{t("overdueHint", { amount: fmt.money(vendor.overdueCents) })}</span>}
          </>
        )}
      </TableCell>
      <TableCell className="hidden text-right text-muted-foreground tabular lg:table-cell">{vendor.clientsCount === 0 ? none : vendor.clientsCount}</TableCell>
      <TableCell className="hidden pr-5 text-right text-xs whitespace-nowrap text-muted-foreground tabular xl:table-cell">
        {vendor.lastExpenseOn ? fmt.date(vendor.lastExpenseOn) : <span className="text-muted-foreground/60">{t("noExpenses")}</span>}
      </TableCell>
    </TableRow>
  );
}

function SortableHead({
  label,
  sortLabel,
  active,
  direction,
  onClick,
  className,
}: {
  label: string;
  sortLabel: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
  const right = className?.includes("text-right");
  return (
    <TableHead aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <button
        type="button"
        onClick={onClick}
        title={sortLabel}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          right && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <Arrow aria-hidden className={cn("size-3", active ? "opacity-100" : "opacity-0")} />
      </button>
    </TableHead>
  );
}

function SummaryFigure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <p className="flex items-baseline gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-bold tabular">{value}</span>
      {hint && <span className="text-xs font-semibold text-destructive">{hint}</span>}
    </p>
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

function EmptyState({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  const t = useTranslations("vendors.empty");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground">
        <Truck className="size-5" />
      </div>
      <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("title")}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("body")}</p>
      {canEdit ? (
        <Button className="mt-6" onClick={onCreate}>
          <Plus data-icon="inline-start" />
          {t("create")}
        </Button>
      ) : (
        <p className="mt-6 text-xs text-muted-foreground">{t("readOnly")}</p>
      )}
    </div>
  );
}
