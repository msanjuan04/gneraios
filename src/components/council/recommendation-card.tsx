"use client";

import { Check, ChevronDown, CircleDashed, Clock3, ListChecks, RotateCcw, Scale, Swords, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { decideRecommendation } from "@/app/[org]/council/actions";
import type { DecisionInput } from "@/app/[org]/council/schema";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecommendationView } from "@/council/queries";
import { addDays } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import { EvidenceList } from "./evidence-list";
import { AGENT_ICONS, civil, eur, type MoneyFormat } from "./meta";

const URGENCY_TONE: Record<string, string> = {
  hoy: "border-destructive/30 bg-destructive/10 text-destructive",
  esta_semana: "border-warning/30 bg-warning/10 text-warning",
  este_mes: "border-border bg-secondary text-muted-foreground",
};

/** Una recomendación del consejo: qué, cuánto, con qué confianza y urgencia, y qué decidís. */
export function RecommendationCard({
  rec,
  slug,
  basePath,
  money,
  canDecide,
  today,
  highlight = false,
}: {
  rec: RecommendationView;
  slug: string;
  basePath: string;
  money: MoneyFormat;
  canDecide: boolean;
  today: string;
  highlight?: boolean;
}) {
  const t = useTranslations("council.card");
  const tAgents = useTranslations("council.agents");
  const tLabels = useTranslations("council");
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(highlight);
  const [mode, setMode] = useState<null | "accept" | "discard" | "postpone">(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const Icon = AGENT_ICONS[rec.agent];
  const postponedAndBack = rec.status === "pospuesta" && rec.postponedUntil !== null && rec.postponedUntil <= today;
  const actionable = rec.status === "nueva" || postponedAndBack;

  const decide = (input: DecisionInput, done: string) =>
    startTransition(async () => {
      const result = await decideRecommendation(slug, rec.id, input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(done);
      setMode(null);
      setNote("");
      router.refresh();
    });

  const day = (date: string) => format.dateTime(civil(date), { day: "numeric", month: "short" });

  return (
    <article id={`rec-${rec.id}`} className={cn("rounded-2xl border bg-card text-sm", highlight && "border-primary/50 shadow-[0_0_0_1px_rgb(46_128_255/0.25)]")}>
      <header className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Icon aria-hidden className="size-3.5 text-primary" />
          {tAgents(`${rec.agent}.name`)}
        </span>
        <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-semibold", URGENCY_TONE[rec.urgency])}>{tLabels(`urgency.${rec.urgency}`)}</span>
        <Badge variant="outline" className="text-[11px]">
          {t("confidence", { level: tLabels(`confidence.${rec.confidence}`) })}
        </Badge>
        {rec.kind !== "decision" && <Badge variant="secondary" className="text-[11px]">{tLabels(`kind.${rec.kind}`)}</Badge>}
        {rec.requiresProfessionalReview && (
          <Badge variant="outline" className="border-warning/40 text-[11px] text-warning">
            <Scale data-icon="inline-start" />
            {t("professional")}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{format.dateTime(new Date(rec.createdAt), { day: "numeric", month: "short" })}</span>
      </header>

      <div className="flex flex-wrap items-start gap-4 px-5 pt-2">
        <div className="min-w-0 flex-1 basis-72">
          <h3 className="text-base leading-snug font-bold">{rec.title}</h3>
          <p className="mt-1 text-muted-foreground">{rec.summary}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">{t("impact")}</p>
          <p className="text-xl font-extrabold tabular heading-tight">{rec.impactCents === null ? t("noImpact") : eur(rec.impactCents, money)}</p>
        </div>
      </div>

      {(rec.status !== "nueva" || rec.decisionNote) && (
        <p className="mx-5 mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{tLabels(`status.${rec.status}`)}</span>
          {rec.status === "pospuesta" && rec.postponedUntil && <span>{postponedAndBack ? t("backToday") : t("until", { date: day(rec.postponedUntil) })}</span>}
          {rec.decidedAt && <span>{t("decided", { who: rec.decidedBy ?? t("someone"), date: day(rec.decidedAt) })}</span>}
          {rec.decisionNote && <span className="italic">«{rec.decisionNote}»</span>}
          {rec.status === "aceptada" && rec.tasks.total > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks aria-hidden className="size-3.5" />
              {t("tasksProgress", { done: rec.tasks.done, total: rec.tasks.total })}
            </span>
          )}
        </p>
      )}

      <footer className="flex flex-wrap items-center gap-2 px-5 py-4">
        {canDecide && actionable && (
          <>
            <Button size="sm" onClick={() => setMode(mode === "accept" ? null : "accept")} disabled={pending}>
              <Check data-icon="inline-start" />
              {t("accept")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode(mode === "postpone" ? null : "postpone")} disabled={pending}>
              <Clock3 data-icon="inline-start" />
              {t("postpone")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(mode === "discard" ? null : "discard")} disabled={pending}>
              <X data-icon="inline-start" />
              {t("discard")}
            </Button>
          </>
        )}
        {canDecide && rec.status === "aceptada" && (
          <Button size="sm" variant="outline" onClick={() => decide({ status: "hecha" }, t("doneToast"))} disabled={pending}>
            <Check data-icon="inline-start" />
            {t("markDone")}
          </Button>
        )}
        {canDecide && rec.status === "pospuesta" && !postponedAndBack && (
          <Button size="sm" variant="outline" onClick={() => decide({ status: "nueva" }, t("reopenedToast"))} disabled={pending}>
            <RotateCcw data-icon="inline-start" />
            {t("bringBack")}
          </Button>
        )}
        {canDecide && rec.status === "descartada" && (
          <Button size="sm" variant="ghost" onClick={() => decide({ status: "nueva" }, t("reopenedToast"))} disabled={pending}>
            <RotateCcw data-icon="inline-start" />
            {t("reopen")}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t("hideCalc") : t("seeCalc")}
          <ChevronDown data-icon="inline-end" className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </footer>

      {mode === "accept" && (
        <div className="px-5 pb-4">
          <InlineConfirm
            icon={<ListChecks className="text-primary" />}
            confirmLabel={t("acceptConfirm")}
            onConfirm={() => decide({ status: "aceptada" }, t("acceptedToast"))}
            onCancel={() => setMode(null)}
            pending={pending}
          >
            <p className="font-semibold">{t("acceptTitle", { count: Math.max(1, rec.proposedActions.length) })}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {(rec.proposedActions.length > 0 ? rec.proposedActions : [{ title: rec.title, due_in_days: null }]).map((a, i) => (
                <li key={i}>
                  {a.title}
                  {a.due_in_days !== null && <span> · {t("dueIn", { days: a.due_in_days })}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{t("acceptHint")}</p>
          </InlineConfirm>
        </div>
      )}

      {mode === "postpone" && (
        <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
          <span className="text-xs text-muted-foreground">{t("postponeUntil")}</span>
          {([7, 14, 30] as const).map((days) => (
            <Button key={days} size="xs" variant="secondary" disabled={pending} onClick={() => decide({ status: "pospuesta", postponedUntil: addDays(today, days) }, t("postponedToast", { date: day(addDays(today, days)) }))}>
              {t(`postpone${days}`)}
            </Button>
          ))}
        </div>
      )}

      {mode === "discard" && (
        <form
          className="flex flex-wrap items-center gap-2 px-5 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            decide({ status: "descartada", note }, t("discardedToast"));
          }}
        >
          <Input
            autoFocus
            value={note}
            maxLength={300}
            onChange={(event) => setNote(event.target.value.replace(/[\n\r]/g, " "))}
            placeholder={t("discardPlaceholder")}
            aria-label={t("discardReason")}
            className="h-8 min-w-60 flex-1"
          />
          <Button type="submit" size="sm" variant="destructive" disabled={pending || note.trim().length < 3}>
            {t("discardConfirm")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)} disabled={pending}>
            {t("cancel")}
          </Button>
          <p className="w-full text-xs text-muted-foreground">{t("discardHint")}</p>
        </form>
      )}

      {open && (
        <div className="space-y-4 border-t px-5 py-4">
          <section>
            <h4 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{t("reasoning")}</h4>
            <p className="mt-1 whitespace-pre-line">{rec.reasoning}</p>
          </section>
          <section>
            <h4 className="mb-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">{t("evidence")}</h4>
            <EvidenceList items={rec.evidence} basePath={basePath} />
          </section>
          {rec.missingData.length > 0 && (
            <section>
              <h4 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{t("missing")}</h4>
              <ul className="mt-1 space-y-1">
                {rec.missingData.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-muted-foreground">
                    <CircleDashed aria-hidden className="size-3.5 shrink-0 text-warning" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {rec.risks && (
            <section>
              <h4 className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{t("risks")}</h4>
              <p className="mt-1 text-muted-foreground">{rec.risks}</p>
            </section>
          )}
          {rec.challenge && (
            <section className="rounded-xl border border-dashed px-3 py-3">
              <h4 className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                <Swords aria-hidden className="size-3.5" />
                {t("challenge")}
              </h4>
              {rec.challenge.status === "revisada" ? (
                <div className="mt-2 space-y-2">
                  <p className="font-semibold">{t(`verdict.${rec.challenge.verdict ?? "publicar"}`)}</p>
                  {rec.challenge.weakAssumptions && rec.challenge.weakAssumptions.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {rec.challenge.weakAssumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  )}
                  {rec.challenge.pessimisticScenario && (
                    <p className="text-muted-foreground">
                      <span className="font-semibold text-foreground">{t("pessimistic")}: </span>
                      {rec.challenge.pessimisticScenario}
                    </p>
                  )}
                  {rec.challenge.evidence && rec.challenge.evidence.length > 0 && <EvidenceList items={rec.challenge.evidence} basePath={basePath} />}
                </div>
              ) : (
                <p className="mt-1 text-muted-foreground">{t("notChallenged", { reason: rec.challenge.reason ?? "" })}</p>
              )}
            </section>
          )}
          <p className="text-xs text-muted-foreground">
            {rec.policyVersion === null ? t("policyExample") : t("policyVersion", { version: rec.policyVersion })}
            {rec.requiresProfessionalReview && ` · ${t("professionalHint")}`}
          </p>
        </div>
      )}
    </article>
  );
}
