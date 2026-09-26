"use client";

import { FileSignature, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { CONTRACT_STATUSES, type ContractStatus } from "@/app/[org]/contracts/schema";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ContractCreateSheet } from "./contract-create-sheet";
import { useContractFormat } from "./format";
import { MrrValue } from "./mrr-value";
import { ContractStatusBadge } from "./status-badges";
import type { ContractFormOptions, ContractListItem } from "./types";

type Filters = { q: string; status: ContractStatus | ""; archived: boolean };

const EMPTY_FILTERS: Filters = { q: "", status: "", archived: false };
// Ventana de tinykeys para las secuencias "g …": la "c" de "g c" no debe abrir el panel.
const SEQUENCE_MS = 1000;
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [role="combobox"], [role="option"], [role="menuitem"]';

function readFilters(params: { get(name: string): string | null }): Filters {
  return {
    q: params.get("q") ?? "",
    status: CONTRACT_STATUSES.find((s) => s === params.get("status")) ?? "",
    archived: params.get("archived") === "1",
  };
}

function filtersQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.archived) params.set("archived", "1");
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

type Props = {
  basePath: string;
  slug: string;
  contracts: ContractListItem[];
  options: ContractFormOptions;
  /** Socio u owner: puede crear contratos. */
  canEdit: boolean;
  today: string;
};

