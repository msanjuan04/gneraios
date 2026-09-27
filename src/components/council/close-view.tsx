"use client";

import { ArrowUpRight, CircleCheck, CircleDashed, Info, Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { acceptMonthlyClose } from "@/app/[org]/council/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ReportView } from "@/council/queries";
import type { EvidenceItem } from "@/council/types";
import { parseMoneyInput } from "@/domain/money";
import { cn } from "@/lib/utils";
import { EvidenceList } from "./evidence-list";
import { civil, eur, type MoneyFormat } from "./meta";

const BUCKETS = ["taxes", "cushion", "reinvestment", "partners"] as const;
type Bucket = (typeof BUCKETS)[number];
type Buckets = Record<Bucket, number>;

type Distribution = {
  available_cents: number;
  buckets: Buckets;
  cushion_target_cents: number;
  free_cash_cents: number;
  cash_limited: boolean;
  loss: boolean;
  partners: { name: string; member_id: string | null; share_bps: number; cents: number }[];
};

type CloseContent = {
  month?: string;
  headline?: string;
  summary?: string;
  highlights?: { text: string; evidence: string[] }[];
  distribution_comment?: string;
  distribution?: Distribution | null;
  figures?: EvidenceItem[];
  missing?: { what: string; needs: string[]; href?: string } | null;
  notes?: string[];
  policy?: { version: number | null; is_example: boolean };
};

const FIGURES = [
  "close.revenue.recurring",
  "close.revenue.usage",
  "close.revenue.one_off",
  "close.collected",
  "close.outstanding",
  "close.overdue",
  "close.mrr",
  "close.expenses",
  "close.profit",
  "close.cash",
  "close.taxes_due",
];

const toInput = (cents: number) => new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false }).format(cents / 100);

