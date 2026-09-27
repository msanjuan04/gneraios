"use client";

import { FolderKanban, LayoutList, Plus, Search, SquareKanban, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { PageHeader } from "@/components/page-header";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { PROJECT_STATUSES, type ProjectStatus } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { OptionSelect } from "./fields";
import { useProjectFormat } from "./format";
import { MemberAvatar, memberLookup } from "./member-avatar";
import { ProjectSheet } from "./project-sheet";
import { ProjectsBoard } from "./projects-board";
import { ProjectsTable } from "./projects-table";
import type { MemberHours, ProjectFormOptions, ProjectListItem } from "./types";

type View = "list" | "board";
type Filters = { q: string; status: ProjectStatus | ""; client: string; owner: string; mine: boolean; archived: boolean; view: View };

const EMPTY_FILTERS: Omit<Filters, "view"> = { q: "", status: "", client: "", owner: "", mine: false, archived: false };
const SEQUENCE_MS = 1000;
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'a, button, input, textarea, select, [role="button"], [role="combobox"], [role="option"], [role="menuitem"]';

function readFilters(params: { get(name: string): string | null }): Filters {
  return {
    q: params.get("q") ?? "",
    status: PROJECT_STATUSES.find((s) => s === params.get("status")) ?? "",
    client: params.get("client_filter") ?? "",
    owner: params.get("owner") ?? "",
    mine: params.get("mine") === "1",
    archived: params.get("archived") === "1",
    view: params.get("view") === "board" ? "board" : "list",
  };
}

function filtersQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.client) params.set("client_filter", filters.client);
  if (filters.owner) params.set("owner", filters.owner);
  if (filters.mine) params.set("mine", "1");
  if (filters.archived) params.set("archived", "1");
  if (filters.view === "board") params.set("view", "board");
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
  slug: string;
  basePath: string;
  projects: ProjectListItem[];
  options: ProjectFormOptions;
  weekHours: MemberHours[];
  targetCents: number;
  currentMemberId: string;
  canEdit: boolean;
  today: string;
};