/** Listado de contratos: filtros en la URL, búsqueda por título o cliente y atajos de teclado. */
export function ContractsList({ basePath, slug, contracts, options, canEdit, today }: Props) {
  const t = useTranslations("contracts");
  const tStatus = useTranslations("billing.contractStatus");
  const fmt = useContractFormat();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { commandOpen, shortcutsOpen } = useShell();

  // Los filtros viven aquí y se copian a la URL (sin ir al servidor): se pueden compartir.
  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams));
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastG = useRef(Number.NEGATIVE_INFINITY);

  // "Nuevo contrato" desde la ficha de un cliente llega como ?new=1&client=…
  const createFromUrl = canEdit && searchParams.get("new") === "1";
  const clientFromUrl = searchParams.get("client") ?? undefined;
  const [createRequested, setCreateRequested] = useState(false);
  const createOpen = createRequested || createFromUrl;

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    window.history.replaceState(null, "", `${pathname}${filtersQuery(next)}`);
  };

  const setCreateOpen = (open: boolean) => {
    setCreateRequested(open);
    if (!open && (searchParams.has("new") || searchParams.has("client"))) {
      window.history.replaceState(null, "", `${pathname}${filtersQuery(filters)}`);
    }
  };

  const index = useMemo(
    () => contracts.map((contract) => ({ contract, haystack: fold(`${contract.title} ${contract.clientName}`) })),
    [contracts],
  );

  const inScope = useMemo(
    () => index.filter(({ contract }) => filters.archived || !contract.archived),
    [index, filters.archived],
  );

  const visible = useMemo(() => {
    const terms = fold(filters.q).split(/\s+/).filter(Boolean);
    return inScope
      .filter(
        ({ contract, haystack }) =>
          (!filters.status || contract.status === filters.status) && terms.every((term) => haystack.includes(term)),
      )
      .map((entry) => entry.contract);
  }, [inScope, filters.q, filters.status]);

  const counts = useMemo(() => {
    const map = new Map<ContractStatus, number>();
    for (const { contract } of inScope) map.set(contract.status, (map.get(contract.status) ?? 0) + 1);
    return map;
  }, [inScope]);

  const archivedCount = contracts.filter((c) => c.archived).length;
  const filtering = filters.q.trim() !== "" || filters.status !== "" || filters.archived;
  const activeIndex = activeId ? visible.findIndex((c) => c.id === activeId) : -1;
  const contractHref = (id: string) => `${basePath}/contracts/${id}`;

  const move = (delta: 1 | -1) => {
    if (visible.length === 0) return;
    const nextIndex = activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + delta, 0), visible.length - 1);
    const next = visible[nextIndex]!;
    setActiveId(next.id);
    document.getElementById(`contract-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
  };

  const openActive = (fallbackToFirst: boolean) => {
    const target = visible[activeIndex] ?? (fallbackToFirst ? visible[0] : undefined);
    if (target) router.push(contractHref(target.id));
  };

  // Ni con un panel o un menú abiertos, ni sobre ellos: ahí las teclas son suyas.
  const listIsFocused = (event: KeyboardEvent) =>
    !createOpen && !commandOpen && !shortcutsOpen && !closest(event.target, OVERLAY);

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
      if (!listIsFocused(event) || closest(event.target, INTERACTIVE)) return;
      if (activeIndex === -1) return;
      event.preventDefault();
      openActive(false);
    },
    c: (event) => {
      if (!canEdit || !listIsFocused(event) || event.timeStamp - lastG.current < SEQUENCE_MS) return;
      event.preventDefault();
      setCreateOpen(true);
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
    if (event.metaKey || event.ctrlKey) window.open(contractHref(id), "_blank", "noopener");
    else router.push(contractHref(id));
  };

  const newButton = canEdit ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus data-icon="inline-start" />
      {t("new")}
      <Kbd className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">C</Kbd>
    </Button>
  ) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("description")} actions={newButton} />
      {!canEdit && <ReadOnlyNotice className="-mt-4 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      {contracts.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={() => setCreateOpen(true)} />
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

            <div role="group" aria-label={t("list.statusFilter")} className="flex flex-wrap items-center gap-1">
              <StatusChip active={filters.status === ""} onClick={() => updateFilters({ status: "" })} count={inScope.length}>
                {t("list.statusAll")}
              </StatusChip>
              {CONTRACT_STATUSES.map((s) => (
                <StatusChip
                  key={s}
                  active={filters.status === s}
                  count={counts.get(s) ?? 0}
                  onClick={() => updateFilters({ status: filters.status === s ? "" : s })}
                >
                  {tStatus(s)}
                </StatusChip>
              ))}
            </div>

            {archivedCount > 0 && (
              <label className="flex h-7 cursor-pointer items-center gap-2 rounded-full px-2 text-[0.8rem] font-semibold text-muted-foreground hover:text-foreground">
                <Switch size="sm" checked={filters.archived} onCheckedChange={(archived) => updateFilters({ archived })} />
                {t("list.showArchived", { count: archivedCount })}
              </label>
            )}

            {filtering && (
              <Button variant="ghost" size="sm" onClick={() => updateFilters(EMPTY_FILTERS)}>
                {t("list.clearFilters")}
              </Button>
            )}

            <p className="ml-auto text-xs text-muted-foreground tabular">{t("list.count", { count: visible.length })}</p>
          </div>

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <Search className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 font-semibold">{t("list.noResultsTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("list.noResultsBody")}</p>
              <Button variant="ghost" size="sm" className="mt-4" onClick={() => updateFilters(EMPTY_FILTERS)}>
                {t("list.clearFilters")}
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 text-xs text-muted-foreground">{t("list.columns.contract")}</TableHead>
                    <TableHead className="hidden text-xs text-muted-foreground md:table-cell">{t("list.columns.client")}</TableHead>
                    <TableHead className="text-xs text-muted-foreground">{t("list.columns.status")}</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">{t("list.columns.mrr")}</TableHead>
                    <TableHead className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                      {t("list.columns.oneOff")}
                    </TableHead>
                    <TableHead className="hidden text-xs text-muted-foreground lg:table-cell">
                      {t("list.columns.nextBilling")}
                    </TableHead>
                    <TableHead className="hidden pr-5 text-xs text-muted-foreground xl:table-cell">
                      {t("list.columns.issuer")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((contract) => {
                    const active = contract.id === activeId;
                    const muted = contract.status === "draft" || contract.status === "ended" || contract.archived;
                    return (
                      <TableRow
                        key={contract.id}
                        id={`contract-row-${contract.id}`}
                        data-active={active}
                        aria-selected={active}
                        onClick={(e) => onRowClick(e, contract.id)}
                        onMouseMove={() => !active && setActiveId(contract.id)}
                        className={cn(
                          "group cursor-pointer hover:bg-transparent data-[active=true]:bg-muted/60",
                          contract.archived && "text-muted-foreground",
                        )}
                      >
                        {/* max-w-0 + un ancho en % es lo que deja truncar dentro de una tabla. */}
                        <TableCell className="relative w-[55%] max-w-0 py-2.5 pl-5 md:w-[32%]">
                          <span
                            aria-hidden
                            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100"
                          />
                          <div className="flex min-w-0 items-center gap-2">
                            <Link
                              href={contractHref(contract.id)}
                              className="truncate font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                            >
                              {contract.title}
                            </Link>
                            {contract.archived && (
                              <Badge variant="outline" className="text-muted-foreground">
                                {t("list.archived")}
                              </Badge>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="md:hidden">{contract.clientName} · </span>
                            {contract.signedOn ? t("list.signedOn", { date: fmt.date(contract.signedOn) }) : t("list.unsigned")}
                            {" · "}
                            {t("list.lines", { count: contract.linesCount })}
                          </p>
                        </TableCell>
                        <TableCell className="hidden w-[20%] max-w-0 md:table-cell">
                          <Link
                            href={`${basePath}/clients/${contract.clientId}`}
                            className="block truncate text-muted-foreground hover:text-primary"
                          >
                            {contract.clientName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <ContractStatusBadge status={contract.status} />
                        </TableCell>
                        <TableCell className={cn("text-right font-semibold tabular", muted && "text-muted-foreground")}>
                          <MrrValue item={contract} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "hidden text-right tabular sm:table-cell",
                            (contract.oneOffCents === 0 || muted) && "text-muted-foreground",
                          )}
                        >
                          {contract.oneOffCents > 0 ? fmt.whole(contract.oneOffCents) : "—"}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground tabular lg:table-cell">
                          {contract.nextBillingOn ? (
                            <time dateTime={contract.nextBillingOn}>{fmt.date(contract.nextBillingOn)}</time>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="hidden w-[14%] max-w-0 pr-5 text-muted-foreground xl:table-cell">
                          <span className="block truncate">{contract.issuerName ?? "—"}</span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="mt-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
            {t.rich(canEdit ? "list.keyboardHint" : "list.keyboardHintReadOnly", {
              kbd: (chunks) => <Kbd>{chunks}</Kbd>,
            })}
          </p>
        </>
      )}

      {canEdit && (
        <ContractCreateSheet
          slug={slug}
          open={createOpen}
          onOpenChange={setCreateOpen}
          options={options}
          defaultClientId={clientFromUrl}
          today={today}
          onCreated={(id) => router.push(contractHref(id))}
        />
      )}
    </div>
  );
}

function StatusChip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[0.8rem] font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
      <span className={cn("tabular", active ? "text-primary/80" : "text-muted-foreground/70")}>{count}</span>
    </button>
  );
}

function EmptyState({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  const t = useTranslations("contracts");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground">
        <FileSignature className="size-5" />
      </div>
      <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("list.emptyTitle")}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("list.emptyBody")}</p>
      {canEdit ? (
        <>
          <Button className="mt-6" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            {t.rich("list.emptyHint", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}
          </p>
        </>
      ) : (
        <p className="mt-6 text-xs text-muted-foreground">{t("list.emptyReadOnly")}</p>
      )}
    </div>
  );
}
