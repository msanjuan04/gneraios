"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  Copy,
  Ellipsis,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { useCatalogFormat } from "@/components/catalog/format";
import { SortableList } from "@/components/catalog/sortable-list";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { ReadOnlyNotice, SettingsSectionHeader } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  bundleLines,
  CATALOG_BILLING_TYPES,
  CATALOG_CATEGORIES,
  type CatalogBundle,
  type CatalogCategory,
  type CatalogItem,
  catalogTotals,
  type CatalogVatRate,
  isTranslated,
  resolveVatRateId,
  TRANSLATED_LOCALES,
} from "@/domain/catalog";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import {
  archiveCatalogBundle,
  archiveCatalogItem,
  createStarterCatalog,
  duplicateCatalogBundle,
  duplicateCatalogItem,
  reorderCatalogBundles,
  reorderCatalogItems,
  restoreCatalogBundle,
  restoreCatalogItem,
} from "@/server/catalog/actions";
import type { CatalogData } from "@/server/catalog/queries";
import { BundleSheet, type BundleSheetState } from "./bundle-sheet";
import { ItemSheet, type ItemSheetState } from "./item-sheet";

type Archiving = { kind: "item"; item: CatalogItem } | { kind: "bundle"; bundle: CatalogBundle } | null;

/** Orden estable dentro de una lista: por posición y, a igualdad, por nombre. */
function byPosition<T extends { position: number; name: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es") || (a.id < b.id ? -1 : 1));
}

/** Aplica un orden nuevo (los ids, en ese orden) a las posiciones de unas filas. */
function withOrder<T extends { id: string; position: number }>(rows: readonly T[], ids: readonly string[]): T[] {
  const index = new Map(ids.map((id, position) => [id, position]));
  return rows.map((row) => (index.has(row.id) ? { ...row, position: index.get(row.id)! } : row));
}

