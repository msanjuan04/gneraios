"use client";

import { ArrowDown, ArrowUp, ArrowUpRight, Building2, ChevronRight, Info, Server } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, type MouseEvent, useEffect, useState } from "react";
import { PROJECT_STATUS_DOTS } from "@/components/projects/badges";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Cents } from "@/domain/money";
import {
  type ClientRow,
  type Figures,
  hasOtherCosts,
  type InternalRow,
  type OtherCosts,
  otherCostsCents,
  type ProfitabilityReport,
  type ProfitabilitySettings,
  type ProjectRow,
} from "@/domain/profitability";
import { cn } from "@/lib/utils";
import { FlagPills } from "./flags";
import { useProfitabilityFormat } from "./format";

type SortKey = "name" | "revenue" | "collected" | "pending" | "minutes" | "cost" | "other" | "margin" | "marginBps" | "rate";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const NUMERIC: Record<Exclude<SortKey, "name">, (c: ClientRow) => number | null> = {
  revenue: (c) => c.revenueCents,
  collected: (c) => c.collectedCents,
  pending: (c) => c.pendingCents,
  minutes: (c) => c.minutes,
  cost: (c) => c.hoursCostCents,
  other: (c) => otherCostsCents(c.otherCosts),
  margin: (c) => c.marginCents,
  marginBps: (c) => c.marginBps,
  rate: (c) => c.rateCents,
};

/** Clave de i18n (profitability.table.*) de cada columna. */
const COLUMN_LABEL: Record<SortKey, string> = {
  name: "client",
  revenue: "revenue",
  collected: "collected",
  pending: "pending",
  minutes: "hours",
  cost: "hoursCost",
  other: "otherCosts",
  margin: "margin",
  marginBps: "marginShare",
  rate: "rate",
};

/** Ordena clientes; lo que no tiene valor (margen % o €/hora vacíos) va siempre al final. */
function sortClients(clients: readonly ClientRow[], sort: Sort, unknown: string): ClientRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...clients].sort((a, b) => {
    if (sort.key === "name") return sign * (a.name ?? unknown).localeCompare(b.name ?? unknown, "es");
    const va = NUMERIC[sort.key](a);
    const vb = NUMERIC[sort.key](b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sign * (va - vb) || b.marginCents - a.marginCents;
  });
}

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

type Props = {
  report: ProfitabilityReport;
  settings: ProfitabilitySettings;
  /** `/{slug}`: prefijo de las rutas de la org. */
  basePath: string;
  /** Cliente abierto al llegar (desde su ficha). */
  focusClientId: string | null;
};

/**
 * Tabla densa de clientes: ordenable por cada columna y con cada cliente desplegable en sus
 * proyectos (y «Sin proyecto», si queda algo sin repartir). Junto a los ingresos (base), lo cobrado
 * y lo pendiente, con IVA (son del cliente, no de sus proyectos). El coste va en dos columnas: el de
 * las horas (que se reparte por proyectos) y los otros costes del cliente (gastos e
 * infraestructura), con su desglose en el tooltip. El total, el trabajo interno y la
 * infraestructura sin cliente, al pie.
 */
