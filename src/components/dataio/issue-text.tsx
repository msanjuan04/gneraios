"use client";

import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { useInvoiceFormat } from "@/components/invoices/format";
import type { ImportField } from "@/domain/dataio/fields";
import type { Issue, RowAction } from "@/domain/dataio/issues";
import { cn } from "@/lib/utils";

const ACTION_STYLES: Record<RowAction, string> = {
  create: "bg-success/15 text-success",
  update: "bg-primary/15 text-primary",
  skip: "bg-secondary text-muted-foreground",
  error: "bg-destructive/15 text-destructive",
};

/** Qué se hace (o se hizo) con una fila: crear, completar, saltar o error. */
export function ActionBadge({ action, className }: { action: RowAction | null; className?: string }) {
  const t = useTranslations("dataio.actions");
  if (!action) return <Badge variant="outline" className={cn("text-muted-foreground", className)}>{t("pending")}</Badge>;
  return <Badge className={cn(ACTION_STYLES[action], className)}>{t(action)}</Badge>;
}

// Todos los parámetros que usan los mensajes de dataio.issues: si un motivo llega sin alguno (p. ej.
// el que devuelve la base de datos al confirmar), el mensaje se pinta igualmente.
const EMPTY_PARAMS = {
  value: "",
  number: "",
  date: "",
  name: "",
  formats: "",
  row: "",
  rate: "",
  regime: "",
  taxId: "",
  a: "",
  b: "",
  expected: "",
  computed: "",
  cents: "",
  total: "",
  year: "",
  field: "",
  fields: "",
  reason: "",
};

const MONEY_PARAMS = new Set(["expected", "computed", "total"]);

/** Texto de un motivo con sus parámetros ya formateados (importes, tipos, fechas, campos). */
export function useIssueText() {
  const t = useTranslations("dataio.issues");
  const tField = useTranslations("dataio.fields");
  const tRegime = useTranslations("dataio.ledger.regimes");
  const { money, percent, date } = useInvoiceFormat();
  const field = (f: ImportField) => (tField.has(f) ? tField(f) : f);
  return (issue: Issue): string => {
    const params: Record<string, string | number> = { ...EMPTY_PARAMS };
    for (const [key, value] of Object.entries(issue.params ?? {})) {
      if (MONEY_PARAMS.has(key) && typeof value === "number") params[key] = money(value);
      else if (key === "cents" && typeof value === "number") params[key] = money(value);
      else if (key === "rate" && typeof value === "number") params[key] = percent(value);
      else if (key === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) params[key] = date(value);
      else if (key === "regime" && typeof value === "string" && tRegime.has(value)) params[key] = tRegime(value);
      else params[key] = value;
    }
    if (issue.field) params.field = field(issue.field);
    if (issue.fields) params.fields = issue.fields.map(field).join(", ");
    return t.has(issue.code) ? t(issue.code, params) : issue.code;
  };
}

const SEVERITY_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const SEVERITY_STYLE = { error: "text-destructive", warning: "text-warning", info: "text-muted-foreground" } as const;

/** Lista de motivos de una fila, de más a menos grave. */
export function IssueList({ issues, className, limit }: { issues: readonly Issue[]; className?: string; limit?: number }) {
  const text = useIssueText();
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  if (shown.length === 0) return null;
  return (
    <ul className={cn("space-y-1", className)}>
      {shown.map((issue, i) => {
        const Icon = SEVERITY_ICON[issue.severity];
        return (
          <li key={`${issue.code}-${i}`} className={cn("flex items-start gap-1.5 text-xs", SEVERITY_STYLE[issue.severity])}>
            <Icon className="mt-0.5 size-3.5 shrink-0" />
            <span className={issue.severity === "info" ? "text-muted-foreground" : "text-foreground"}>{text(issue)}</span>
          </li>
        );
      })}
    </ul>
  );
}
