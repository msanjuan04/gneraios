"use client";

import { ChevronDown, ChevronRight, CircleAlert, Hash, Loader2, Sparkles, TriangleAlert, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { commitImport, setImportLineType } from "@/app/[org]/settings/data/actions";
import { useInvoiceFormat } from "@/components/invoices/format";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportBillingType } from "@/domain/dataio/classify";
import type { RowAction } from "@/domain/dataio/issues";
import { cn } from "@/lib/utils";
import { ActionBadge, IssueList } from "./issue-text";
import type { ClientSimulationView, InvoiceRowView, InvoiceSimulationView, LineView, SimulationView } from "./types";

const PAGE = 100;
const FILTERS = ["all", "create", "update", "skip", "error"] as const;
type Filter = (typeof FILTERS)[number];
const AUTO = "auto";

function ranges(list: [number, number][]): string {
  return list.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(", ");
}

/** Pestañas de filtro por acción, con su recuento. */
function FilterTabs({ counts, value, onChange, kinds }: { counts: Record<RowAction, number>; value: Filter; onChange: (f: Filter) => void; kinds: readonly Filter[] }) {
  const t = useTranslations("dataio.simulation.filters");
  const total = counts.create + counts.update + counts.skip + counts.error;
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-full border bg-card/60 p-1">
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground",
            value === k && "bg-secondary text-foreground",
          )}
        >
          {t(k)}
          <span className="tabular opacity-70">{k === "all" ? total : counts[k]}</span>
        </button>
      ))}
    </div>
  );
}

