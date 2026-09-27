"use client";

import { ChevronDown, Loader2, TriangleAlert, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveImportMapping } from "@/app/[org]/settings/data/actions";
import type { ImportOptions } from "@/app/[org]/settings/data/schema";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ImportField } from "@/domain/dataio/fields";
import { cn } from "@/lib/utils";
import type { MappingView } from "./types";

const NONE = "none";
const AUTO = "auto";

/** Campos por bloque, en el orden en que se enseñan. */
const SECTIONS: Record<MappingView["kind"], { key: string; fields: ImportField[] }[]> = {
  clients: [
    {
      key: "client",
      fields: ["display_name", "legal_name", "tax_id", "address_line", "postal_code", "city", "province", "country", "sector", "website", "payment_terms_days", "language", "source", "owner", "external_id", "notes"],
    },
    { key: "contact", fields: ["contact_name", "contact_role", "contact_email", "contact_phone"] },
  ],
  invoices: [
    { key: "invoice", fields: ["number", "issued_on", "operation_on", "due_on", "series", "issuer_tax_id", "kind", "rectifies_number", "rectification_reason", "payment_method", "notes"] },
    { key: "client", fields: ["client_name", "client_tax_id", "client_address", "client_postal_code", "client_city", "client_province", "client_country", "client_email"] },
    { key: "lines", fields: ["description", "quantity", "unit_price", "discount", "line_amount", "vat_rate", "vat_regime", "billing_type", "period_start", "period_end"] },
    { key: "totals", fields: ["base", "vat_amount", "irpf_rate", "irpf_amount", "total"] },
    { key: "payment", fields: ["paid", "paid_on"] },
  ],
};

