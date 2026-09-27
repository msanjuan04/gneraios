"use client";

import { ChevronDown, ChevronRight, CircleAlert, ExternalLink, ListPlus, Loader, RotateCcw, UserPlus, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createSeries } from "@/app/[org]/settings/issuers/actions";
import { useShell } from "@/components/app-shell/shell-context";
import { useInvoiceFormat } from "@/components/invoices/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { newClientTaxIdValid } from "@/domain/invoice-import/form";
import { type ImportSetup, matchSeries } from "@/domain/invoice-import/match";
import { cn } from "@/lib/utils";
import { getInvoiceImportSetup } from "@/server/invoice-import/actions";
import { PdfDropzone } from "./dropzone";
import { ExistingPanel } from "./existing-panel";
import { RowForm } from "./row-form";
import type { RowStatus } from "./types";
import { type ImportItem, openAmount, type RowView, rowView, useInvoiceImport } from "./use-invoice-import";

const STATUS_STYLES: Record<RowStatus, string> = {
  reading: "bg-muted text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
  ready: "bg-success/15 text-success",
  review: "bg-warning/15 text-warning",
  payment: "bg-primary/15 text-primary",
  existing: "bg-muted text-muted-foreground",
  saving: "bg-muted text-muted-foreground",
  saved: "bg-success/15 text-success",
};

