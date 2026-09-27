"use client";

import { AlertTriangle, CheckCircle2, FileText, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { useFinanceFormat } from "@/components/finance/format";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BANK_CSV_ROLES, type BankCsvMapping, type BankCsvRole } from "@/domain/banking/csv";
import type { CsvPreview } from "@/domain/banking/read";
import type { StatementIssue } from "@/domain/banking/statement";
import { cn } from "@/lib/utils";
import type { CommitResult, StatementPreview } from "@/server/banking/import";
import { Amount, useBankCodeLabel } from "./labels";
import type { BankAccountOption } from "./types";

type Failure = {
  ok: false;
  reason: string;
  error: string;
  line?: number;
  csv?: CsvPreview;
  suggestedAccountId?: string | null;
  fileAccount?: string | null;
};

type State =
  | { phase: "idle" }
  | { phase: "reading" }
  | { phase: "preview"; preview: StatementPreview }
  | { phase: "error"; failure: Failure }
  | { phase: "saving"; preview: StatementPreview };

const NONE = "none";
const ACCEPT = ".n43,.q43,.aeb,.txt,.csv,.tsv,text/plain,text/csv";

/**
 * Importar un extracto (Norma 43 o CSV) en un panel lateral: se suelta el fichero, se ve qué trae
 * (nuevos y repetidos, saldos, avisos y, en un CSV, qué columna es qué) y se guarda. Se envía a la
 * ruta de subida (las Server Actions admiten como mucho 1 MB).
 */
export function StatementImport({
  slug,
  account,
  accounts,
  open,
  onOpenChange,
  onSwitchAccount,
}: {
  slug: string;
  account: BankAccountOption;
  accounts: BankAccountOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchAccount: (accountId: string) => void;
}) {
  const t = useTranslations("banking.upload");
  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={t("title")} description={t("description", { account: account.name })}>
      <ImportBody key={`${account.id}:${open}`} slug={slug} account={account} accounts={accounts} onDone={() => onOpenChange(false)} onSwitchAccount={onSwitchAccount} />
    </SettingsSheet>
  );
}

function ImportBody({
  slug,
  account,
  accounts,
  onDone,
  onSwitchAccount,
}: {
  slug: string;
  account: BankAccountOption;
  accounts: BankAccountOption[];
  onDone: () => void;
  onSwitchAccount: (accountId: string) => void;
}) {
  const t = useTranslations("banking.upload");
  const router = useRouter();
  const { money, date } = useFinanceFormat();
  const [state, setState] = useState<State>({ phase: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<BankCsvMapping | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send(mode: "preview" | "commit", chosen: File, withMapping: BankCsvMapping | null) {
    const form = new FormData();
    form.set("file", chosen);
    form.set("account_id", account.id);
    form.set("mode", mode);
    if (withMapping) form.set("mapping", JSON.stringify(withMapping));
    const res = await fetch(`/api/banking/${slug}/imports`, { method: "POST", body: form });
    return (await res.json().catch(() => null)) as StatementPreview | CommitResult | Failure | null;
  }

  async function read(chosen: File, withMapping: BankCsvMapping | null) {
    setFile(chosen);
    setState({ phase: "reading" });
    try {
      const body = await send("preview", chosen, withMapping);
      if (!body) return setState({ phase: "error", failure: { ok: false, reason: "generic", error: t("errors.generic") } });
      if (!body.ok) {
        const failure = body as Failure;
        if (failure.csv?.mapping) setMapping(failure.csv.mapping);
        return setState({ phase: "error", failure });
      }
      const preview = body as StatementPreview;
      setMapping(preview.csv?.mapping ?? null);
      setState({ phase: "preview", preview });
    } catch {
      setState({ phase: "error", failure: { ok: false, reason: "generic", error: t("errors.generic") } });
    }
  }

  async function save(preview: StatementPreview) {
    if (!file) return;
    setState({ phase: "saving", preview });
    try {
      const body = await send("commit", file, preview.format === "csv" ? mapping : null);
      if (!body || !body.ok) {
        toast.error((body as Failure | null)?.error ?? t("errors.generic"));
        setState({ phase: "preview", preview });
        return;
      }
      const result = body as CommitResult;
      toast.success(t("done", { inserted: result.inserted, duplicates: result.duplicates }), {
        description:
          result.closingBalanceCents !== null ? t("closingUpdated", { date: date(result.periodEnd), amount: money(result.closingBalanceCents) }) : undefined,
      });
      onDone();
      router.refresh();
    } catch {
      toast.error(t("errors.generic"));
      setState({ phase: "preview", preview });
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped && state.phase !== "reading" && state.phase !== "saving") void read(dropped, null);
  }

  const busy = state.phase === "reading" || state.phase === "saving";
  const preview = state.phase === "preview" || state.phase === "saving" ? state.preview : null;
  const csv = preview?.csv ?? (state.phase === "error" ? (state.failure.csv ?? null) : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "bg-muted/30",
          )}
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand-gradient text-white">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
          </div>
          <div>
            <p className="text-sm font-semibold">{file ? file.name : t("drop")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("hint")}</p>
          </div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void read(chosen, null);
              e.target.value = "";
            }}
          />
          <Button type="button" size="sm" variant={file ? "outline" : "default"} onClick={() => input.current?.click()} disabled={busy}>
            <FileText data-icon="inline-start" />
            {state.phase === "reading" ? t("reading") : file ? t("another") : t("choose")}
          </Button>
        </div>

        {state.phase === "error" && (
          <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <p className="flex items-start gap-2 font-semibold text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {state.failure.error}
                {state.failure.line ? ` ${t("atLine", { line: state.failure.line })}` : ""}
              </span>
            </p>
            {state.failure.reason === "account_mismatch" && (
              <AccountMismatch failure={state.failure} accounts={accounts} onSwitchAccount={onSwitchAccount} />
            )}
          </div>
        )}

        {preview && <PreviewSummary preview={preview} />}

        {csv && csv.records.length > 0 && file && (
          <CsvMappingEditor csv={csv} mapping={mapping} onChange={setMapping} disabled={busy} onApply={(m) => void read(file, m)} />
        )}

        {preview && preview.movements.length > 0 && <PreviewMovements preview={preview} />}
      </div>
      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <Button type="button" variant="ghost" onClick={onDone} disabled={state.phase === "saving"}>
          {t("cancel")}
        </Button>
        <Button type="button" onClick={() => preview && void save(preview)} disabled={!preview || busy || preview.newCount === 0}>
          {state.phase === "saving" && <Loader2 className="animate-spin" data-icon="inline-start" />}
          {state.phase === "saving" ? t("saving") : t("save", { count: preview?.newCount ?? 0 })}
        </Button>
      </div>
    </div>
  );
}