/** Letra de columna de hoja de cálculo: 0 → A, 26 → AA. */
function columnLetter(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * Paso 2: qué columna del fichero es cada campo (propuesto automáticamente por el título, se puede
 * cambiar) y las opciones de la importación. Guardar vuelve a simular.
 */
export function MappingForm({
  slug,
  jobId,
  view,
  canEdit,
  collapsed: startCollapsed = false,
}: {
  slug: string;
  jobId: string;
  view: MappingView;
  canEdit: boolean;
  /** Con la simulación ya hecha, el mapeo se enseña plegado. */
  collapsed?: boolean;
}) {
  const t = useTranslations("dataio.mapping");
  const tField = useTranslations("dataio.fields");
  const tHint = useTranslations("dataio.fieldHints");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>(view.mapping);
  const [options, setOptions] = useState<ImportOptions>(view.options);

  const columnLabel = (index: number) => {
    const header = view.columns[index]?.header;
    return `${columnLetter(index)} · ${header || t("untitled")}`;
  };
  const assign = (field: ImportField, value: string) => {
    setMapping((current) => {
      const next = { ...current };
      if (value === NONE) {
        delete next[field];
        return next;
      }
      const column = Number(value);
      // Una columna es un solo campo: se quita del que la tuviera.
      for (const [other, index] of Object.entries(next)) if (index === column) delete next[other as ImportField];
      next[field] = column;
      return next;
    });
  };
  const required = new Set<ImportField>(
    view.kind === "clients" ? ["display_name"] : ["number", "issued_on", "client_name", "base"],
  );
  const issuerFromFile = mapping.issuer_tax_id !== undefined;

  function save() {
    startTransition(async () => {
      const columns = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== undefined)) as Record<string, number>;
      const result = await saveImportMapping(slug, jobId, { columns, options });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("saved"));
      router.refresh();
    });
  }

  const mappedCount = Object.values(mapping).filter((v) => v !== undefined).length;
  if (collapsed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-3 text-sm">
        <p>
          <span className="font-bold">{t("title")}</span>
          <span className="text-muted-foreground"> · {t("mappedCount", { count: mappedCount, columns: view.columns.length })}</span>
        </p>
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(false)}>
          <ChevronDown data-icon="inline-start" />
          {canEdit ? t("edit") : t("show")}
        </Button>
      </div>
    );
  }

  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      footer={
        canEdit ? (
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
            {t("save")}
          </Button>
        ) : undefined
      }
      bodyClassName="space-y-6"
    >
      {view.missing.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>{t("missing", { fields: view.missing.map((f) => t(`requiredGroups.${f}`)).join(", ") })}</span>
        </p>
      )}
      {view.kind === "invoices" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            id="opt-issuer"
            label={t("options.issuer")}
            description={issuerFromFile ? t("options.issuerFromFile") : t("options.issuerHint")}
          >
            <Select
              value={options.issuerId ?? NONE}
              onValueChange={(v) => setOptions((o) => ({ ...o, issuerId: v === NONE ? null : v }))}
              disabled={!canEdit}
            >
              <SelectTrigger id="opt-issuer" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("options.noIssuer")}</SelectItem>
                {view.issuers.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                    {i.taxId ? ` · ${i.taxId}` : ""}
                    {i.archived ? ` · ${t("options.archived")}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="opt-paid" label={t("options.paid")} description={t(`options.paidHint.${options.paidMode}`)}>
            <Select value={options.paidMode} onValueChange={(v) => setOptions((o) => ({ ...o, paidMode: v as ImportOptions["paidMode"] }))} disabled={!canEdit}>
              <SelectTrigger id="opt-paid" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["all", "column", "none"] as const).map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`options.paidModes.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="opt-vat" label={t("options.defaultVat")} description={t("options.defaultVatHint")}>
            <Select
              value={options.defaultVatBps === null ? NONE : String(options.defaultVatBps)}
              onValueChange={(v) => setOptions((o) => ({ ...o, defaultVatBps: v === NONE ? null : Number(v) }))}
              disabled={!canEdit}
            >
              <SelectTrigger id="opt-vat" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("options.noDefaultVat")}</SelectItem>
                {view.vatRates.map((r) => (
                  <SelectItem key={r.bps} value={String(r.bps)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="opt-decimal" label={t("options.decimal")} description={t("options.detected", { value: t(`options.decimals.${view.inferred.decimal === "," ? "comma" : "dot"}`) })}>
            <Select
              value={options.decimal === null ? AUTO : options.decimal === "," ? "comma" : "dot"}
              onValueChange={(v) => setOptions((o) => ({ ...o, decimal: v === AUTO ? null : v === "comma" ? "," : "." }))}
              disabled={!canEdit}
            >
              <SelectTrigger id="opt-decimal" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{t("options.auto")}</SelectItem>
                <SelectItem value="comma">{t("options.decimals.comma")}</SelectItem>
                <SelectItem value="dot">{t("options.decimals.dot")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="opt-dates" label={t("options.dateOrder")} description={t("options.detected", { value: t(`options.dateOrders.${view.inferred.dateOrder}`) })}>
            <Select
              value={options.dateOrder ?? AUTO}
              onValueChange={(v) => setOptions((o) => ({ ...o, dateOrder: v === AUTO ? null : (v as "dmy" | "mdy") }))}
              disabled={!canEdit}
            >
              <SelectTrigger id="opt-dates" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>{t("options.auto")}</SelectItem>
                <SelectItem value="dmy">{t("options.dateOrders.dmy")}</SelectItem>
                <SelectItem value="mdy">{t("options.dateOrders.mdy")}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      )}

      {SECTIONS[view.kind].map((section) => (
        <div key={section.key}>
          <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t(`sections.${section.key}`)}</h4>
          <div className="divide-y rounded-xl border">
            {section.fields.map((field) => {
              const column = mapping[field];
              const samples = column !== undefined ? (view.columns[column]?.samples ?? []) : [];
              const isRequired = required.has(field);
              return (
                <div key={field} className="grid items-center gap-x-4 gap-y-1 px-3 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,16rem)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {tField(field)}
                      {isRequired && <span className="text-destructive"> *</span>}
                    </p>
                    {tHint.has(field) && <p className="text-xs text-muted-foreground">{tHint(field)}</p>}
                  </div>
                  <Select value={column === undefined ? NONE : String(column)} onValueChange={(v) => assign(field, v)} disabled={!canEdit}>
                    <SelectTrigger size="sm" className={cn("w-full", column === undefined && "text-muted-foreground")} aria-label={tField(field)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("noColumn")}</SelectItem>
                      {view.columns.map((c) => (
                        <SelectItem key={c.index} value={String(c.index)}>
                          {columnLabel(c.index)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="truncate text-xs text-muted-foreground" title={samples.join(" · ")}>
                    {samples.length > 0 ? samples.join(" · ") : column !== undefined ? t("emptyColumn") : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </SettingsCard>
  );
}