type Props = {
  slug: string;
  /** Desde la ficha de un cliente (o un proyecto suyo): todas las facturas son de ese cliente. */
  clientId?: string | null;
  /** Desde un proyecto: solo para volver a pintarlo al guardar. */
  projectId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * «Importar facturas emitidas»: se sueltan los PDF (muchos a la vez), se leen de tres en tres y
 * cada uno sale en una fila con su estado (lista, a revisar, ya importada, registrar cobro o
 * error). La fila se despliega en el formulario ya rellenado. Las listas se guardan de una vez;
 * cada factura por su cuenta, así un fallo no deshace las demás.
 */
export function InvoiceImportSheet({ slug, clientId = null, projectId = null, open, onOpenChange }: Props) {
  const t = useTranslations("invoiceImport.sheet");
  const tToolbar = useTranslations("invoiceImport.toolbar");
  const tDrop = useTranslations("invoiceImport.drop");
  const tToast = useTranslations("invoiceImport.toasts");
  const router = useRouter();
  const { basePath, preview, member } = useShell();
  // Las series las crea un owner (como en Ajustes → Emisores): a los socios se les dice a quién pedirlo.
  const canCreateSeries = member.role === "owner";
  const [setup, setSetup] = useState<ImportSetup | null>(null);
  const [lockedClient, setLockedClient] = useState<{ id: string; name: string } | null>(null);
  const [claude, setClaude] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [creating, setCreating] = useState<string[]>([]);
  const [creatingSeries, setCreatingSeries] = useState<string[]>([]);
  const [paidOn, setPaidOn] = useState("");
  const [changed, setChanged] = useState(false);

  const onClientsCreated = useCallback(
    (clients: { id: string; name: string; taxId: string | null }[]) =>
      setSetup((s) =>
        s
          ? {
              ...s,
              clients: [
                ...s.clients,
                ...clients.filter((c) => !s.clients.some((o) => o.id === c.id)).map((c) => ({ id: c.id, name: c.name, legalName: c.name, taxId: c.taxId, paymentTermsDays: null })),
              ].sort((a, b) => a.name.localeCompare(b.name, "es")),
            }
          : s,
      ),
    [],
  );
  const importer = useInvoiceImport({
    slug,
    projectId,
    lockedClientId: clientId,
    setup,
    defaultDescription: t("defaultDescription"),
    onClientsCreated,
  });
  const { items } = importer;

  // Al abrir: los datos de la org (emisores, series, tipos, clientes).
  useEffect(() => {
    if (!open || preview) return;
    let cancelled = false;
    void (async () => {
      const result = await getInvoiceImportSetup(slug, clientId);
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setSetup(result.setup);
      setLockedClient(result.lockedClient);
      setClaude(result.claude);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, preview, slug, clientId]);

  const views = useMemo(() => new Map(items.map((item) => [item.id, rowView(item, setup)])), [items, setup]);
  const view = (item: ImportItem): RowView => views.get(item.id)!;
  const count = (status: RowStatus) => items.filter((i) => view(i).status === status).length;
  const reading = count("reading");
  const readyIds = items.filter((i) => view(i).status === "ready").map((i) => i.id);
  const missingClients = items.filter((i) => i.form && !i.form.clientId && i.form.newClient && newClientTaxIdValid(i.form.newClient) && i.phase === "extracted" && !i.existing);
  // Números que no encajan en ninguna serie de su emisor: la serie que haría falta, una por formato.
  const missingSeries = [
    ...new Map(
      items.flatMap((i) => {
        const suggested = view(i).issues.find((x) => x.code === "number_format")?.params?.suggested;
        return i.form?.issuerId && typeof suggested === "string" && suggested !== ""
          ? [[`${i.form.issuerId}|${suggested}`, { issuerId: i.form.issuerId, format: suggested }] as const]
          : [];
      }),
    ).values(),
  ];
  const selectable = items.filter((i) => ["ready", "review", "payment"].includes(view(i).status));
  const selected = selectable.filter((i) => i.selected);

  const close = (next: boolean) => {
    if (!next) {
      if (changed) router.refresh();
      setChanged(false);
      // Lo guardado ya está en su sitio: al volver a abrir, solo lo pendiente.
      for (const item of items) if (item.phase === "saved") importer.remove(item.id);
    }
    onOpenChange(next);
  };

  const addFiles = (files: File[], rejected: number) => {
    if (preview) {
      toast.info(t("previewOnly"));
      return;
    }
    if (rejected > 0) toast.warning(tDrop("rejected", { count: rejected }));
    if (files.length > 0) importer.addFiles(files);
  };

  const save = async (id: string) => {
    const ok = await importer.saveItem(id);
    if (ok) {
      setChanged(true);
      toast.success(tToast("saved", { count: 1 }));
    }
  };

  const saveReady = async () => {
    const ids = readyIds;
    let saved = 0;
    setBulk({ done: 0, total: ids.length });
    for (const [index, id] of ids.entries()) {
      if (await importer.saveItem(id)) saved += 1;
      setBulk({ done: index + 1, total: ids.length });
    }
    setBulk(null);
    if (saved > 0) setChanged(true);
    if (saved === ids.length) toast.success(tToast("saved", { count: saved }));
    else toast.warning(tToast("savedSome", { saved, failed: ids.length - saved }));
  };

  const createClients = async (ids: string[]) => {
    setCreating(ids);
    const result = await importer.createClients(ids);
    setCreating([]);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const created = result.results.filter((r) => "clientId" in r && r.created).length;
    const reused = result.results.filter((r) => "clientId" in r && !r.created).length;
    const failed = result.results.filter((r) => "error" in r).length;
    if (created + reused > 0) setChanged(true);
    (failed > 0 ? toast.warning : toast.success)(tToast("clients", { created, reused, failed }));
  };

  /**
   * Crea las series que faltan (una por emisor y formato) y pasa a ellas las facturas cuyo número
   * no encajaba en la suya: la serie por defecto no cambia.
   */
  const createSeriesFor = async (wanted: { issuerId: string; format: string }[]) => {
    if (!setup || wanted.length === 0) return;
    const keys = wanted.map((w) => `${w.issuerId}|${w.format}`);
    setCreatingSeries(keys);
    let next = setup;
    const created: string[] = [];
    for (const w of wanted) {
      const result = await createSeries(slug, { issuer_id: w.issuerId, code: "", name: "", kind: "ordinary", format: w.format });
      if (!result.ok) {
        toast.error(result.error);
        continue;
      }
      const series = result.series;
      created.push(series.code);
      next = { ...next, series: [...next.series, { id: series.id, issuerId: series.issuerId, code: series.code, name: series.name, format: series.format, resetYearly: series.resetYearly, isDefault: false, archived: false }] };
    }
    setCreatingSeries([]);
    if (created.length === 0) return;
    setSetup(next);
    let moved = 0;
    for (const item of items) {
      const form = item.form;
      if (!form?.issuerId || !view(item).issues.some((x) => x.code === "number_format")) continue;
      const match = matchSeries({ number: form.number, issuerId: form.issuerId, issuedOn: form.issuedOn || null }, next);
      if (!match) continue;
      moved += 1;
      importer.updateForm(item.id, "series", (f) => ({ ...f, seriesId: match.seriesId, number: match.number }));
    }
    toast.success(tToast("seriesCreated", { codes: created.join(", "), count: created.length, moved }));
  };

  const settle = async (id: string, withPayment: boolean) => {
    const ok = await importer.settleExisting(id, withPayment);
    if (ok) {
      setChanged(true);
      toast.success(withPayment ? tToast("paymentRecorded") : tToast("attached"));
    }
  };

  const markPaid = () => {
    importer.markPaid(
      selected.map((i) => i.id),
      paidOn,
    );
    toast.success(tToast("markedPaid", { count: selected.length }));
  };

  const title = lockedClient ? t("titleClient", { name: lockedClient.name }) : t("title");

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-5xl">
        <SheetHeader className="border-b px-5 py-4 pr-14">
          <SheetTitle className="text-base font-bold">{title}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
          {setup && <p className="text-xs text-muted-foreground">{claude ? t("claudeOn") : t("claudeOff")}</p>}
        </SheetHeader>
        <SheetClose asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3.5 right-3.5" aria-label={t("close")}>
            <XIcon />
          </Button>
        </SheetClose>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {loadError ? (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <CircleAlert className="size-4" />
              {loadError}
            </p>
          ) : !setup && !preview ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <PdfDropzone onFiles={addFiles} compact={items.length > 0} />
          )}

          {items.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular" aria-live="polite">
                {reading > 0 && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                    <Loader className="size-3.5 animate-spin" />
                    {t("reading", { done: items.length - reading, total: items.length })}
                  </span>
                )}
                <span>
                  {t("summary", {
                    ready: count("ready"),
                    review: count("review"),
                    existing: count("payment") + count("existing"),
                    errors: count("error"),
                    saved: count("saved"),
                  })}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2">
                <label className="inline-flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectable.length > 0 && selected.length === selectable.length ? true : selected.length > 0 ? "indeterminate" : false}
                    onCheckedChange={(v) =>
                      importer.setSelected(
                        selectable.map((i) => i.id),
                        v === true,
                      )
                    }
                    aria-label={tToolbar("selectAll")}
                  />
                  {selected.length > 0 ? tToolbar("selected", { count: selected.length }) : tToolbar("selectAll")}
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">{tToolbar("markPaid")}</span>
                  <Input
                    type="date"
                    className="h-7 w-36"
                    value={paidOn}
                    max={setup?.today}
                    aria-label={tToolbar("markPaidDate")}
                    onChange={(e) => setPaidOn(e.target.value)}
                  />
                  <Button size="sm" variant="outline" disabled={selected.length === 0 || !paidOn || (setup !== null && paidOn > setup.today)} onClick={markPaid}>
                    {tToolbar("apply")}
                  </Button>
                </div>
                {canCreateSeries && missingSeries.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={creatingSeries.length > 0}
                    onClick={() => createSeriesFor(missingSeries)}
                  >
                    <ListPlus data-icon="inline-start" />
                    {creatingSeries.length > 0 ? tToolbar("creatingSeries") : tToolbar("createSeries", { count: missingSeries.length })}
                  </Button>
                )}
                {missingClients.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(!(canCreateSeries && missingSeries.length > 0) && "ml-auto")}
                    disabled={creating.length > 0}
                    onClick={() => createClients(missingClients.map((i) => i.id))}
                  >
                    <UserPlus data-icon="inline-start" />
                    {creating.length > 0 ? tToolbar("creatingClients") : tToolbar("createClients", { count: new Set(missingClients.map((i) => i.form!.newClient!.taxId || i.form!.newClient!.name)).size })}
                  </Button>
                )}
              </div>

              <ul className="divide-y rounded-xl border">
                {items.map((item) => (
                  <ImportRow
                    key={item.id}
                    item={item}
                    view={view(item)}
                    setup={setup}
                    lockedClient={lockedClient}
                    expanded={expanded === item.id}
                    onToggle={() => setExpanded((e) => (e === item.id ? null : item.id))}
                    onSelect={(v) => importer.setSelected([item.id], v)}
                    basePath={basePath}
                  >
                    {expanded === item.id && setup && item.phase !== "saved" && (
                      <div className="border-t bg-background px-4 py-4">
                        {item.existing && item.existingAction ? (
                          <ExistingPanel
                            basePath={basePath}
                            item={item}
                            setup={setup}
                            onChange={(fn) => importer.setExistingAction(item.id, fn)}
                            onSettle={(withPayment) => settle(item.id, withPayment)}
                            onRemove={() => importer.remove(item.id)}
                          />
                        ) : item.form && item.extraction ? (
                          <RowForm
                            slug={slug}
                            item={item}
                            view={view(item)}
                            setup={setup}
                            lockedClient={lockedClient}
                            onUpdate={(field, fn) => importer.updateForm(item.id, field, fn)}
                            onSave={() => save(item.id)}
                            onRemove={() => importer.remove(item.id)}
                            onCreateClient={() => createClients([item.id])}
                            onNumberTaken={(existing) => importer.setNumberTaken(item.id, existing)}
                            creatingClient={creating.includes(item.id)}
                            canCreateSeries={canCreateSeries}
                            onCreateSeries={(format) => item.form?.issuerId && createSeriesFor([{ issuerId: item.form.issuerId, format }])}
                            creatingSeries={item.form?.issuerId ? creatingSeries.some((k) => k.startsWith(`${item.form!.issuerId}|`)) : false}
                          />
                        ) : null}
                      </div>
                    )}
                    {item.phase === "failed" && (
                      <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-3">
                        <Button size="sm" variant="ghost" onClick={() => importer.remove(item.id)}>
                          {t("remove")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => importer.retry(item.id)}>
                          <RotateCcw data-icon="inline-start" />
                          {t("retry")}
                        </Button>
                      </div>
                    )}
                  </ImportRow>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {bulk && <span className="mr-auto text-xs text-muted-foreground tabular">{tToolbar("saving", bulk)}</span>}
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            {t("close")}
          </Button>
          <Button type="button" onClick={saveReady} disabled={readyIds.length === 0 || bulk !== null}>
            {tToolbar("saveReady", { count: readyIds.length })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ImportRow({
  item,
  view,
  setup,
  lockedClient,
  expanded,
  onToggle,
  onSelect,
  basePath,
  children,
}: {
  item: ImportItem;
  view: RowView;
  setup: ImportSetup | null;
  lockedClient: { id: string; name: string } | null;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (selected: boolean) => void;
  basePath: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("invoiceImport.row");
  const tStatus = useTranslations("invoiceImport.status");
  const tReason = useTranslations("invoiceImport.reasons");
  const tPayment = useTranslations("invoiceImport.payment");
  const { money, date } = useInvoiceFormat();
  const form = item.form;
  const existing = item.existing;
  const number = existing?.number ?? form?.number ?? item.extraction?.number?.value ?? "";
  const client = existing
    ? existing.clientName
    : lockedClient && form?.clientId === lockedClient.id
      ? lockedClient.name
      : (setup?.clients.find((c) => c.id === form?.clientId)?.name ?? (form?.newClient ? t("newClient", { name: form.newClient.name }) : ""));
  const issuedOn = existing?.issuedOn ?? form?.issuedOn ?? "";
  const total = existing ? existing.netTotalCents : (view.totals?.totalCents ?? item.extraction?.totalCents?.value ?? null);
  const canExpand = item.phase === "extracted" || item.phase === "saving";
  const selectable = ["ready", "review", "payment"].includes(view.status);
  const existingLabel = existing?.source === "app" ? (existing.status === "paid" ? "existingAppPaid" : "existingApp") : existing?.status === "paid" ? "existingPaid" : "existing";
  const statusLabel =
    view.status === "existing" ? tStatus(existingLabel) : view.status === "saved" && item.result ? tStatus(`saved_${item.result.kind}`) : tStatus(view.status);
  const payment = existing
    ? null
    : form
      ? form.payment.status === "pending"
        ? tPayment("pending")
        : `${tPayment(form.payment.status)}${form.payment.paidOn ? ` · ${date(form.payment.paidOn)}` : ""}`
      : null;

  return (
    <li className={cn(expanded && "bg-muted/20")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Checkbox checked={item.selected} disabled={!selectable} onCheckedChange={(v) => onSelect(v === true)} aria-label={t("select", { name: item.file.name })} />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
          onClick={onToggle}
          disabled={!canExpand}
          aria-expanded={expanded}
        >
          <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold", STATUS_STYLES[view.status])}>
            {(view.status === "reading" || view.status === "saving") && <Loader className="size-3 animate-spin" />}
            {statusLabel}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-mono text-sm font-semibold">{number || t("noNumber")}</span>
              <span className="truncate text-sm text-muted-foreground">{client || t("noClient")}</span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {item.file.name}
              {view.status === "review" && view.reasons.length > 0 && ` · ${view.reasons.slice(0, 2).map((r) => tReason(r)).join(" · ")}`}
              {view.status === "payment" && existing && ` · ${t("outstanding", { amount: money(openAmount(existing)) })}`}
              {view.status === "error" && item.error && ` · ${item.error}`}
            </span>
          </span>
          <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground tabular sm:block">{issuedOn ? date(issuedOn) : ""}</span>
          <span className="hidden w-28 shrink-0 text-right text-sm font-semibold tabular sm:block">{total !== null ? money(total) : ""}</span>
          <span className="hidden w-32 shrink-0 truncate text-right text-xs text-muted-foreground md:block">{payment}</span>
          {canExpand ? expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
        </button>
        {item.phase === "saved" && item.result && (
          <Button asChild variant="ghost" size="xs">
            <a href={`${basePath}/invoices/${item.result.invoiceId}`} target="_blank" rel="noreferrer">
              <ExternalLink data-icon="inline-start" />
              {t("openInvoice")}
            </a>
          </Button>
        )}
      </div>
      {children}
    </li>
  );
}
