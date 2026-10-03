"use client";

import { Building2, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, useMemo, useRef, useState } from "react";
import { newClientDefaults } from "@/app/[org]/clients/schema";
import { CLIENT_MANUAL_STATUSES, type ClientManualStatus, effectiveClientStatus } from "@/domain/clients/status";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ClientSheet } from "./client-sheet";
import { HealthBadge } from "./health-badge";
import { ClientStatusBadge } from "./client-status-badge";
import type { ClientListItem, MemberOption } from "./types";

type Filters = { q: string; status: ClientManualStatus | ""; owner: string; archived: boolean; attention: boolean };

const ALL = "all";
/** Filtro de responsable: clientes sin socio asignado. */
const NO_OWNER = "none";
// Ventana de tinykeys para las secuencias "g …": la "c" de "g c" no debe abrir el panel.
const SEQUENCE_MS = 1000;

const EMPTY_FILTERS: Filters = { q: "", status: "", owner: "", archived: false, attention: false };

function readFilters(params: { get(name: string): string | null }): Filters {
  return {
    q: params.get("q") ?? "",
    status: CLIENT_MANUAL_STATUSES.find((s) => s === params.get("status")) ?? "",
    owner: params.get("owner") ?? "",
    archived: params.get("archived") === "1",
    attention: params.get("health") === "attention",
  };
}

function filtersQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.owner) params.set("owner", filters.owner);
  if (filters.archived) params.set("archived", "1");
  if (filters.attention) params.set("health", "attention");
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

const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [role="combobox"], [role="option"], [role="menuitem"]';

type Props = {
  basePath: string;
  slug: string;
  clients: ClientListItem[];
  members: MemberOption[];
  /** Socio u owner: puede crear clientes. */
  canEdit: boolean;
  currentMemberId: string;
  defaultPaymentTerms: number;
  currency: string;
};