/** Listado de proyectos (tabla o tablero por estado), con filtros en la URL y atajos de teclado. */
export function ProjectsView({ slug, basePath, projects, options, weekHours, targetCents, currentMemberId, canEdit, today }: Props) {
  const t = useTranslations("projects");
  const tStatus = useTranslations("projects.status");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { commandOpen, shortcutsOpen } = useShell();
  const fmt = useProjectFormat();
  const member = memberLookup(options.members);

  const [filters, setFilters] = useState<Filters>(() => readFilters(searchParams));
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastG = useRef(Number.NEGATIVE_INFINITY);

  // "Nuevo proyecto" desde otras pantallas: ?new=1&client=…&contract=…&name=…
  const createFromUrl = canEdit && searchParams.get("new") === "1";
  const [createRequested, setCreateRequested] = useState(false);
  const createOpen = createRequested || createFromUrl;
  const urlDefaults = {
    clientId: searchParams.get("client") ?? undefined,
    contractId: searchParams.get("contract") ?? undefined,
    name: searchParams.get("name") ?? undefined,
    templateId: searchParams.get("template") ?? undefined,
  };

  const updateFilters = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    window.history.replaceState(null, "", `${pathname}${filtersQuery(next)}`);
  };

  const setCreateOpen = (open: boolean) => {
    setCreateRequested(open);
    if (!open && ["new", "client", "contract", "name", "template"].some((k) => searchParams.has(k))) {
      window.history.replaceState(null, "", `${pathname}${filtersQuery(filters)}`);
    }
  };

  const index = useMemo(
    () => projects.map((project) => ({ project, haystack: fold(`${project.name} ${project.clientName ?? ""} ${project.contractTitle ?? ""}`) })),
    [projects],
  );

  // Lo que filtran todos los filtros menos el de estado (los contadores de las píldoras salen de aquí).
  const scoped = useMemo(() => {
    const terms = fold(filters.q).split(/\s+/).filter(Boolean);
    return index
      .filter(
        ({ project, haystack }) =>
          (filters.archived || !project.archived) &&
          (!filters.client || (filters.client === "__internal__" ? project.clientId === null : project.clientId === filters.client)) &&
          (!filters.owner || project.ownerId === filters.owner) &&
          (!filters.mine || project.mine) &&
          terms.every((term) => haystack.includes(term)),
      )
      .map((entry) => entry.project);
  }, [index, filters.archived, filters.client, filters.owner, filters.mine, filters.q]);

  const visible = useMemo(() => scoped.filter((p) => !filters.status || p.status === filters.status), [scoped, filters.status]);

  const counts = useMemo(() => {
    const map = new Map<ProjectStatus, number>();
    for (const p of scoped) map.set(p.status, (map.get(p.status) ?? 0) + 1);
    return map;
  }, [scoped]);

  const archivedCount = projects.filter((p) => p.archived).length;
  const filtering = filters.q.trim() !== "" || filters.status !== "" || filters.client !== "" || filters.owner !== "" || filters.mine || filters.archived;
  const activeIndex = activeId ? visible.findIndex((p) => p.id === activeId) : -1;
  const projectHref = (id: string) => `${basePath}/projects/${id}`;

  const move = (delta: 1 | -1) => {
    if (visible.length === 0) return;
    const nextIndex = activeIndex === -1 ? 0 : Math.min(Math.max(activeIndex + delta, 0), visible.length - 1);
    const next = visible[nextIndex]!;
    setActiveId(next.id);
    document.getElementById(`project-row-${next.id}`)?.scrollIntoView({ block: "nearest" });
  };

  const openActive = (fallbackToFirst: boolean) => {
    const target = visible[activeIndex] ?? (fallbackToFirst ? visible[0] : undefined);
    if (target) router.push(projectHref(target.id));
  };

  const listIsFocused = (event: KeyboardEvent) => !createOpen && !commandOpen && !shortcutsOpen && !closest(event.target, OVERLAY);
  const createShortcut = (event: KeyboardEvent) => {
    if (!canEdit || !listIsFocused(event) || event.timeStamp - lastG.current < SEQUENCE_MS) return;
    event.preventDefault();
    setCreateOpen(true);
  };

  useHotkeys({
    g: (event) => {
      lastG.current = event.timeStamp;
    },
    j: (event) => {
      if (!listIsFocused(event) || filters.view !== "list") return;
      event.preventDefault();
      move(1);
    },
    k: (event) => {
      if (!listIsFocused(event) || filters.view !== "list") return;
      event.preventDefault();
      move(-1);
    },
    Enter: (event) => {
      if (!listIsFocused(event) || closest(event.target, INTERACTIVE) || activeIndex === -1) return;
      event.preventDefault();
      openActive(false);
    },
    c: createShortcut,
    n: createShortcut,
    // Con Mayúsculas opcional: en el teclado español "/" es ⇧7.
    "[Shift]+/": (event) => {
      if (!listIsFocused(event)) return;
      event.preventDefault();
      searchRef.current?.focus();
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

  const newButton = canEdit ? (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus data-icon="inline-start" />
      {t("new")}
      <Kbd className="ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex">C</Kbd>
    </Button>
  ) : undefined;

  const clientOptions = [
    { value: "__internal__", label: t("list.internalOnly") },
    ...options.clients.filter((c) => projects.some((p) => p.clientId === c.id)).map((c) => ({ value: c.id, label: c.name })),
  ];
  const ownerOptions = options.members.filter((m) => projects.some((p) => p.ownerId === m.id)).map((m) => ({ value: m.id, label: m.fullName }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("description", { target: fmt.rate(targetCents) })} actions={newButton} />
      {!canEdit && <ReadOnlyNotice className="-mt-4 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      <TeamWeek weekHours={weekHours} member={member} />

      {projects.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={() => setCreateOpen(true)} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
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

            <div className="flex w-full gap-2 sm:w-auto">
              <OptionSelect
                size="sm"
                ariaLabel={t("list.clientFilter")}
                value={filters.client}
                onChange={(client) => updateFilters({ client })}
                noneLabel={t("list.clientAll")}
                options={clientOptions}
                className="sm:w-44"
              />
              <OptionSelect
                size="sm"
                ariaLabel={t("list.ownerFilter")}
                value={filters.owner}
                onChange={(owner) => updateFilters({ owner })}
                noneLabel={t("list.ownerAll")}
                options={ownerOptions}
                className="sm:w-40"
              />
            </div>

            <label className="flex h-7 cursor-pointer items-center gap-2 rounded-full px-2 text-[0.8rem] font-semibold text-muted-foreground hover:text-foreground">
              <Switch size="sm" checked={filters.mine} onCheckedChange={(mine) => updateFilters({ mine })} />
              {t("list.mine")}
            </label>
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

            <div role="group" aria-label={t("list.viewLabel")} className="ml-auto flex items-center gap-0.5 rounded-full border bg-card/60 p-0.5">
              <ViewButton active={filters.view === "list"} onClick={() => updateFilters({ view: "list" })} label={t("list.viewList")}>
                <LayoutList className="size-3.5" />
              </ViewButton>
              <ViewButton active={filters.view === "board"} onClick={() => updateFilters({ view: "board" })} label={t("list.viewBoard")}>
                <SquareKanban className="size-3.5" />
              </ViewButton>
            </div>
          </div>

          {filters.view === "list" && (
            <div role="group" aria-label={t("list.statusFilter")} className="mb-3 flex flex-wrap items-center gap-1">
              <StatusChip active={filters.status === ""} onClick={() => updateFilters({ status: "" })} count={scoped.length}>
                {t("list.statusAll")}
              </StatusChip>
              {PROJECT_STATUSES.map((s) => (
                <StatusChip
                  key={s}
                  active={filters.status === s}
                  count={counts.get(s) ?? 0}
                  onClick={() => updateFilters({ status: filters.status === s ? "" : s })}
                >
                  {tStatus(s)}
                </StatusChip>
              ))}
              <p className="ml-auto text-xs text-muted-foreground tabular">{t("list.count", { count: visible.length })}</p>
            </div>
          )}

          {(filters.view === "list" ? visible : scoped).length === 0 ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <Search className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 font-semibold">{t("list.noResultsTitle")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("list.noResultsBody")}</p>
              <Button variant="ghost" size="sm" className="mt-4" onClick={() => updateFilters(EMPTY_FILTERS)}>
                {t("list.clearFilters")}
              </Button>
            </div>
          ) : filters.view === "list" ? (
            <>
              <ProjectsTable
                basePath={basePath}
                projects={visible}
                members={options.members}
                targetCents={targetCents}
                activeId={activeId}
                onHover={setActiveId}
              />
              <p className="mt-3 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
                {t.rich(canEdit ? "list.keyboardHint" : "list.keyboardHintReadOnly", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}
              </p>
            </>
          ) : (
            <ProjectsBoard slug={slug} basePath={basePath} projects={scoped} members={options.members} targetCents={targetCents} canEdit={canEdit} />
          )}
        </>
      )}

      {canEdit && (
        <ProjectSheet
          slug={slug}
          open={createOpen}
          onOpenChange={setCreateOpen}
          options={options}
          defaults={createFromUrl ? urlDefaults : undefined}
          currentMemberId={currentMemberId}
          today={today}
          onSaved={(id, created) => created && router.push(projectHref(id))}
        />
      )}
    </div>
  );
}

/** Horas de cada socio esta semana: la carga del equipo de un vistazo. */
function TeamWeek({ weekHours, member }: { weekHours: MemberHours[]; member: ReturnType<typeof memberLookup> }) {
  const t = useTranslations("projects.team");
  const fmt = useProjectFormat();
  const max = Math.max(1, ...weekHours.map((h) => h.minutes));
  if (weekHours.length === 0) return null;
  return (
    <section aria-label={t("title")} className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border bg-card/60 px-4 py-2.5">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("title")}</p>
      {weekHours.map((h) => (
        <div key={h.memberId} className="flex items-center gap-2">
          <MemberAvatar member={member(h.memberId)} size="xs" />
          <div className="w-16">
            <p className="text-xs font-semibold tabular">{fmt.hours(h.minutes)}</p>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(h.minutes / max) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}

function ViewButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function StatusChip({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: ReactNode }) {
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
  const t = useTranslations("projects");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground">
        <FolderKanban className="size-5" />
      </div>
      <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("list.emptyTitle")}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("list.emptyBody")}</p>
      {canEdit ? (
        <>
          <Button className="mt-6" onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">{t.rich("list.emptyHint", { kbd: (chunks) => <Kbd>{chunks}</Kbd> })}</p>
        </>
      ) : (
        <p className="mt-6 text-xs text-muted-foreground">{t("list.emptyReadOnly")}</p>
      )}
    </div>
  );
}