export function ClientsTable({ report, settings, basePath, focusClientId }: Props) {
  const t = useTranslations("profitability.table");
  const [sort, setSort] = useState<Sort>({ key: "margin", dir: "desc" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(focusClientId ? [focusClientId] : []));
  const clients = sortClients(report.clients, sort, t("unknownClient"));

  useEffect(() => {
    if (focusClientId) document.getElementById(`profitability-client-${focusClientId}`)?.scrollIntoView({ block: "center" });
  }, [focusClientId]);

  const toggle = (clientId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });

  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" },
    );

  /** Cabecera ordenable; `withVat`: la columna va con IVA (cobrado y pendiente) y lo dice debajo. */
  const head = (key: SortKey, className?: string, withVat = false) => {
    const active = sort.key === key;
    const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={cn("h-10 text-xs text-muted-foreground", key !== "name" && "text-right", className)}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          aria-label={t("sortBy", { column: withVat ? `${t(COLUMN_LABEL[key])} (${t("withVat")})` : t(COLUMN_LABEL[key]) })}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm font-semibold outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            active && "text-foreground",
            key !== "name" && "flex-row-reverse",
          )}
        >
          <span className={cn(withVat && "flex flex-col items-end leading-tight")}>
            {t(COLUMN_LABEL[key])}
            {withVat && <span className="text-[10px] font-medium opacity-80">{t("withVat")}</span>}
          </span>
          <Arrow aria-hidden className={cn("size-3", !active && "opacity-0")} />
        </button>
      </TableHead>
    );
  };

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, client: ClientRow) => {
    if (client.projects.length === 0 || closest(event.target, "a, button, [data-costs]")) return;
    toggle(client.clientId);
  };

  return (
    <Table className="min-w-[64rem]">
      <TableCaption className="sr-only">{t("caption")}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {head("name", "pl-10")}
          {head("revenue")}
          {head("collected", undefined, true)}
          {head("pending", undefined, true)}
          {head("minutes")}
          {head("cost")}
          {head("other")}
          {head("margin")}
          {head("marginBps")}
          {head("rate", "pr-5")}
        </TableRow>
      </TableHeader>
      <TableBody>
        {clients.map((client) => {
          const open = expanded.has(client.clientId);
          const name = client.name ?? t("unknownClient");
          return (
            <Fragment key={client.clientId}>
              <TableRow
                id={`profitability-client-${client.clientId}`}
                onClick={(event) => onRowClick(event, client)}
                className={cn(client.projects.length > 0 && "cursor-pointer", focusClientId === client.clientId && "bg-primary/5")}
              >
                <TableCell className="py-2 pl-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggle(client.clientId)}
                      disabled={client.projects.length === 0}
                      aria-expanded={open}
                      aria-label={t(open ? "collapse" : "expand", { client: name })}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:invisible"
                    >
                      <ChevronRight aria-hidden className={cn("size-4 transition-transform", open && "rotate-90")} />
                    </button>
                    <Link
                      href={`${basePath}/clients/${client.clientId}`}
                      title={t("openClient", { client: name })}
                      className="max-w-64 truncate font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                    >
                      {name}
                    </Link>
                    <FlagPills flags={client.flags} thresholds={settings} className="ml-1" />
                  </div>
                </TableCell>
                <NumberCells
                  figures={client}
                  collection={{ collectedCents: client.collectedCents, pendingCents: client.pendingCents }}
                  hoursCostCents={client.hoursCostCents}
                  other={client.otherCosts}
                  strong
                />
              </TableRow>
              {open &&
                client.projects.map((project) => (
                  <ProjectRowView key={project.projectId ?? "unassigned"} project={project} basePath={basePath} settings={settings} />
                ))}
            </Fragment>
          );
        })}
        {clients.length === 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
              {t("empty")}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
      <TableFooter>
        <TableRow className="hover:bg-transparent">
          <TableCell className="pl-10 font-bold">{t("total")}</TableCell>
          <NumberCells
            figures={report.totals}
            collection={report.collection}
            hoursCostCents={report.costs.hoursCents}
            other={report.costs.other}
            strong
          />
        </TableRow>
        {report.internal.minutes > 0 && <InternalRows internal={report.internal} basePath={basePath} />}
        {report.hosting.unassignedCents !== 0 && <UnassignedHostingRow hosting={report.hosting} />}
      </TableFooter>
    </Table>
  );
}

/** Trabajo interno (proyectos sin cliente): horas y coste, fuera de los totales. Desplegable. */
function InternalRows({ internal, basePath }: { internal: ProfitabilityReport["internal"]; basePath: string }) {
  const t = useTranslations("profitability.table");
  const fmt = useProfitabilityFormat();
  const [open, setOpen] = useState(false);
  const row = "bg-transparent text-muted-foreground hover:bg-transparent";
  return (
    <>
      <TableRow className={row}>
        <TableCell className="py-2 pl-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-label={t("internal")}
              className="flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronRight aria-hidden className={cn("size-4 transition-transform", open && "rotate-90")} />
            </button>
            <Building2 aria-hidden className="size-3.5" />
            <span className="font-semibold">{t("internal")}</span>
            <HintIcon text={t("internalHint")} />
          </div>
        </TableCell>
        <Dashes count={3} />
        <TableCell className="text-right tabular">{fmt.hours(internal.minutes)}</TableCell>
        <TableCell className="text-right tabular">{fmt.money(internal.costCents)}</TableCell>
        <TableCell className="text-right tabular">—</TableCell>
        <TableCell colSpan={3} className="pr-5" />
      </TableRow>
      {open && internal.projects.map((project) => <InternalProjectRow key={project.projectId} project={project} basePath={basePath} />)}
    </>
  );
}

