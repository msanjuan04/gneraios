import Link from "next/link";
import { ArrowUpRight, CalendarClock, ExternalLink, FileText, Globe, Mail, MessageSquare, Phone, Plus, Reply, Users } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { LeadNextStep } from "@/components/crm/lead-next-step";
import { LeadTemperaturePicker } from "@/components/crm/lead-temperature";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { LeadDetail as LeadData, LeadMessage } from "@/server/crm/lead";
import type { LeadMailSignal } from "@/server/crm/mail-signals";

/**
 * La ficha de un lead: con quién hablamos, qué nos hemos dicho, qué le hemos propuesto y qué toca
 * ahora. Sin facturación, proyectos ni webs: de eso no hay nada todavía, y enseñar huecos vacíos
 * solo hace ruido. En cuanto firma, su ficha pasa a ser la de cliente, con todo.
 */
export async function LeadDetailView({
  lead,
  slug,
  basePath,
  canEdit,
  signal,
}: {
  lead: LeadData;
  slug: string;
  basePath: string;
  canEdit: boolean;
  /** Lo que dice su último correo, si lo escribieron ellos (null si la pelota no es nuestra). */
  signal: LeadMailSignal | null;
}) {
  const t = await getTranslations("leads.detail");
  const tKind = await getTranslations("crm.activityKind");
  const format = await getFormatter();
  const open = lead.deals.filter((deal) => deal.stageKind === "open");
  const main = open[0] ?? lead.deals[0];
  // A quién se escribe o se llama: el contacto principal, y si no hay, el primero que tenga algo.
  const contact = lead.contacts.find((item) => item.isPrimary && (item.email || item.phone)) ?? lead.contacts.find((item) => item.email || item.phone);
  const lastQuote = lead.quotes[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={lead.displayName}
        description={[lead.sector, lead.city].filter(Boolean).join(" · ") || t("noSector")}
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Lo que se hace de verdad desde aquí: escribirle, llamarle y leer la conversación. */}
            {contact?.email && (
              <Button asChild variant="outline">
                <a href={`mailto:${contact.email}`}>
                  <Mail data-icon="inline-start" />
                  {t("writeEmail")}
                </a>
              </Button>
            )}
            {contact?.phone && (
              <Button asChild variant="outline">
                <a href={`tel:${contact.phone}`}>
                  <Phone data-icon="inline-start" />
                  {t("call")}
                </a>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={`${basePath}/leads/${lead.id}/mail`}>
                <MessageSquare data-icon="inline-start" />
                {t("allMessages", { count: lead.mail.total })}
              </Link>
            </Button>
            {main && (
              <Button asChild variant="outline">
                <Link href={`${basePath}/pipeline?deal=${main.id}`}>
                  {t("openInPipeline")} <ArrowUpRight data-icon="inline-end" />
                </Link>
              </Button>
            )}
            {canEdit && main && (
              <Button asChild>
                <Link href={`${basePath}/quotes/new?client=${lead.id}&deal=${main.id}`}>
                  <Plus data-icon="inline-start" />
                  {t("newQuote")}
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {/* Lo primero: en qué punto está y qué toca hacer. */}
      {main && (
        <Card className={main.nextActionOn ? "border-primary/30" : undefined}>
          <CardContent className="flex flex-wrap items-start justify-between gap-5 py-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{main.stageName}</p>
              <p className="mt-1 text-lg font-bold">{main.title}</p>
              {main.nextAction ? (
                <p className="mt-2 flex items-start gap-1.5 text-sm">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>
                    {main.nextActionOn && (
                      <span className="font-semibold tabular-nums">
                        {format.dateTime(new Date(`${main.nextActionOn}T12:00:00Z`), { day: "numeric", month: "long" })} ·{" "}
                      </span>
                    )}
                    {main.nextAction}
                  </span>
                </p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">{t("noNextAction")}</p>
              )}
            </div>
            <div className="flex gap-6 text-right">
              {main.estOneOffCents > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">{t("oneOff")}</p>
                  <p className="text-xl font-bold tabular-nums">{formatMoney(main.estOneOffCents, { wholeUnits: true })}</p>
                </div>
              )}
              {main.estMrrCents > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground">{t("monthly")}</p>
                  <p className="text-xl font-bold tabular-nums">{formatMoney(main.estMrrCents, { wholeUnits: true })}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">{t("probability")}</p>
                <p className="text-xl font-bold tabular-nums">{Math.round(main.probabilityBps / 100)} %</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {signal && (
        <LeadNextStep
          signal={signal}
          slug={slug}
          basePath={basePath}
          clientId={lead.id}
          dealId={main?.id ?? null}
          canEdit={canEdit}
        />
      )}

      {/* Qué quiere y en qué punto está: lo que se lee antes de decidir si toca algo. */}
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("wants")}</p>
              <p className="mt-1 text-balance font-semibold">{main?.title ?? t("noDeal")}</p>
              {lastQuote && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("lastProposal", {
                    title: lastQuote.number ?? lastQuote.title,
                    state: t(`state.${lastQuote.state}`),
                  })}
                </p>
              )}
              {lead.notes && <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{lead.notes}</p>}
            </div>
            {canEdit && main && <LeadTemperaturePicker slug={slug} dealId={main.id} value={main.temperature} />}
          </div>
          {lead.mail.awaitingOurReply && (
            <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
              <Reply className="size-4 shrink-0" aria-hidden />
              {t("needsReply")}
              <Link href={`${basePath}/leads/${lead.id}/mail`} className="ml-auto underline">
                {t("answerNow")}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* La conversación: lo que nos hemos dicho, lo último arriba. */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="size-5 text-primary" aria-hidden />
              {t("conversation")}
            </CardTitle>
            <CardDescription>{t("conversationHint")}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {lead.messages.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("noMessages")}</p>
            ) : (
              <ul className="divide-y">
                {lead.messages.map((message) => (
                  <li key={message.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="flex min-w-0 items-center gap-2 font-semibold">
                        <Direction message={message} />
                        <span className="min-w-0 truncate">{message.title}</span>
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {format.dateTime(new Date(message.occurredAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {tKind(message.kind)}
                      {message.counterpart && ` · ${message.counterpart}`}
                      {message.memberName && ` · ${message.memberName}`}
                    </p>
                    {message.body && <p className="mt-2 text-sm whitespace-pre-line text-muted-foreground">{message.body}</p>}
                    {message.externalReference?.startsWith("http") && (
                      <a
                        href={message.externalReference}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        {message.externalReference.replace(/^https?:\/\//, "")}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          {/* Con quién se habla. */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4 text-muted-foreground" aria-hidden />
                {t("contacts")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {lead.contacts.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">{t("noContacts")}</p>
              ) : (
                <ul className="divide-y">
                  {lead.contacts.map((contact) => (
                    <li key={contact.id} className="px-5 py-3">
                      <p className="font-semibold">
                        {contact.fullName}
                        {contact.isPrimary && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("primary")}</span>}
                      </p>
                      {contact.role && <p className="text-xs text-muted-foreground">{contact.role}</p>}
                      <div className="mt-1 flex flex-col gap-0.5 text-sm">
                        {contact.email && (
                          <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                            <Mail className="size-3.5" aria-hidden />
                            {contact.email}
                          </a>
                        )}
                        {contact.phone && (
                          <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                            <Phone className="size-3.5" aria-hidden />
                            {contact.phone}
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {lead.website && (
                <div className="border-t px-5 py-3">
                  <a
                    href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <Globe className="size-3.5" aria-hidden />
                    {lead.website.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lo que se le ha propuesto. */}
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
                {t("quotes")}
              </CardTitle>
              <CardDescription>{t("quotesHint")}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {lead.quotes.length === 0 ? (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">{t("noQuotes")}</p>
              ) : (
                <ul className="divide-y">
                  {lead.quotes.map((quote) => (
                    <li key={quote.id} className="px-5 py-3">
                      <Link href={`${basePath}/quotes/${quote.id}`} className="font-semibold hover:text-primary">
                        {quote.number ?? quote.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(`state.${quote.state}`)}
                        {quote.issuedOn && ` · ${format.dateTime(new Date(`${quote.issuedOn}T12:00:00Z`), { day: "numeric", month: "short" })}`}
                      </p>
                      <p className="mt-1 text-sm font-semibold tabular-nums">
                        {quote.oneOffCents > 0 && formatMoney(quote.oneOffCents, { wholeUnits: true })}
                        {quote.oneOffCents > 0 && quote.monthlyCents > 0 && " · "}
                        {quote.monthlyCents > 0 && `${formatMoney(quote.monthlyCents, { wholeUnits: true })}/${t("month")}`}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {quote.landingUrl ? (
                          <a href={quote.landingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <Globe className="size-3" aria-hidden />
                            {t("landing")}
                          </a>
                        ) : (
                          <span className={cn("text-muted-foreground", quote.hasPdf && "text-muted-foreground")}>{quote.hasPdf ? t("sentAsPdf") : t("notSentYet")}</span>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {lead.notes && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("notes")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line text-muted-foreground">{lead.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Una flecha según de quién salió el mensaje: nuestro, suyo o una nota interna. */
function Direction({ message }: { message: LeadMessage }) {
  if (message.kind !== "email" || !message.direction) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        message.direction === "incoming" ? "bg-warning/15 text-warning" : message.direction === "outgoing" ? "bg-primary/12 text-primary" : "bg-secondary text-muted-foreground",
      )}
    >
      {message.direction === "incoming" ? "←" : message.direction === "outgoing" ? "→" : "·"}
    </span>
  );
}