/** El cierre mensual: cifras del mes y la propuesta de reparto de la política, editable y aceptable. */
export function CloseView({ report, basePath, slug, money, canDecide }: { report: ReportView; basePath: string; slug: string; money: MoneyFormat; canDecide: boolean }) {
  const t = useTranslations("council.close");
  const format = useFormatter();
  const router = useRouter();
  const content = report.content as CloseContent;
  const distribution = content.distribution ?? null;
  const accepted = report.status === "accepted";
  const decided = (report.decision?.buckets ?? null) as Buckets | null;
  const [values, setValues] = useState<Record<Bucket, string>>(() =>
    Object.fromEntries(BUCKETS.map((b) => [b, toInput((decided ?? distribution?.buckets)?.[b] ?? 0)])) as Record<Bucket, string>,
  );
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(() => Object.fromEntries(BUCKETS.map((b) => [b, parseMoneyInput(values[b])])) as Record<Bucket, number | null>, [values]);
  const valid = BUCKETS.every((b) => parsed[b] !== null && parsed[b]! >= 0);
  const total = valid ? BUCKETS.reduce((sum, b) => sum + (parsed[b] ?? 0), 0) : null;
  const edited = distribution !== null && valid && BUCKETS.some((b) => parsed[b] !== distribution.buckets[b]);
  const balanced = distribution !== null && total === distribution.available_cents;
  const figures = FIGURES.flatMap((key) => (content.figures ?? []).filter((f) => f.key === key));
  const month = content.month ?? report.periodStart;

  const accept = () =>
    startTransition(async () => {
      if (!valid) return;
      const result = await acceptMonthlyClose(slug, report.id, { buckets: parsed as Buckets, note: note.trim() || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("acceptedToast"));
      router.refresh();
    });

  return (
    <article className="space-y-6">
      <header className="rounded-3xl border bg-card px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase first-letter:uppercase">{format.dateTime(civil(month), { month: "long", year: "numeric" })}</p>
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 px-2 text-[11px] font-semibold text-warning">
            <Scale aria-hidden className="size-3" />
            {t("professional")}
          </span>
          {accepted && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/40 px-2 text-[11px] font-semibold text-success">
              <CircleCheck aria-hidden className="size-3" />
              {t("acceptedBadge")}
            </span>
          )}
        </div>
        <h2 className="mt-2 text-2xl font-extrabold heading-tight md:text-3xl">{content.headline}</h2>
        <p className="mt-3 max-w-3xl text-muted-foreground">{content.summary}</p>
        <p className="mt-3 text-xs text-muted-foreground">{report.policyVersion === null ? t("policyExample") : t("policyVersion", { version: report.policyVersion })}</p>
      </header>

      {figures.length > 0 && (
        <section aria-label={t("figures")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {figures.map((f) => (
            <div key={f.key} className="rounded-2xl border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">{f.label}</p>
              <p className="mt-1 text-lg font-extrabold tabular">{f.display}</p>
            </div>
          ))}
        </section>
      )}

      {distribution ? (
        <section aria-labelledby="close-distribution" className="rounded-2xl border bg-card">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
            <div>
              <h3 id="close-distribution" className="font-bold">
                {t("distribution")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{t("distributionHint", { amount: eur(distribution.available_cents, money) })}</p>
            </div>
            {distribution.loss && <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">{t("loss")}</span>}
          </header>
          <ul className="divide-y">
            {BUCKETS.map((bucket) => (
              <li key={bucket} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t(`buckets.${bucket}.label`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`buckets.${bucket}.hint`)}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular">{t("proposed", { amount: eur(distribution.buckets[bucket], money) })}</span>
                {accepted || !canDecide ? (
                  <span className="w-32 text-right font-bold tabular">{eur((decided ?? distribution.buckets)[bucket], money)}</span>
                ) : (
                  <Input
                    value={values[bucket]}
                    onChange={(event) => setValues({ ...values, [bucket]: event.target.value })}
                    inputMode="decimal"
                    aria-label={t(`buckets.${bucket}.label`)}
                    aria-invalid={parsed[bucket] === null}
                    className="h-8 w-32 text-right tabular"
                  />
                )}
              </li>
            ))}
          </ul>
          {!accepted && distribution.partners.length > 0 && !edited && (
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">
              {t("partnersSplit", { split: distribution.partners.map((p) => `${p.name} ${eur(p.cents, money)}`).join(" · ") })}
            </p>
          )}
          {distribution.cash_limited && (
            <p className="flex items-start gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
              {t("cashLimited", { freeCash: eur(distribution.free_cash_cents, money), target: eur(distribution.cushion_target_cents, money) })}
            </p>
          )}
          {accepted ? (
            <footer className="border-t px-5 py-3 text-xs text-muted-foreground">
              {t("acceptedBy", {
                who: report.decidedBy ?? t("someone"),
                date: report.decidedAt ? format.dateTime(new Date(report.decidedAt), { day: "numeric", month: "short", year: "numeric" }) : "",
              })}
              {report.decision?.edited === true && ` · ${t("wasEdited")}`}
              {report.decisionNote && ` · «${report.decisionNote}»`}
            </footer>
          ) : (
            canDecide && (
              <footer className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
                <span className={cn("text-xs tabular", balanced ? "text-muted-foreground" : "font-semibold text-destructive")}>
                  {total === null ? t("invalidAmount") : balanced ? t("balanced", { total: eur(total, money) }) : t("unbalanced", { total: eur(total, money), available: eur(distribution.available_cents, money) })}
                </span>
                <Input value={note} onChange={(event) => setNote(event.target.value.replace(/[\n\r]/g, " "))} maxLength={300} placeholder={t("notePlaceholder")} aria-label={t("note")} className="h-8 min-w-48 flex-1" />
                <Button size="sm" onClick={accept} disabled={pending || !balanced}>
                  {edited ? t("acceptEdited") : t("accept")}
                </Button>
                <p className="w-full text-xs text-muted-foreground">{t("acceptHint")}</p>
              </footer>
            )
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed px-5 py-5 text-sm">
          <h3 className="flex items-center gap-2 font-bold">
            <CircleDashed aria-hidden className="size-4 text-warning" />
            {t("noDistribution")}
          </h3>
          {content.missing && (
            <>
              <p className="mt-1 text-muted-foreground">{content.missing.what}</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {content.missing.needs.map((need) => (
                  <li key={need}>{need}</li>
                ))}
              </ul>
              <Link href={`${basePath}${content.missing.href ?? "/finance"}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                {t("goToFinance")}
                <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            </>
          )}
        </section>
      )}

      {(content.distribution_comment || (content.highlights ?? []).length > 0) && (
        <section className="rounded-2xl border bg-card px-5 py-4 text-sm">
          <h3 className="font-bold">{t("comment")}</h3>
          {content.distribution_comment && <p className="mt-2 text-muted-foreground">{content.distribution_comment}</p>}
          {(content.highlights ?? []).length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
              {content.highlights!.map((h, i) => (
                <li key={i}>{h.text}</li>
              ))}
            </ul>
          )}
          <button type="button" className="mt-3 text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
            {showAll ? t("hideCalc") : t("seeCalc")}
          </button>
          {showAll && (
            <div className="mt-2">
              <EvidenceList items={report.evidence.length > 0 ? report.evidence : (content.figures ?? [])} basePath={basePath} />
            </div>
          )}
        </section>
      )}

      {(content.notes ?? []).length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {content.notes!.map((n, i) => (
            <li key={i} className="flex items-start gap-2">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {n}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
