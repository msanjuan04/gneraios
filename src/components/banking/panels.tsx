"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Landmark, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteBankRule, deleteBankStatement } from "@/app/[org]/finance/bank/actions";
import { useFinanceFormat } from "@/components/finance/format";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BankRuleItem, BankStatementItem } from "./types";

/** Sin cuentas no hay extractos: primero se da de alta la cuenta en Caja. */
export function NoAccounts({ slug }: { slug: string }) {
  const t = useTranslations("banking.empty.noAccounts");
  return (
    <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
        <Landmark className="size-5" />
      </div>
      <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("title")}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t("body")}</p>
      <Button asChild className="mt-6">
        <Link href={`/${slug}/finance/cash`}>{t("action")}</Link>
      </Button>
    </div>
  );
}

/** Una cuenta sin extractos: cómo sacar el Norma 43 de la banca online y el botón para subirlo. */
export function NoStatements({ canEdit, onUpload }: { canEdit: boolean; onUpload: () => void }) {
  const t = useTranslations("banking.empty.noStatements");
  const steps = ["step1", "step2", "step3", "step4"] as const;
  return (
    <div className="rounded-3xl border bg-card/50 px-6 py-12 md:px-10 md:py-14">
      <div className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
          <Upload className="size-5" />
        </div>
        <h3 className="mt-5 text-2xl font-extrabold heading-tight">{t("title")}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{t("body")}</p>
      </div>
      <ol className="mt-6 space-y-2.5">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{i + 1}</span>
            <span className="pt-0.5">{t(step)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">{t("note")}</p>
      <div className="mt-6 text-center">
        {canEdit ? (
          <Button onClick={onUpload}>
            <Upload data-icon="inline-start" />
            {t("action")}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t("readOnly")}</p>
        )}
      </div>
    </div>
  );
}

function Disclosure({ title, count, children, defaultOpen = false }: { title: string; count: number; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-2xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span>
          {title} <span className="font-normal text-muted-foreground tabular">({count})</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t">{children}</div>}
    </section>
  );
}

/** Extractos importados de la cuenta: periodo, movimientos nuevos, saldos y si cuadran. */
export function StatementsPanel({ slug, statements, canEdit }: { slug: string; statements: BankStatementItem[]; canEdit: boolean }) {
  const t = useTranslations("banking.statements");
  const { money, date } = useFinanceFormat();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const remove = (id: string) =>
    start(async () => {
      const result = await deleteBankStatement(slug, id);
      if (!result.ok) return void toast.error(result.error);
      toast.success(t("deleted", { count: result.deleted }));
      setConfirming(null);
    });
  return (
    <Disclosure title={t("title")} count={statements.length}>
      {statements.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {statements.map((s) => (
            <li key={s.id} className="px-4 py-3 text-sm">
              {confirming === s.id ? (
                <InlineConfirm
                  tone="destructive"
                  icon={<Trash2 className="text-destructive" />}
                  confirmLabel={t("deleteConfirm")}
                  onConfirm={() => remove(s.id)}
                  onCancel={() => setConfirming(null)}
                  pending={pending}
                >
                  <p>{t("deleteBody", { count: s.newCount })}</p>
                </InlineConfirm>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold tabular">{t("period", { from: date(s.periodStart), to: date(s.periodEnd) })}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[s.fileName, t(`formats.${s.format}`), s.importedByName ? t("by", { name: s.importedByName, date: date(s.importedAt.slice(0, 10)) }) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground tabular">{t("newOf", { new: s.newCount, total: s.movementsInFile })}</p>
                  <p className="text-xs text-muted-foreground tabular">
                    {s.openingBalanceCents !== null && s.closingBalanceCents !== null ? `${money(s.openingBalanceCents)} → ${money(s.closingBalanceCents)}` : t("noBalances")}
                  </p>
                  <p
                    className={cn(
                      "flex items-center gap-1 text-xs tabular",
                      s.balanceGapCents === 0 ? "text-success" : s.balanceGapCents === null ? "text-muted-foreground" : "text-warning",
                    )}
                  >
                    {s.balanceGapCents === 0 ? <CheckCircle2 className="size-3.5" /> : s.balanceGapCents !== null ? <AlertTriangle className="size-3.5" /> : null}
                    {s.balanceGapCents === 0 ? t("gapOk") : s.balanceGapCents === null ? t("gapUnknown") : t("gap", { amount: money(s.balanceGapCents) })}
                  </p>
                  {canEdit && (
                    <Button variant="ghost" size="icon-sm" aria-label={t("delete")} title={t("delete")} onClick={() => setConfirming(s.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}

/** Reglas aprendidas al confirmar (se pueden olvidar). */
export function RulesPanel({ slug, rules, canEdit }: { slug: string; rules: BankRuleItem[]; canEdit: boolean }) {
  const t = useTranslations("banking.rules");
  const [pending, start] = useTransition();
  const remove = (id: string) =>
    start(async () => {
      const result = await deleteBankRule(slug, id);
      if (!result.ok) return void toast.error(result.error);
      toast.success(t("deleted"));
    });
  return (
    <Disclosure title={t("title")} count={rules.length}>
      {rules.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <p className="min-w-0 flex-1 truncate">
                {r.direction === "credit"
                  ? t("credit", { pattern: r.pattern, field: t(`fields.${r.field}`), client: r.clientName ?? "—" })
                  : t("debit", { pattern: r.pattern, field: t(`fields.${r.field}`), target: [r.vendorName, r.categoryName].filter(Boolean).join(" · ") || "—" })}
              </p>
              {canEdit && (
                <Button variant="ghost" size="sm" onClick={() => remove(r.id)} disabled={pending}>
                  {t("delete")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}