/** Intercambia un elemento con su vecino (arriba o abajo): el orden nuevo, o null si no se puede. */
function swapped(ids: readonly string[], id: string, delta: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/**
 * Ajustes → Catálogo: los servicios por categoría (con su precio, su recurrencia y su IVA) y los
 * packs, en el orden en que se proponen al presupuestar (se ordenan arrastrando). Los edita un
 * socio en el panel lateral, con la vista previa de su línea en castellano, catalán e inglés.
 */
export function CatalogManager({ slug, catalog, canEdit }: { slug: string; catalog: CatalogData; canEdit: boolean }) {
  const t = useTranslations("catalog");
  const [itemSheet, setItemSheet] = useState<ItemSheetState>(null);
  const [bundleSheet, setBundleSheet] = useState<BundleSheetState>(null);
  const [archiving, setArchiving] = useState<Archiving>(null);
  const [pending, startTransition] = useTransition();

  // Orden optimista: el que se ve mientras se guarda. Cuando llegan datos nuevos del servidor, mandan ellos.
  const [source, setSource] = useState(catalog);
  const [items, setItems] = useState(catalog.items);
  const [bundles, setBundles] = useState(catalog.bundles);
  if (source !== catalog) {
    setSource(catalog);
    setItems(catalog.items);
    setBundles(catalog.bundles);
  }

  const activeItems = items.filter((item) => item.isActive);
  const archivedItems = items.filter((item) => !item.isActive);
  const activeBundles = byPosition(bundles.filter((bundle) => bundle.isActive));
  const archivedBundles = bundles.filter((bundle) => !bundle.isActive);
  const groups = CATALOG_CATEGORIES.map((category) => ({
    category,
    items: byPosition(activeItems.filter((item) => item.category === category)),
  })).filter((group) => group.items.length > 0);
  const empty = items.length === 0 && bundles.length === 0;

  useHotkeys({
    c: () => {
      if (canEdit && !itemSheet && !bundleSheet) setItemSheet({ item: null });
    },
  });

  const run = (action: () => Promise<ActionResult>, success?: string, rollback?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        rollback?.();
        toast.error(result.error);
      } else if (success) toast.success(success);
    });

  const reorderItems = (ids: string[]) => {
    const previous = items;
    setItems((current) => withOrder(current, ids));
    run(() => reorderCatalogItems(slug, ids), undefined, () => setItems(previous));
  };

  const reorderBundles = (ids: string[]) => {
    const previous = bundles;
    setBundles((current) => withOrder(current, ids));
    run(() => reorderCatalogBundles(slug, ids), undefined, () => setBundles(previous));
  };

  const moveItem = (item: CatalogItem, delta: -1 | 1) => {
    const ids = byPosition(activeItems.filter((i) => i.category === item.category)).map((i) => i.id);
    const next = swapped(ids, item.id, delta);
    if (next) reorderItems(next);
  };

  const moveBundle = (bundle: CatalogBundle, delta: -1 | 1) => {
    const next = swapped(
      activeBundles.map((b) => b.id),
      bundle.id,
      delta,
    );
    if (next) reorderBundles(next);
  };

  const confirmArchive = () => {
    const target = archiving;
    if (!target) return;
    startTransition(async () => {
      const result =
        target.kind === "item" ? await archiveCatalogItem(slug, target.item.id) : await archiveCatalogBundle(slug, target.bundle.id);
      if (!result.ok) toast.error(result.error);
      else toast.success(t(target.kind === "item" ? "toasts.archived" : "toasts.bundleArchived", { name: target.kind === "item" ? target.item.name : target.bundle.name }));
      setArchiving(null);
    });
  };

  const createStarter = () =>
    startTransition(async () => {
      const result = await createStarterCatalog(slug);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("empty.starterToast", { count: result.count }));
    });

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        title={t("title")}
        description={t("description")}
        actions={
          canEdit && !empty ? (
            <>
              <Button variant="outline" onClick={() => setBundleSheet({ bundle: null })}>
                <PackagePlus data-icon="inline-start" />
                {t("newBundle")}
              </Button>
              <Button onClick={() => setItemSheet({ item: null })}>
                <Plus data-icon="inline-start" />
                {t("newItem")}
                <Kbd className="ml-0.5 bg-white/15 text-white">C</Kbd>
              </Button>
            </>
          ) : undefined
        }
      />
      {!canEdit && <ReadOnlyNotice>{t("readOnly")}</ReadOnlyNotice>}

      {empty ? (
        <EmptyCatalog canEdit={canEdit} pending={pending} onStarter={createStarter} onCreate={() => setItemSheet({ item: null })} />
      ) : (
        <>
          {groups.length === 0 ? (
            <p className="rounded-2xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">{t("list.noActive")}</p>
          ) : (
            groups.map(({ category, items: rows }) => (
              <CategoryCard key={category} category={category} count={rows.length} onAdd={canEdit ? () => setItemSheet({ item: null, category }) : undefined}>
                <SortableList
                  id={`catalog-${category}`}
                  items={rows}
                  label={(item) => item.name}
                  disabled={!canEdit}
                  onReorder={reorderItems}
                  className="divide-y"
                  renderItem={(item, handle) => (
                    <ItemRow
                      item={item}
                      handle={handle}
                      vatRates={catalog.vatRates}
                      canEdit={canEdit}
                      isFirst={rows[0]?.id === item.id}
                      isLast={rows.at(-1)?.id === item.id}
                      onEdit={() => setItemSheet({ item })}
                      onDuplicate={() => run(() => duplicateCatalogItem(slug, item.id), t("toasts.duplicated", { name: item.name }))}
                      onMove={(delta) => moveItem(item, delta)}
                      onArchive={() => setArchiving({ kind: "item", item })}
                    />
                  )}
                />
              </CategoryCard>
            ))
          )}

          <section className="rounded-2xl border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <h3 className="font-bold">{t("bundles.title")}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("bundles.description")}</p>
              </div>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => setBundleSheet({ bundle: null })}>
                  <Plus data-icon="inline-start" />
                  {t("newBundle")}
                </Button>
              )}
            </header>
            {activeBundles.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("bundles.empty")}</p>
            ) : (
              <SortableList
                id="catalog-bundles"
                items={activeBundles}
                label={(bundle) => bundle.name}
                disabled={!canEdit}
                onReorder={reorderBundles}
                className="divide-y"
                renderItem={(bundle, handle) => (
                  <BundleRow
                    bundle={bundle}
                    handle={handle}
                    items={items}
                    vatRates={catalog.vatRates}
                    canEdit={canEdit}
                    isFirst={activeBundles[0]?.id === bundle.id}
                    isLast={activeBundles.at(-1)?.id === bundle.id}
                    onEdit={() => setBundleSheet({ bundle })}
                    onDuplicate={() => run(() => duplicateCatalogBundle(slug, bundle.id), t("toasts.bundleDuplicated", { name: bundle.name }))}
                    onMove={(delta) => moveBundle(bundle, delta)}
                    onArchive={() => setArchiving({ kind: "bundle", bundle })}
                  />
                )}
              />
            )}
          </section>

          {(archivedItems.length > 0 || archivedBundles.length > 0) && (
            <details className="group rounded-2xl border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="font-bold">{t("archived.title", { count: archivedItems.length + archivedBundles.length })}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t("archived.description")}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <ul className="divide-y border-t">
                {[...archivedItems.map((item) => ({ kind: "item" as const, item })), ...archivedBundles.map((bundle) => ({ kind: "bundle" as const, bundle }))].map(
                  (row) => {
                    const name = row.kind === "item" ? row.item.name : row.bundle.name;
                    const id = row.kind === "item" ? row.item.id : row.bundle.id;
                    return (
                      <li key={id} className="flex min-h-11 items-center gap-3 px-4 py-1.5 text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <Badge variant="outline" className="text-muted-foreground">
                          {row.kind === "item" ? t(`categories.${row.item.category}`) : t("bundles.one")}
                        </Badge>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => (row.kind === "item" ? restoreCatalogItem(slug, id) : restoreCatalogBundle(slug, id)),
                                t("toasts.restored", { name }),
                              )
                            }
                          >
                            <ArchiveRestore data-icon="inline-start" />
                            {t("list.restore")}
                          </Button>
                        )}
                      </li>
                    );
                  },
                )}
              </ul>
            </details>
          )}
        </>
      )}

      <ItemSheet
        slug={slug}
        state={itemSheet}
        onClose={() => setItemSheet(null)}
        vatRates={catalog.vatRates}
        defaultVatRateId={catalog.defaultVatRateId}
      />
      <BundleSheet slug={slug} state={bundleSheet} onClose={() => setBundleSheet(null)} items={items} vatRates={catalog.vatRates} />
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={t("archive.title", { name: archiving?.kind === "item" ? archiving.item.name : (archiving?.bundle.name ?? "") })}
        description={archiving?.kind === "bundle" ? t("archive.bundleBody") : t("archive.body")}
        confirmLabel={t("list.archive")}
        onConfirm={confirmArchive}
        pending={pending}
      />
    </div>
  );
}