function InternalProjectRow({ project, basePath }: { project: InternalRow; basePath: string }) {
  const t = useTranslations("profitability.table");
  const fmt = useProfitabilityFormat();
  return (
    <TableRow className="bg-transparent text-[13px] text-muted-foreground hover:bg-transparent">
      <TableCell className="py-1.5 pl-12">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", PROJECT_STATUS_DOTS[project.status])} />
          <Link href={`${basePath}/projects/${project.projectId}`} className="truncate outline-none hover:text-primary focus-visible:text-primary">
            {project.name}
          </Link>
          {project.archived && <span className="text-[11px]">· {t("archived")}</span>}
        </div>
      </TableCell>
      <Dashes count={3} />
      <TableCell className="text-right tabular">{fmt.hours(project.minutes)}</TableCell>
      <TableCell className="text-right tabular">{fmt.money(project.costCents)}</TableCell>
      <TableCell className="text-right tabular">—</TableCell>
      <TableCell colSpan={3} className="pr-5" />
    </TableRow>
  );
}

/** La infraestructura que no va a ningún cliente (webs sin cliente, o sin webs alojadas): fuera de los totales. */
function UnassignedHostingRow({ hosting }: { hosting: ProfitabilityReport["hosting"] }) {
  const t = useTranslations("profitability.table");
  const fmt = useProfitabilityFormat();
  return (
    <TableRow className="bg-transparent text-muted-foreground hover:bg-transparent">
      <TableCell className="py-2 pl-10">
        <div className="flex items-center gap-1.5">
          <Server aria-hidden className="size-3.5" />
          <span className="font-semibold">{t("unassignedHosting")}</span>
          <HintIcon
            text={
              hosting.sites === 0
                ? t("unassignedHostingNoSites")
                : hosting.beforeStartCents === 0
                  ? t("unassignedHostingHint", { count: hosting.unassignedSites, total: hosting.sites })
                  : hosting.unassignedSites === 0
                    ? t("unassignedHostingBeforeStart")
                    : t("unassignedHostingBoth", { count: hosting.unassignedSites, total: hosting.sites })
            }
          />
        </div>
      </TableCell>
      <Dashes count={5} />
      <TableCell className="text-right tabular">{fmt.money(hosting.unassignedCents)}</TableCell>
      <TableCell colSpan={3} className="pr-5" />
    </TableRow>
  );
}

/** Celdas sin valor en las filas del pie que no son de ningún cliente. */
function Dashes({ count }: { count: number }) {
  return Array.from({ length: count }, (_, i) => (
    <TableCell key={i} className="text-right tabular">
      —
    </TableCell>
  ));
}

function NumberCells({
  figures,
  collection,
  hoursCostCents,
  other,
  strong = false,
  muted = false,
}: {
  figures: Figures;
  /** null en las filas de proyecto: los cobros son del cliente (de sus facturas). */
  collection: { collectedCents: Cents; pendingCents: Cents } | null;
  hoursCostCents: Cents;
  /** null en las filas de proyecto: los gastos y la infraestructura son del cliente. */
  other: OtherCosts | null;
  strong?: boolean;
  muted?: boolean;
}) {
  const fmt = useProfitabilityFormat();
  const base = cn("text-right tabular", muted && "text-muted-foreground");
  return (
    <>
      <TableCell className={base}>{fmt.money(figures.revenueCents)}</TableCell>
      <TableCell className={cn(base, "text-muted-foreground")}>{collection ? fmt.money(collection.collectedCents) : "—"}</TableCell>
      <TableCell className={cn(base, "text-muted-foreground", collection && collection.pendingCents > 0 && "text-warning")}>
        {collection && collection.pendingCents !== 0 ? fmt.money(collection.pendingCents) : "—"}
      </TableCell>
      <TableCell className={base}>{figures.minutes === 0 ? "—" : fmt.hours(figures.minutes)}</TableCell>
      <TableCell className={base}>{figures.minutes === 0 ? "—" : fmt.money(hoursCostCents)}</TableCell>
      <TableCell className={base}>{other && hasOtherCosts(other) ? <OtherCostsValue costs={other} /> : "—"}</TableCell>
      <TableCell className={cn(base, strong && "font-semibold text-foreground", figures.marginCents < 0 && "text-destructive")}>
        {fmt.money(figures.marginCents)}
      </TableCell>
      <TableCell className={base}>{figures.marginBps === null ? "—" : fmt.percent(figures.marginBps)}</TableCell>
      <TableCell className={cn(base, "pr-5")}>{figures.rateCents === null ? "—" : fmt.rate(figures.rateCents)}</TableCell>
    </>
  );
}