/** Barra para confirmar: resume lo que se va a hacer y pide confirmación. */
function CommitBar({ slug, jobId, summary, disabled }: { slug: string; jobId: string; summary: string; disabled: boolean }) {
  const t = useTranslations("dataio.simulation");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  function commit() {
    startTransition(async () => {
      const result = await commitImport(slug, jobId);
      setOpen(false);
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      toast.success(t("committed", { created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors }));
      router.refresh();
    });
  }
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/90 px-5 py-3 text-sm shadow-lg backdrop-blur-xl">
      <p className="text-muted-foreground">{summary}</p>
      <Button onClick={() => setOpen(true)} disabled={disabled || pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
        {t("commit")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("confirmTitle")}
        description={t("confirmBody")}
        confirmLabel={t("commit")}
        onConfirm={commit}
        pending={pending}
        destructive={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

function ClientsSimulation({ slug, jobId, view, canEdit }: { slug: string; jobId: string; view: ClientSimulationView; canEdit: boolean }) {
  const t = useTranslations("dataio.simulation");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const rows = view.rows.filter((r) => filter === "all" || r.action === filter);
  const nothing = view.counts.create + view.counts.update === 0;
  return (
    <div className="space-y-4">
      <SettingsCard title={t("title")} description={t("clientsDescription")}>
        <div className="mb-4">
          <FilterTabs counts={view.counts} value={filter} onChange={(f) => { setFilter(f); setLimit(PAGE); }} kinds={FILTERS} />
        </div>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16 pl-4 text-xs text-muted-foreground">{t("columns.row")}</TableHead>
                <TableHead className="w-28 text-xs text-muted-foreground">{t("columns.action")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("columns.client")}</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground md:table-cell">{t("columns.contact")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("columns.reasons")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, limit).map((r) => (
                <TableRow key={r.rowNumber} className="align-top">
                  <TableCell className="pl-4 text-xs text-muted-foreground tabular">{r.rowNumber}</TableCell>
                  <TableCell>
                    <ActionBadge action={r.action} />
                  </TableCell>
                  <TableCell className="max-w-64 whitespace-normal">
                    <p className="font-medium">{r.name ?? "—"}</p>
                    {r.taxId && <p className="font-mono text-xs text-muted-foreground">{r.taxId}</p>}
                  </TableCell>
                  <TableCell className="hidden max-w-56 whitespace-normal text-xs md:table-cell">
                    {r.contact ? (
                      <>
                        <p>{r.contact.name}</p>
                        {r.contact.email && <p className="text-muted-foreground">{r.contact.email}</p>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-96 whitespace-normal">
                    <IssueList issues={r.issues} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {rows.length > limit && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setLimit((l) => l + PAGE)}>
            {t("showMore", { count: rows.length - limit })}
          </Button>
        )}
      </SettingsCard>
      {canEdit && (
        <CommitBar
          slug={slug}
          jobId={jobId}
          disabled={nothing}
          summary={nothing ? t("nothingToDo") : t("clientsSummary", { create: view.counts.create, update: view.counts.update, error: view.counts.error })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facturas
// ---------------------------------------------------------------------------

function RuleText({ line }: { line: LineView }) {
  const t = useTranslations("dataio.simulation.rule");
  const tType = useTranslations("dataio.billingTypes");
  const s = line.suggested;
  const suggestion = tType(s.billingType);
  if (s.source === "column") return <>{t("column", { value: s.keyword ?? "", type: suggestion })}</>;
  if (s.source === "keyword") return <>{t("keyword", { keyword: s.keyword ?? "", type: suggestion })}</>;
  return <>{t("none", { type: suggestion })}</>;
}

function LineTypeSelect({ slug, jobId, line, disabled }: { slug: string; jobId: string; line: LineView; disabled: boolean }) {
  const t = useTranslations("dataio.simulation");
  const tType = useTranslations("dataio.billingTypes");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (value: string) =>
    startTransition(async () => {
      const result = await setImportLineType(slug, jobId, line.rowNumber, value === AUTO ? null : (value as ImportBillingType));
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  return (
    <Select value={line.manual ? line.billingType : AUTO} onValueChange={change} disabled={disabled || pending}>
      <SelectTrigger size="sm" className="w-44" aria-label={t("columns.type")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>{t("automatic", { type: tType(line.suggested.billingType) })}</SelectItem>
        {(["monthly", "yearly", "one_off", "usage"] as const).map((type) => (
          <SelectItem key={type} value={type}>
            {tType(type)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InvoiceItem({ slug, jobId, inv, canEdit }: { slug: string; jobId: string; inv: InvoiceRowView; canEdit: boolean }) {
  const t = useTranslations("dataio.simulation");
  const { money, percent, date } = useInvoiceFormat();
  const [open, setOpen] = useState(inv.action === "error" || inv.lines.some((l) => l.suggested.ambiguous || l.suggested.source === "default"));
  const review = inv.lines.some((l) => !l.manual && (l.suggested.ambiguous || l.suggested.source === "default"));
  return (
    <li className="px-4 py-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" aria-expanded={open}>
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        <span className="font-mono text-sm font-semibold">{inv.number}</span>
        {inv.kind === "rectifying" && (
          <Badge variant="outline" className="text-muted-foreground">
            {t("rectifying")}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground tabular">{inv.issuedOn ? date(inv.issuedOn) : "—"}</span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {inv.clientName ?? "—"}
          {inv.clientIsNew && (
            <Badge variant="outline" className="ml-2 text-primary">
              <UserPlus data-icon="inline-start" />
              {t("newClient")}
            </Badge>
          )}
        </span>
        {review && inv.action === "create" && (
          <Badge className="bg-warning/15 text-warning">
            <TriangleAlert data-icon="inline-start" />
            {t("review")}
          </Badge>
        )}
        <span className="text-sm font-semibold tabular">{inv.totals ? money(inv.totals.totalCents) : "—"}</span>
        <ActionBadge action={inv.action} />
      </button>
      {!open && inv.issues.some((i) => i.severity !== "info") && <IssueList issues={inv.issues.filter((i) => i.severity !== "info")} className="mt-2 pl-7" limit={2} />}
      {open && (
        <div className="mt-3 space-y-3 pl-7">
          <IssueList issues={inv.issues} />
          {inv.lines.length > 0 && (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-14 pl-3 text-xs text-muted-foreground">{t("columns.row")}</TableHead>
                    <TableHead className="text-xs text-muted-foreground">{t("columns.concept")}</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">{t("columns.base")}</TableHead>
                    <TableHead className="text-right text-xs text-muted-foreground">{t("columns.vat")}</TableHead>
                    <TableHead className="pr-3 text-xs text-muted-foreground">{t("columns.type")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.lines.map((line) => (
                    <TableRow key={line.rowNumber} className="align-top">
                      <TableCell className="pl-3 text-xs text-muted-foreground tabular">{line.rowNumber}</TableCell>
                      <TableCell className="max-w-80 whitespace-normal">
                        <p className="text-sm">{line.description}</p>
                        <p className={cn("text-xs", line.suggested.ambiguous || line.suggested.source === "default" ? "text-warning" : "text-muted-foreground")}>
                          <RuleText line={line} />
                          {line.suggested.ambiguous && ` · ${t("ambiguous")}`}
                        </p>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular">{money(line.baseCents)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular">{percent(line.vatBps)}</TableCell>
                      <TableCell className="pr-3">
                        <LineTypeSelect slug={slug} jobId={jobId} line={line} disabled={!canEdit || inv.action !== "create"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {inv.totals && (
            <p className="text-xs text-muted-foreground tabular">
              {t("invoiceTotals", {
                base: money(inv.totals.subtotalCents),
                vat: money(inv.totals.vatCents),
                irpf: money(inv.totals.irpfCents),
                total: money(inv.totals.totalCents),
              })}
              {inv.seriesLabel && ` · ${t("series", { series: inv.seriesLabel })}`}
              {inv.paidOn && ` · ${t("paidOn", { date: date(inv.paidOn) })}`}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function InvoicesSimulation({ slug, jobId, view, canEdit }: { slug: string; jobId: string; view: InvoiceSimulationView; canEdit: boolean }) {
  const t = useTranslations("dataio.simulation");
  const tCategory = useTranslations("dataio.categories");
  const { money } = useInvoiceFormat();
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const invoices = view.invoices.filter((i) => filter === "all" || i.action === filter);
  // Las filas sin número también son errores (no llegan a ser ninguna factura).
  const counts = { ...view.counts, error: view.counts.error + view.orphanRows.length };
  const nothing = view.counts.create === 0;

  return (
    <div className="space-y-4">
      <SettingsCard title={t("title")} description={t("invoicesDescription")} bodyClassName="space-y-5">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-muted/30 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t("stats.toCreate")}</dt>
            <dd className="mt-1 text-lg font-bold tabular">{view.counts.create}</dd>
            <dd className="text-xs text-muted-foreground tabular">{money(view.totals.totalCents)}</dd>
          </div>
          <div className="rounded-xl border bg-muted/30 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t("stats.base")}</dt>
            <dd className="mt-1 text-lg font-bold tabular">{money(view.totals.subtotalCents)}</dd>
            <dd className="text-xs text-muted-foreground tabular">{t("stats.vatIrpf", { vat: money(view.totals.vatCents), irpf: money(view.totals.irpfCents) })}</dd>
          </div>
          <div className="rounded-xl border bg-muted/30 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t("stats.byCategory")}</dt>
            {(["recurring", "usage", "one_off"] as const).map((c) => (
              <dd key={c} className="flex justify-between text-xs tabular">
                <span className="text-muted-foreground">{tCategory(c)}</span>
                <span>{money(view.byCategory[c])}</span>
              </dd>
            ))}
          </div>
          <div className="rounded-xl border bg-muted/30 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t("stats.other")}</dt>
            <dd className="mt-1 text-xs">{t("stats.skipped", { count: view.counts.skip })}</dd>
            <dd className="text-xs">{t("stats.errors", { count: view.counts.error + view.orphanRows.length })}</dd>
            <dd className="text-xs">{t("stats.newClients", { count: view.newClients })}</dd>
          </div>
        </dl>

        {(view.counters.length > 0 || view.gaps.length > 0 || view.legacyCounters.length > 0) && (
          <div className="space-y-2 rounded-xl border px-4 py-3 text-xs">
            {view.counters.map((c) => (
              <p key={`${c.label}-${c.year}`} className="flex items-start gap-1.5">
                <Hash className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span>
                  {c.to > c.from
                    ? t("counterUp", { series: c.label, year: c.year || t("noYear"), from: c.from, to: c.to, next: c.to + 1 })
                    : t("counterKept", { series: c.label, year: c.year || t("noYear"), from: c.from })}
                </span>
              </p>
            ))}
            {view.gaps.map((g) => (
              <p key={`gap-${g.label}-${g.year}`} className="flex items-start gap-1.5 text-muted-foreground">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{t("gap", { series: g.label, year: g.year || t("noYear"), count: g.count, ranges: ranges(g.ranges) })}</span>
              </p>
            ))}
            {view.legacyCounters.map((c) => (
              <p key={`legacy-${c.year}`} className="flex items-start gap-1.5 text-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>{t("legacyCounter", { year: c.year, last: c.lastNumber, imported: c.imported })}</span>
              </p>
            ))}
          </div>
        )}

        <FilterTabs counts={counts} value={filter} onChange={(f) => { setFilter(f); setLimit(PAGE); }} kinds={["all", "create", "skip", "error"]} />
        {invoices.length === 0 && view.orphanRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("emptyFilter")}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {invoices.slice(0, limit).map((inv) => (
              <InvoiceItem key={inv.key} slug={slug} jobId={jobId} inv={inv} canEdit={canEdit} />
            ))}
            {(filter === "all" || filter === "error") &&
              view.orphanRows.map((r) => (
                <li key={`orphan-${r.rowNumber}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="text-xs text-muted-foreground tabular">{t("rowLabel", { row: r.rowNumber })}</span>
                  <IssueList issues={r.issues} className="flex-1" />
                  <ActionBadge action="error" />
                </li>
              ))}
          </ul>
        )}
        {invoices.length > limit && (
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            {t("showMore", { count: invoices.length - limit })}
          </Button>
        )}
      </SettingsCard>
      {canEdit && (
        <CommitBar
          slug={slug}
          jobId={jobId}
          disabled={nothing}
          summary={
            nothing
              ? t("nothingToDo")
              : t("invoicesSummary", { create: view.counts.create, total: money(view.totals.totalCents), clients: view.newClients, error: view.counts.error })
          }
        />
      )}
    </div>
  );
}

/** Paso 3: qué se haría con cada fila, con sus motivos, antes de confirmar nada. */
export function SimulationPanel({ slug, jobId, view, canEdit }: { slug: string; jobId: string; view: SimulationView; canEdit: boolean }) {
  return view.kind === "clients" ? (
    <ClientsSimulation slug={slug} jobId={jobId} view={view} canEdit={canEdit} />
  ) : (
    <InvoicesSimulation slug={slug} jobId={jobId} view={view} canEdit={canEdit} />
  );
}
