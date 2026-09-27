"use client";

import { BookOpen, Loader2, Package, RotateCw, Settings2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { LineFormInput } from "@/app/[org]/contracts/schema";
import type { DraftLineInput } from "@/app/[org]/invoices/schema";
import type { QuoteLineInput } from "@/app/[org]/quotes/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  bundleLines,
  CATALOG_BILLING_TYPES,
  CATALOG_CATEGORIES,
  type CatalogBundle,
  type CatalogCategory,
  type CatalogItem,
  type CatalogLine,
  type CatalogLocale,
  type CatalogSnapshot,
  catalogTotals,
  itemLine,
  localizedTexts,
  toContractLineInput,
  toInvoiceDraftLineInput,
  toQuoteLineInput,
} from "@/domain/catalog";
import { cn } from "@/lib/utils";
import { getCatalogForPicker } from "@/server/catalog/actions";
import { useCatalogFormat } from "./format";

/** Qué se ha elegido: un servicio o un pack, con su nombre en el idioma del documento. */
export type CatalogPick = {
  kind: "item" | "bundle";
  id: string;
  name: string;
  /** Servicios del pack que no se han añadido porque están archivados. */
  skipped: number;
};

/** Líneas del editor de presupuestos (QuoteLineInput), con su id nuevo. */
type QuoteTarget = { target: "quote"; onPick: (lines: QuoteLineInput[], pick: CatalogPick) => void };
/** Líneas de contrato (LineFormInput): las recurrentes empiezan `today`; las mensuales, el `billingDay` de la org. */
type ContractTarget = {
  target: "contract";
  today: string;
  billingDay: number;
  onPick: (lines: LineFormInput[], pick: CatalogPick) => void;
};
/** Líneas del borrador de factura (DraftLineInput de invoices/schema), con su id nuevo y sin periodo. */
type InvoiceTarget = { target: "invoice"; onPick: (lines: DraftLineInput[], pick: CatalogPick) => void };