export function ClientsList({ basePath, slug, clients, members, canEdit, currentMemberId, defaultPaymentTerms, currency }: Props) {
  const t = useTranslations("clients");
  const tStatus = useTranslations("crm.clientStatus");
  const tCrm = useTranslations("crm");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { commandOpen, shortcutsOpen } = useShell();

  // Los filtros viven aquí y se copian a la URL (sin ir al servidor): se pueden compartir y sobreviven a recargar.
  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams));
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastG = useRef(Number.NEGATIVE_INFINITY);

  // "Nuevo cliente" desde ⌘K llega como ?new=1, también si ya estábamos en el listado.
  const createFromUrl = canEdit && searchParams.get("new") === "1";
  const [createRequested, setCreateRequested] = useState(false);
  const createOpen = createRequested || createFromUrl;

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    window.history.replaceState(null, "", `${pathname}${filtersQuery(next)}`);
  };

  const setCreateOpen = (open: boolean) => {
    setCreateRequested(open);
    if (!open && searchParams.has("new")) window.history.replaceState(null, "", `${pathname}${filtersQuery(filters)}`);
  };

  const index = useMemo(
    () =>
      clients.map((client) => ({
        client,
        haystack: fold(
          [client.displayName, client.legalName, client.taxId, client.city, client.sector, client.owner?.fullName]
            .filter(Boolean)
            .join(" "),
        ),
      })),
    [clients],
  );

  const visible = useMemo(() => {
    const terms = fold(filters.q).split(/\s+/).filter(Boolean);
    return index
      .filter(
        ({ client, haystack }) =>
          (filters.archived || !client.archived) &&
          (!filters.status || effectiveClientStatus(client.status, client.manualStatus) === filters.status) &&
          (!filters.attention || client.health.level !== "good") &&
          (!filters.owner || (filters.owner === NO_OWNER ? client.owner === null : client.owner?.id === filters.owner)) &&
          terms.every((term) => haystack.includes(term)),
      )
      .map((entry) => entry.client);
  }, [index, filters]);

  const archivedCount = clients.filter((c) => c.archived).length;
  const hiddenArchived = filters.archived ? 0 : archivedCount;
  const filtering = filters.q.trim() !== "" || filters.status !== "" || filters.owner !== "" || filters.archived || filters.attention;
  const attentionCount = clients.filter((c) => !c.archived && c.health.level !== "good").length;
  const activeIndex = activeId ? visible.findIndex((c) => c.id === activeId) : -1;
  const clientHref = (id: string) => `${basePath}/clients/${id}`;

  const move = (delta: 1 | -1) => {
    if (visible.length === 0) return;
    const nextIndex = activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + delta, 0), visible.length - 1);
    const next = visible[nextIndex]!;
    setActiveId(next.id);
    document.getElementById(`client-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
  };

  const openActive = (fallbackToFirst: boolean) => {
    const target = visible[activeIndex] ?? (fallbackToFirst ? visible[0] : undefined);
    if (target) router.push(clientHref(target.id));
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
      // Sobre un enlace o un botón, Enter ya hace lo suyo.
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

  // En el buscador: flechas para moverse y Enter para abrir el primero, sin soltar el teclado.
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
    if (event.metaKey || event.ctrlKey) window.open(clientHref(id), "_blank", "noopener");
    else router.push(clientHref(id));
  };

  const newButton = canEdit ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus data-icon="inline-start" />
      {t("new")}
      <Kbd className="ml-1 hidden bg-white/15 text-white sm:inline-flex">C</Kbd>
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} actions={newButton} />
      {!canEdit && <ReadOnlyNotice className="-mt-4 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      {clients.length === 0 ? (
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

            <Select
              value={filters.status || ALL}
              onValueChange={(v) => updateFilters({ status: CLIENT_MANUAL_STATUSES.find((s) => s === v) ?? "" })}
            >
              <SelectTrigger size="sm" className="w-40" aria-label={t("list.statusFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("list.statusAll")}</SelectItem>
                {CLIENT_MANUAL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {tStatus(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.owner || ALL} onValueChange={(v) => updateFilters({ owner: v === ALL ? "" : v })}>
              <SelectTrigger size="sm" className="w-48" aria-label={t("list.ownerFilter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("list.ownerAll")}</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.fullName}
                  </SelectItem>
                ))}
                <SelectItem value={NO_OWNER}>{tCrm("noOwner")}</SelectItem>
              </SelectContent>
            </Select>

            {attentionCount > 0 && (
              <button
                type="button"
                aria-pressed={filters.attention}
                onClick={() => updateFilters({ attention: !filters.attention })}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[0.8rem] font-semibold transition-colors",
                  filters.attention ? "border-warning/50 bg-warning/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span aria-hidden className="size-2 rounded-full bg-warning" />
                {t("list.attention", { count: attentionCount })}
              </button>
            )}

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
              <p className="mt-1 text-sm text-muted-foreground">
                {hiddenArchived > 0 ? t("list.noResultsArchived", { count: hiddenArchived }) : t("list.noResultsBody")}
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {hiddenArchived > 0 && (
                  <Button variant="outline" size="sm" onClick={() => updateFilters({ archived: true })}>
                    {t("list.showArchivedAction")}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => updateFilters(EMPTY_FILTERS)}>
                  {t("list.clearFilters")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5 text-xs text-muted-foreground">{t("list.columns.name")}</TableHead>
                    <TableHead className="text-xs text-muted-foreground">{t("list.columns.status")}</TableHead>
                    <TableHead className="hidden text-right text-xs text-muted-foreground md:table-cell">
                      {t("list.columns.billed")}
                    </TableHead>
                    <TableHead className="hidden text-right text-xs text-muted-foreground lg:table-cell">
                      {t("list.columns.collected")}
                    </TableHead>
                    <TableHead className="hidden pr-5 text-right text-xs text-muted-foreground md:table-cell">
                      {t("list.columns.outstanding")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((client) => {
                    const active = client.id === activeId;
                    const formatMoney = (cents: number) => format.number(cents / 100, { style: "currency", currency });
                    return (
                      <TableRow
                        key={client.id}
                        id={`client-row-${client.id}`}
                        data-active={active}
                        aria-selected={active}
                        onClick={(e) => onRowClick(e, client.id)}
                        onMouseMove={() => !active && setActiveId(client.id)}
                        className={cn(
                          "group cursor-pointer hover:bg-transparent data-[active=true]:bg-muted/60",
                          client.archived && "text-muted-foreground",
                        )}
                      >
                        {/* max-w-0 + un ancho en % es lo que deja truncar dentro de una tabla. */}
                        <TableCell className="relative w-[70%] max-w-0 py-2.5 pl-5 sm:w-[60%] md:w-[45%] lg:w-[34%]">
                          <span
                            aria-hidden
                            className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary opacity-0 group-data-[active=true]:opacity-100"
                          />
                          <div className="flex min-w-0 items-center gap-2">
                            <Link
                              href={clientHref(client.id)}
                              className="truncate font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                            >
                              {client.displayName}
                            </Link>
                            <HealthBadge health={client.health} />
                            {client.archived && (
                              <Badge variant="outline" className="text-muted-foreground">
                                {t("list.archived")}
                              </Badge>
                            )}
                          </div>
                          {client.legalName && client.legalName !== client.displayName && (
                            <p className="truncate text-xs text-muted-foreground">{client.legalName}</p>
                          )}
                          <p className="mt-1 truncate text-[11px] text-muted-foreground md:hidden">
                            {t("list.mobileBalance", { collected: formatMoney(client.collectedCents), outstanding: formatMoney(client.outstandingCents) })}
                          </p>
                        </TableCell>
                        <TableCell>
                          <ClientStatusBadge status={client.status} manual={client.manualStatus} />
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          {formatMoney(client.billedCents)}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums lg:table-cell">
                          {formatMoney(client.collectedCents)}
                        </TableCell>
                        <TableCell className="hidden pr-5 text-right tabular-nums md:table-cell">
                          <span className={client.outstandingCents > 0 ? "font-semibold text-warning" : "text-muted-foreground"}>{formatMoney(client.outstandingCents)}</span>
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
        <ClientSheet
          slug={slug}
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaults={newClientDefaults(currentMemberId)}
          members={members}
          defaultPaymentTerms={defaultPaymentTerms}
          onSaved={(id) => router.push(clientHref(id))}
        />
      )}
    </div>
  );
}

function EmptyState({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  const t = useTranslations("clients");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
        <Building2 className="size-5" />
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