function EmptyCatalog({
  canEdit,
  pending,
  onStarter,
  onCreate,
}: {
  canEdit: boolean;
  pending: boolean;
  onStarter: () => void;
  onCreate: () => void;
}) {
  const t = useTranslations("catalog.empty");
  const tCatalog = useTranslations("catalog");
  return (
    <div className="rounded-2xl border border-dashed px-6 py-14 text-center">
      <div className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Package className="size-5" />
      </div>
      <h3 className="mt-4 text-2xl font-extrabold heading-tight">{t("title")}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{canEdit ? t("body") : t("readOnly")}</p>
      {canEdit && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={onStarter} disabled={pending}>
              <Sparkles data-icon="inline-start" />
              {pending ? t("starterPending") : t("starter")}
            </Button>
            <Button variant="outline" onClick={onCreate} disabled={pending}>
              <Plus data-icon="inline-start" />
              {tCatalog("newItem")}
              <Kbd className="ml-0.5">C</Kbd>
            </Button>
          </div>
          <p className="mx-auto mt-4 max-w-md text-xs text-muted-foreground">{t("starterHint")}</p>
        </>
      )}
    </div>
  );
}

function CategoryCard({
  category,
  count,
  onAdd,
  children,
}: {
  category: CatalogCategory;
  count: number;
  onAdd?: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("catalog");
  return (
    <section className="rounded-2xl border bg-card" aria-labelledby={`catalog-category-${category}`}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <h3 id={`catalog-category-${category}`} className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {t(`categories.${category}`)}
          <span className="ml-2 font-medium tabular">{count}</span>
        </h3>
        {onAdd && (
          <Button variant="ghost" size="xs" onClick={onAdd} aria-label={t("list.addTo", { category: t(`categories.${category}`) })}>
            <Plus data-icon="inline-start" />
            {t("list.add")}
          </Button>
        )}
      </header>
      {children}
    </section>
  );
}

/** Qué idiomas tiene traducidos (el castellano siempre): CA y EN, apagados si salen en castellano. */
function LocaleMarks({ source }: { source: Pick<CatalogItem, "name" | "description" | "translations"> }) {
  const t = useTranslations("catalog.list");
  const tLanguage = useTranslations("catalog.languages");
  return (
    <span className="hidden shrink-0 items-center gap-1 lg:flex">
      {TRANSLATED_LOCALES.map((locale) => {
        const done = isTranslated(source, locale);
        return (
          <Tooltip key={locale}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "rounded px-1 text-[10px] font-semibold tracking-wide",
                  done ? "bg-primary/10 text-primary" : "text-muted-foreground/50 line-through decoration-muted-foreground/40",
                )}
              >
                {locale.toUpperCase()}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {done ? t("translated", { language: tLanguage(locale) }) : t("notTranslated", { language: tLanguage(locale) })}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}

function RowMenu({
  isFirst,
  isLast,
  onEdit,
  onDuplicate,
  onMove,
  onArchive,
}: {
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onMove: (delta: -1 | 1) => void;
  onArchive: () => void;
}) {
  const t = useTranslations("catalog.list");
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={onEdit}>
            <Pencil />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("edit")}</TooltipContent>
      </Tooltip>
      {/* Sin modal: «Archivar» abre un diálogo y los dos no se pelean por el foco. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("more")}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy />
            {t("duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMove(-1)} disabled={isFirst}>
            <ArrowUp />
            {t("moveUp")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMove(1)} disabled={isLast}>
            <ArrowDown />
            {t("moveDown")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onArchive}>
            <Archive />
            {t("archive")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type RowProps = {
  /** El asa para arrastrar la fila (null sin arrastre). */
  handle: ReactNode;
  vatRates: CatalogVatRate[];
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onMove: (delta: -1 | 1) => void;
  onArchive: () => void;
};

/** Una fila densa: nombre y descripción, idiomas, tipo, IVA y precio (por ciclo o por unidad). */
function ItemRow({ item, handle, vatRates, canEdit, isFirst, isLast, onEdit, onDuplicate, onMove, onArchive }: RowProps & { item: CatalogItem }) {
  const t = useTranslations("catalog.list");
  const tType = useTranslations("billing.billingType");
  const fmt = useCatalogFormat();
  const own = vatRates.find((rate) => rate.id === item.taxRateId);
  const vat = vatRates.find((rate) => rate.id === resolveVatRateId(item.taxRateId, vatRates));
  const quantity = item.defaultQuantity !== "1" ? t("quantity", { quantity: fmt.quantity(item.defaultQuantity) }) : null;

  return (
    <div className="flex min-h-12 items-center gap-3 px-3 py-2 sm:px-4">
      {handle}
      <button
        type="button"
        onClick={canEdit ? onEdit : undefined}
        disabled={!canEdit}
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
      >
        <span className="block truncate font-medium">{item.name}</span>
        {item.description && <span className="block truncate text-xs text-muted-foreground">{item.description}</span>}
      </button>
      <LocaleMarks source={item} />
      <Badge variant="outline" className="hidden text-muted-foreground sm:inline-flex">
        {tType(item.billingType)}
      </Badge>
      <span className="hidden w-28 shrink-0 truncate text-right text-xs text-muted-foreground md:flex md:items-center md:justify-end md:gap-1">
        {own?.archived && (
          <Tooltip>
            <TooltipTrigger asChild>
              <CircleAlert className="size-3.5 text-warning" aria-label={t("vatArchived")} />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{t("vatArchived")}</TooltipContent>
          </Tooltip>
        )}
        {vat?.name ?? "—"}
        {!item.irpfApplies && <span title={t("noIrpfHint")}> · {t("noIrpf")}</span>}
      </span>
      <span className="w-32 shrink-0 text-right">
        <span className="block font-semibold tabular">{fmt.price(item.unitPriceCents, item.billingType, item.unitLabel)}</span>
        {quantity && <span className="block text-xs text-muted-foreground tabular">{quantity}</span>}
      </span>
      {canEdit && (
        <RowMenu isFirst={isFirst} isLast={isLast} onEdit={onEdit} onDuplicate={onDuplicate} onMove={onMove} onArchive={onArchive} />
      )}
    </div>
  );
}

/** Un pack: su descuento, sus servicios y lo que suma cada tipo (bases, nunca mezcladas). */
function BundleRow({
  bundle,
  items,
  handle,
  vatRates,
  canEdit,
  isFirst,
  isLast,
  onEdit,
  onDuplicate,
  onMove,
  onArchive,
}: RowProps & { bundle: CatalogBundle; items: CatalogItem[] }) {
  const t = useTranslations("catalog.bundles");
  const fmt = useCatalogFormat();
  const { lines, skipped } = bundleLines(bundle, items, "es", { vatRates });
  const totals = catalogTotals(lines, vatRates);
  const byId = new Map(items.map((item) => [item.id, item]));
  const names = lines.map((line) => byId.get(line.itemId)?.name ?? "");
  const cycles = CATALOG_BILLING_TYPES.filter((type) => type !== "usage" && totals[type]);
  const usage = totals.usage?.lines ?? 0;
  const amount = [
    ...cycles.map((type) => fmt.perCycle(totals[type]!.baseCents, type)),
    ...(usage > 0 ? [t("usageCount", { count: usage })] : []),
  ].join(" + ");
  const savings = cycles.filter((type) => totals[type]!.discountCents > 0).map((type) => fmt.perCycle(totals[type]!.discountCents, type));

  return (
    <div className="flex min-h-14 items-center gap-3 px-3 py-2.5 sm:px-4">
      {handle}
      <button
        type="button"
        onClick={canEdit ? onEdit : undefined}
        disabled={!canEdit}
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
      >
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{bundle.name}</span>
          {bundle.discountBps > 0 && <Badge className="bg-primary/10 text-primary">−{fmt.percent(bundle.discountBps)}</Badge>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{names.join(" · ") || t("noItems")}</span>
        {skipped.length > 0 && (
          <span className="mt-0.5 flex items-center gap-1 text-xs text-warning">
            <CircleAlert className="size-3" />
            {t("skipped", { count: skipped.length })}
          </span>
        )}
      </button>
      <LocaleMarks source={bundle} />
      {/* Un pack puede sumar pago único, cuota mensual y anual: que parta línea antes que ensanchar la fila. */}
      <span className="min-w-0 max-w-[50%] text-right">
        <span className="block font-semibold tabular">{amount || "—"}</span>
        {savings.length > 0 && <span className="block text-xs text-success tabular">{t("savings", { amount: savings.join(" + ") })}</span>}
      </span>
      {canEdit && (
        <RowMenu isFirst={isFirst} isLast={isLast} onEdit={onEdit} onDuplicate={onDuplicate} onMove={onMove} onArchive={onArchive} />
      )}
    </div>
  );
}