export type CatalogPickerProps = (QuoteTarget | ContractTarget | InvoiceTarget) & {
  /** Slug de la org: sin `catalog`, el selector lo carga al abrirse (una vez por minuto como mucho). */
  slug: string;
  /** Idioma del documento (el del cliente): los nombres y las descripciones salen en él. */
  locale: CatalogLocale;
  /** El catálogo ya cargado por la página (opcional). */
  catalog?: CatalogSnapshot;
  /** Ofrecer packs (por defecto, sí). Donde solo cabe una línea, false. */
  bundles?: boolean;
  disabled?: boolean;
  /** Controlado (p. ej. para abrirlo con un atajo). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label?: string;
  variant?: "outline" | "ghost" | "secondary";
  size?: "default" | "sm";
  align?: "start" | "center" | "end";
  className?: string;
};

type Filter = "all" | "bundles" | CatalogCategory;

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<CatalogSnapshot> }>();

/** El catálogo de la org desde el servidor, compartido por todos los selectores de la página. */
function fetchCatalog(slug: string, force = false): Promise<CatalogSnapshot> {
  const hit = cache.get(slug);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = getCatalogForPicker(slug).then((result) => {
    if (!result.ok) throw new Error(result.error);
    return result.catalog;
  });
  cache.set(slug, { at: Date.now(), promise });
  promise.catch(() => cache.delete(slug));
  return promise;
}

/** Id de una línea nueva, como en los editores (fuera de un contexto seguro no hay randomUUID). */
function newLineId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * «Del catálogo»: un botón que abre un buscador (como ⌘K) con los servicios y los packs de la org,
 * por categorías. Al elegir uno, `onPick` recibe sus líneas listas para añadir al formulario del
 * editor (`target`), en el idioma del documento (`locale`), con su precio, su recurrencia, su IVA
 * (el vigente si el suyo se archivó) y, en un pack, su descuento en cada línea.
 *
 * Teclado: ↑↓ para moverse, ↵ añade y cierra, ⇧↵ añade y deja el buscador abierto, ← → cambian de
 * categoría con la búsqueda vacía, Esc cierra.
 */
export function CatalogPicker(props: CatalogPickerProps) {
  const { slug, locale, bundles: allowBundles = true, disabled, align = "start", className } = props;
  const t = useTranslations("catalog.picker");
  const tCatalog = useTranslations("catalog");
  const tType = useTranslations("billing.billingType");
  const fmt = useCatalogFormat();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = props.open ?? innerOpen;
  const [loaded, setLoaded] = useState<CatalogSnapshot | null>(null);
  const [error, setError] = useState<{ message: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Un reintento pide el catálogo otra vez aunque haya uno reciente en la caché (solo esa vez).
  const forceNext = useRef(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const keepOpen = useRef(false);

  const catalog = props.catalog ?? loaded;
  const items = catalog?.items.filter((item) => item.isActive) ?? [];
  const bundles = allowBundles ? (catalog?.bundles.filter((bundle) => bundle.isActive) ?? []) : [];
  const vatRates = catalog?.vatRates ?? [];
  const categories = CATALOG_CATEGORIES.filter((category) => items.some((item) => item.category === category));
  const filters: Filter[] = [...(bundles.length > 0 ? (["all", "bundles"] as const) : (["all"] as const)), ...categories];

  // Sin catálogo de la página, se carga al abrir (abierto desde el botón o desde fuera). Si ya
  // había uno, se ve mientras llega el nuevo.
  const provided = props.catalog !== undefined;
  useEffect(() => {
    if (!open || provided) return;
    let cancelled = false;
    const force = forceNext.current;
    forceNext.current = false;
    fetchCatalog(slug, force)
      .then((snapshot) => {
        if (cancelled) return;
        setLoaded(snapshot);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError({ message: reason instanceof Error ? reason.message : null });
      });
    return () => {
      cancelled = true;
    };
  }, [open, provided, slug, attempt]);

  const retry = () => {
    forceNext.current = true;
    setError(null);
    setAttempt((n) => n + 1);
  };

  const setOpen = (next: boolean) => {
    if (!next) {
      setQuery("");
      setFilter("all");
    }
    setInnerOpen(next);
    props.onOpenChange?.(next);
  };

  /** Las líneas del catálogo → las del editor, con los tipos de cada módulo (si cambian, esto no compila). */
  const deliver = (lines: CatalogLine[], pick: CatalogPick) => {
    if (props.target === "quote") {
      const out: QuoteLineInput[] = lines.map((line) => toQuoteLineInput(line, newLineId()));
      props.onPick(out, pick);
    } else if (props.target === "contract") {
      const ctx = { today: props.today, billingDay: props.billingDay };
      const out: LineFormInput[] = lines.map((line) => toContractLineInput(line, ctx));
      props.onPick(out, pick);
    } else {
      const out: DraftLineInput[] = lines.map((line) => toInvoiceDraftLineInput(line, newLineId()));
      props.onPick(out, pick);
    }
    if (pick.skipped > 0) toast.warning(t("skipped", { count: pick.skipped }));
    if (keepOpen.current) {
      toast.success(t("added", { count: lines.length }));
      keepOpen.current = false;
    } else setOpen(false);
  };

  const pickItem = (item: CatalogItem) => {
    deliver([itemLine(item, locale, { vatRates })], { kind: "item", id: item.id, name: localizedTexts(item, locale).name, skipped: 0 });
  };

  const pickBundle = (bundle: CatalogBundle) => {
    const { lines, skipped } = bundleLines(bundle, items, locale, { vatRates });
    if (lines.length === 0) {
      toast.error(t("bundleEmpty"));
      keepOpen.current = false;
      return;
    }
    deliver(lines, { kind: "bundle", id: bundle.id, name: localizedTexts(bundle, locale).name, skipped: skipped.length });
  };

  // Con ⇧ (al pulsar ↵ o al hacer clic), el buscador se queda abierto para seguir añadiendo.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    keepOpen.current = event.shiftKey;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // cmdk selecciona con ↵ después de este manejador: aquí se sabe si iba con ⇧.
    if (event.key === "Enter") keepOpen.current = event.shiftKey;
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && query === "" && filters.length > 1) {
      event.preventDefault();
      const index = filters.indexOf(filter);
      const next = (index + (event.key === "ArrowRight" ? 1 : -1) + filters.length) % filters.length;
      setFilter(filters[next]!);
    }
  };

  const showBundles = bundles.length > 0 && (filter === "all" || filter === "bundles");
  const shownCategories = filter === "all" ? categories : filter === "bundles" ? [] : [filter];
  const filterLabel = (value: Filter) => (value === "all" ? t("all") : value === "bundles" ? t("bundles") : tCatalog(`categories.${value}`));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant={props.variant ?? "outline"} size={props.size ?? "sm"} disabled={disabled} className={className}>
          <BookOpen data-icon="inline-start" />
          {props.label ?? t("trigger")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[28rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
        <Command className="glass" onKeyDown={onKeyDown} onPointerDown={onPointerDown} loop>
          <div className="flex items-center gap-2 pr-2">
            <div className="min-w-0 flex-1">
              <CommandInput placeholder={t("search")} value={query} onValueChange={setQuery} />
            </div>
            <Badge variant="outline" className="mt-1 shrink-0 text-muted-foreground" title={t("language", { language: tCatalog(`languages.${locale}`) })}>
              {locale.toUpperCase()}
            </Badge>
          </div>

          {catalog && filters.length > 1 && (
            <div className="flex gap-1 overflow-x-auto px-2 pt-2 pb-1" role="group" aria-label={t("filters")}>
              {filters.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className="h-6 shrink-0 rounded-full border px-2.5 text-xs font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-foreground"
                >
                  {filterLabel(value)}
                </button>
              ))}
            </div>
          )}

          <CommandList className="max-h-80">
            {!catalog ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
                {error ? (
                  <>
                    <p>{error.message ?? t("error")}</p>
                    <Button type="button" variant="outline" size="sm" onClick={retry}>
                      <RotateCw data-icon="inline-start" />
                      {t("retry")}
                    </Button>
                  </>
                ) : (
                  <p className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    {t("loading")}
                  </p>
                )}
              </div>
            ) : items.length === 0 && bundles.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-8 text-center text-sm text-muted-foreground">
                <Package className="size-5" />
                <p>{t("emptyCatalog")}</p>
              </div>
            ) : (
              <>
                <CommandEmpty>{t("empty")}</CommandEmpty>
                {showBundles && (
                  <CommandGroup heading={t("bundles")}>
                    {bundles.map((bundle) => (
                      <BundleOption key={bundle.id} bundle={bundle} catalog={catalog} locale={locale} onSelect={() => pickBundle(bundle)} />
                    ))}
                  </CommandGroup>
                )}
                {shownCategories.map((category) => (
                  <CommandGroup key={category} heading={tCatalog(`categories.${category}`)}>
                    {items
                      .filter((item) => item.category === category)
                      .map((item) => {
                        const texts = localizedTexts(item, locale);
                        return (
                          <CommandItem
                            key={item.id}
                            value={`item:${item.id}`}
                            keywords={[texts.name, item.name, texts.description ?? "", tCatalog(`categories.${category}`)]}
                            onSelect={() => pickItem(item)}
                            className="items-start gap-3 py-2"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{texts.name}</span>
                              {texts.description && <span className="block truncate text-xs text-muted-foreground">{texts.description}</span>}
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-xs font-semibold tabular">{fmt.price(item.unitPriceCents, item.billingType, item.unitLabel)}</span>
                              <span className="block text-[10px] text-muted-foreground">{tType(item.billingType)}</span>
                            </span>
                          </CommandItem>
                        );
                      })}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>↑↓</Kbd>
              {t("hints.navigate")}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              {t("hints.add")}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>⇧↵</Kbd>
              {t("hints.addMore")}
            </span>
            {filters.length > 1 && (
              <span className="hidden items-center gap-1 sm:flex">
                <Kbd>←→</Kbd>
                {t("hints.filters")}
              </span>
            )}
            {/* En otra pestaña: el editor puede tener cambios sin guardar. */}
            <Link
              href={`/${slug}/settings/catalog`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Settings2 className="size-3.5" />
              {t("manage")}
            </Link>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function BundleOption({
  bundle,
  catalog,
  locale,
  onSelect,
}: {
  bundle: CatalogBundle;
  catalog: CatalogSnapshot;
  locale: CatalogLocale;
  onSelect: () => void;
}) {
  const t = useTranslations("catalog.picker");
  const tBundles = useTranslations("catalog.bundles");
  const fmt = useCatalogFormat();
  const texts = localizedTexts(bundle, locale);
  const { lines } = bundleLines(bundle, catalog.items, locale, { vatRates: catalog.vatRates });
  const totals = catalogTotals(lines, catalog.vatRates);
  const itemNames = lines.map((line) => {
    const item = catalog.items.find((i) => i.id === line.itemId);
    return item ? localizedTexts(item, locale).name : "";
  });
  const amount = CATALOG_BILLING_TYPES.filter((type) => type !== "usage" && totals[type])
    .map((type) => fmt.perCycle(totals[type]!.baseCents, type, true))
    .join(" + ");
  return (
    <CommandItem
      value={`bundle:${bundle.id}`}
      keywords={[texts.name, bundle.name, ...itemNames]}
      onSelect={onSelect}
      className={cn("items-start gap-3 py-2", lines.length === 0 && "opacity-60")}
    >
      <Package className="mt-0.5 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium">{texts.name}</span>
          {bundle.discountBps > 0 && <Badge className="h-4 bg-primary/10 px-1.5 text-[10px] text-primary">−{fmt.percent(bundle.discountBps)}</Badge>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {t("bundleItems", { count: lines.length })} · {itemNames.join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs font-semibold tabular">
        {amount || (totals.usage ? tBundles("usageCount", { count: totals.usage.lines }) : "—")}
      </span>
    </CommandItem>
  );
}
