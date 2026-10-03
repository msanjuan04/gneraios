import { CalendarClock, FileText, Mail, MessageSquare, Reply } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { LeadTemperatureBadge } from "@/components/crm/lead-temperature";
import { leadInitials, type LeadSummary } from "@/domain/crm";
import { cn } from "@/lib/utils";

/**
 * Las carpetas de leads: una por oportunidad, con las iniciales grandes para reconocerla de un
 * vistazo y, debajo, lo justo para decidir si toca entrar. Dentro está el resumen, el contacto y
 * toda la conversación.
 */
export async function LeadFolders({
  leads,
  basePath,
  money,
}: {
  leads: LeadSummary[];
  basePath: string;
  money: (cents: number) => string;
}) {
  const t = await getTranslations("leads");
  const format = await getFormatter();

  if (leads.length === 0) {
    return <p className="rounded-xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {leads.map((lead) => (
        <li key={lead.dealId} className="min-w-0">
          <Link
            href={`${basePath}/leads/${lead.clientId}`}
            className={cn(
              "flex h-full min-w-0 flex-col gap-3 rounded-2xl border bg-card/60 p-4 transition-colors hover:border-primary/40 hover:bg-card",
              lead.awaitingOurReply && "border-amber-500/50",
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              {/* Las iniciales: la «carpeta» que se reconoce sin leer. */}
              <span
                aria-hidden
                className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/15 text-lg font-extrabold text-primary"
              >
                {leadInitials(lead.clientName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{lead.clientName}</p>
                <p className="truncate text-sm text-muted-foreground">{lead.title}</p>
              </div>
              {lead.temperature && (
                <span className="shrink-0">
                  <LeadTemperatureBadge value={lead.temperature} label={t(`temperature.${lead.temperature}`)} />
                </span>
              )}
            </div>

            <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-lg font-bold tabular-nums" title={lead.estimated ? t("estimatedHint") : undefined}>
                {lead.estimated && <span aria-label={t("estimated")}>≈ </span>}
                {money(lead.estOneOffCents)}
              </p>
              {lead.estMrrCents > 0 && (
                <p className="text-sm text-muted-foreground tabular-nums">{t("perMonth", { amount: money(lead.estMrrCents) })}</p>
              )}
              <p className="ml-auto max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{lead.stageName}</p>
            </div>

            {lead.awaitingOurReply ? (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
                <Reply className="size-4 shrink-0" aria-hidden />
                {lead.lastContactDaysAgo === null
                  ? t("needsReply")
                  : t("needsReplyDays", { count: lead.lastContactDaysAgo })}
              </p>
            ) : lead.nextAction ? (
              <p className="flex items-start gap-1.5 text-sm">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  {lead.nextActionOn && (
                    <span className="font-semibold tabular-nums">
                      {format.dateTime(new Date(`${lead.nextActionOn}T12:00:00Z`), { day: "numeric", month: "short" })} ·{" "}
                    </span>
                  )}
                  {lead.nextAction}
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noAction")}</p>
            )}

            <div className="mt-auto flex items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3.5" aria-hidden />
                {t("quoteCount", { count: lead.quotes })}
              </span>
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3.5" aria-hidden />
                {t("mailCount", { count: lead.messages })}
              </span>
              {lead.lastContactDaysAgo !== null && !lead.awaitingOurReply && (
                <span className="inline-flex items-center gap-1">
                  <MessageSquare className="size-3.5" aria-hidden />
                  {t("contactDays", { count: lead.lastContactDaysAgo })}
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