/** Los otros costes de un cliente (o del total) con su desglose en el tooltip: gastos, lo repercutible y la infraestructura. */
function OtherCostsValue({ costs }: { costs: OtherCosts }) {
  const t = useTranslations("profitability.table.costs");
  const fmt = useProfitabilityFormat();
  const line = (label: string, value: string, sub = false) => (
    <div className={cn("flex items-baseline justify-between gap-4", sub && "pl-3 opacity-80")}>
      <dt>{label}</dt>
      <dd className="font-semibold tabular">{value}</dd>
    </div>
  );
  const total = otherCostsCents(costs);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-costs
          tabIndex={0}
          className="cursor-help rounded-sm underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {fmt.money(total)}
          <span className="sr-only">
            {" "}
            ({t("expenses")}: {fmt.money(costs.expensesCents)}; {t("hosting", { count: costs.hostedSites })}: {fmt.money(costs.hostingCents)})
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="min-w-60">
        <dl className="w-full space-y-1">
          {line(t("expenses"), fmt.money(costs.expensesCents))}
          {costs.rebillCents !== 0 && line(t("rebill"), fmt.money(costs.rebillCents), true)}
          {costs.rebillPendingCents !== 0 && line(t("rebillPending"), fmt.money(costs.rebillPendingCents), true)}
          {line(t("hosting", { count: costs.hostedSites }), fmt.money(costs.hostingCents))}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}

function HintIcon({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-full text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Info aria-hidden className="size-3.5" />
          <span className="sr-only">{text}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{text}</TooltipContent>
    </Tooltip>
  );
}

/** De dónde sale lo facturado de un proyecto cuando no es entero suyo (contrato compartido o reparto por horas). */
function BasisPill({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex h-5 shrink-0 items-center rounded-full border px-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{hint}</TooltipContent>
    </Tooltip>
  );
}

function ProjectRowView({ project, basePath, settings }: { project: ProjectRow; basePath: string; settings: ProfitabilitySettings }) {
  const t = useTranslations("profitability");
  return (
    <TableRow className="bg-muted/25 text-[13px] hover:bg-muted/40">
      <TableCell className="py-1.5 pl-12">
        <div className="flex min-w-0 items-center gap-2">
          {project.projectId === null ? (
            <>
              <span className="text-muted-foreground italic">{t("table.unassigned")}</span>
              <HintIcon text={t("table.unassignedHint")} />
            </>
          ) : (
            <>
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", project.status && PROJECT_STATUS_DOTS[project.status])} />
              <Link
                href={`${basePath}/projects/${project.projectId}`}
                className="group/project inline-flex max-w-64 min-w-0 items-center gap-1 outline-none hover:text-primary focus-visible:text-primary"
              >
                <span className="truncate">{project.name}</span>
                <ArrowUpRight aria-hidden className="size-3 shrink-0 opacity-0 group-hover/project:opacity-100" />
              </Link>
              {project.archived && <span className="text-[11px] text-muted-foreground">· {t("table.archived")}</span>}
            </>
          )}
          {project.sharedContract && <BasisPill label={t("basis.shared")} hint={t("basis.sharedHint")} />}
          {project.directRevenueCents !== 0 && <BasisPill label={t("basis.direct")} hint={t("basis.directHint")} />}
          {project.allocatedRevenueCents !== 0 && <BasisPill label={t("basis.hours")} hint={t("basis.hoursHint")} />}
          <FlagPills flags={project.flags} thresholds={settings} />
        </div>
      </TableCell>
      <NumberCells figures={project} collection={null} hoursCostCents={project.costCents} other={null} muted />
    </TableRow>
  );
}