function AccountMismatch({
  failure,
  accounts,
  onSwitchAccount,
}: {
  failure: Failure;
  accounts: BankAccountOption[];
  onSwitchAccount: (accountId: string) => void;
}) {
  const t = useTranslations("banking.upload");
  const other = accounts.find((a) => a.id === failure.suggestedAccountId);
  return (
    <div className="mt-2 space-y-2 text-muted-foreground">
      {failure.fileAccount && <p>{t("fileAccount", { digits: failure.fileAccount })}</p>}
      {other && (
        <Button type="button" size="sm" variant="outline" onClick={() => onSwitchAccount(other.id)}>
          {t("switchAccount", { account: other.name })}
        </Button>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warning" | "success" }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-3 py-2.5">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className={cn("mt-0.5 truncate font-bold tabular", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function useIssueText() {
  const t = useTranslations("banking.issues");
  const { date } = useFinanceFormat();
  return (issue: StatementIssue) => {
    const params: Record<string, string | number> = { line: issue.line ?? 0, ...issue.params };
    if (typeof issue.params?.date === "string") params.date = date(issue.params.date);
    return t(issue.code, params);
  };
}

function PreviewSummary({ preview }: { preview: StatementPreview }) {
  const t = useTranslations("banking.upload");
  const { money, date } = useFinanceFormat();
  const issueText = useIssueText();
  const check = preview.balanceCheck;
  const openingDiffers =
    preview.recordedOpeningCents !== null && preview.openingBalanceCents !== null && preview.recordedOpeningCents !== preview.openingBalanceCents;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Stat label={t("format")} value={t(`formats.${preview.format}`)} hint={t("period", { from: date(preview.periodStart), to: date(preview.periodEnd) })} />
        <Stat
          label={t("movements")}
          value={t("newOf", { new: preview.newCount, total: preview.summary.movements })}
          hint={preview.duplicateCount > 0 ? t("duplicates", { count: preview.duplicateCount }) : t("noDuplicates")}
        />
        <Stat
          label={t("balances")}
          value={
            preview.openingBalanceCents !== null && preview.closingBalanceCents !== null
              ? `${money(preview.openingBalanceCents)} → ${money(preview.closingBalanceCents)}`
              : "—"
          }
          hint={t("flows", { credits: money(preview.summary.credits.cents), debits: money(preview.summary.debits.cents) })}
        />
        <Stat
          label={t("check")}
          value={check.status === "ok" ? t("balanceOk") : check.status === "mismatch" ? t("balanceMismatch", { amount: money(check.differenceCents) }) : t("balanceUnknown")}
          tone={check.status === "ok" ? "success" : check.status === "mismatch" ? "warning" : undefined}
        />
      </div>
      {(preview.issues.length > 0 || openingDiffers) && (
        <ul className="space-y-1 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
          {openingDiffers && (
            <li className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              {t("openingDiffers", {
                file: money(preview.openingBalanceCents!),
                recorded: money(preview.recordedOpeningCents!),
                date: date(preview.periodStart),
              })}
            </li>
          )}
          {preview.issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              {issueText(issue)}
            </li>
          ))}
        </ul>
      )}
      {preview.newCount === 0 && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" />
          {t("nothingNew")}
        </p>
      )}
    </div>
  );
}

function PreviewMovements({ preview }: { preview: StatementPreview }) {
  const t = useTranslations("banking.upload");
  const { date } = useFinanceFormat();
  const codeLabel = useBankCodeLabel();
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("sample")}</p>
      <ul className="divide-y overflow-hidden rounded-xl border">
        {preview.movements.map((m, i) => (
          <li key={i} className={cn("flex items-center gap-3 px-3 py-2 text-sm", m.duplicate && "opacity-50")}>
            <span className="w-20 shrink-0 text-xs text-muted-foreground tabular">{date(m.bookedOn)}</span>
            <span className="min-w-0 flex-1 truncate">{m.concept || codeLabel(m.bankCode) || "—"}</span>
            {m.duplicate && <span className="shrink-0 text-[11px] text-muted-foreground">{t("duplicate")}</span>}
            <Amount cents={m.amountCents} className="shrink-0 text-sm" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CsvMappingEditor({
  csv,
  mapping,
  onChange,
  onApply,
  disabled,
}: {
  csv: CsvPreview;
  mapping: BankCsvMapping | null;
  onChange: (mapping: BankCsvMapping) => void;
  onApply: (mapping: BankCsvMapping) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("banking.upload.mapping");
  const current: BankCsvMapping = mapping ?? { headerRow: 0, columns: {}, decimal: ",", dateOrder: "dmy" };
  const header = csv.records[current.headerRow] ?? [];
  const setColumn = (role: BankCsvRole, value: string) => {
    const columns = { ...current.columns };
    if (value === NONE) delete columns[role];
    else columns[role] = Number(value);
    onChange({ ...current, columns });
  };
  return (
    <div className="rounded-2xl border bg-card px-4 py-4">
      <p className="text-sm font-semibold">{t("title")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("hint")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={t("headerRow")}>
          <Select value={String(current.headerRow)} onValueChange={(v) => onChange({ ...current, headerRow: Number(v), columns: {} })} disabled={disabled}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {csv.records.slice(0, 25).map((row, i) => (
                <SelectItem key={i} value={String(i)}>
                  <span className="truncate">{t("row", { row: i + 1, text: row.filter(Boolean).join(" · ").slice(0, 60) })}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("decimal")}>
            <Select value={current.decimal} onValueChange={(v) => onChange({ ...current, decimal: v === "." ? "." : "," })} disabled={disabled}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=",">{t("decimalComma")}</SelectItem>
                <SelectItem value=".">{t("decimalDot")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("dateOrder")}>
            <Select value={current.dateOrder} onValueChange={(v) => onChange({ ...current, dateOrder: v === "mdy" ? "mdy" : "dmy" })} disabled={disabled}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dmy">{t("dmy")}</SelectItem>
                <SelectItem value="mdy">{t("mdy")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {BANK_CSV_ROLES.map((role) => (
          <Field key={role} label={t(`roles.${role}`)}>
            <Select value={current.columns[role] === undefined ? NONE : String(current.columns[role])} onValueChange={(v) => setColumn(role, v)} disabled={disabled}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("none")}</SelectItem>
                {header.map((name, index) => (
                  <SelectItem key={index} value={String(index)}>
                    {name || t("column", { index: index + 1 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ))}
      </div>
      <Button type="button" size="sm" variant="outline" className="mt-4" onClick={() => onApply(current)} disabled={disabled}>
        {t("apply")}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
