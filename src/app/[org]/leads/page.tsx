import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FileText, Plus } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lastContactLabel } from "@/domain/crm/last-contact";
import { daysBetween } from "@/domain/dates/civil-date";
import { weightedPipeline } from "@/domain/metrics";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";
import { getCrmConfig } from "@/server/crm/config";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("leads"))("title") };
}

export default async function LeadsPage({ params }: PageProps<"/[org]/leads">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const supabase = await createClient();
  const [t, tPipeline, format, crm, deals, quotes] = await Promise.all([
    getTranslations("leads"),
    getTranslations("pipeline"),
    getFormatter(),
    getCrmConfig(org.id),
    fetchAll(
      (from, to) => supabase.from("deals_board").select("id, client_id, client_name, title, stage_id, stage_kind, est_one_off_cents, est_mrr_cents, probability_bps, next_action, next_action_on, last_contact_at, last_contact_direction").eq("org_id", org.id).eq("stage_kind", "open").order("next_action_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).range(from, to),
      "leads.openDeals",
    ),
    fetchAll(
      (from, to) => supabase.from("quotes_overview").select("id, deal_id, number, title, state, issued_on, valid_until, one_off_cents, monthly_cents, updated_at").eq("org_id", org.id).order("updated_at", { ascending: false }).range(from, to),
      "leads.quotes",
    ),
  ]);
  const basePath = `/${org.slug}`;
  // Los días se cuentan en fechas civiles de la zona de la org, como en el tablero.
  const today = nowInZone(org.timezone).date;
  const lastContact = (deal: { last_contact_at: string | null; last_contact_direction: "incoming" | "outgoing" | "internal" | null }) =>
    lastContactLabel(tPipeline, {
      lastContactDaysAgo: deal.last_contact_at ? Math.max(0, daysBetween(nowInZone(org.timezone, new Date(deal.last_contact_at)).date, today)) : null,
      lastContactDirection: deal.last_contact_direction,
    });
  const stageNames = new Map(crm.stages.map((stage) => [stage.id, stage.name]));
  const latestQuote = new Map<string, (typeof quotes)[number]>();
  for (const quote of quotes) if (quote.id && quote.deal_id && !latestQuote.has(quote.deal_id)) latestQuote.set(quote.deal_id, quote);
  const openDeals = deals.filter((deal): deal is typeof deal & { id: string; client_id: string; title: string; stage_id: string } => Boolean(deal.id && deal.client_id && deal.title && deal.stage_id));
  const forecast = weightedPipeline(deals.map((deal) => ({
    stageKind: "open" as const,
    estOneOffCents: deal.est_one_off_cents ?? 0,
    estMrrCents: deal.est_mrr_cents ?? 0,
    probabilityBps: deal.probability_bps ?? 0,
  })));
  const money = (cents: number) => format.number(cents / 100, { style: "currency", currency: org.currency });
  const quoteHref = (dealId: string, clientId: string) => `${basePath}/quotes/new?${new URLSearchParams({ deal: dealId, client: clientId }).toString()}`;
  const canEdit = hasRole(member.role, "partner");

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} actions={<><Button asChild variant="outline"><Link href={`${basePath}/pipeline`}>{t("board")}<ArrowUpRight data-icon="inline-end" /></Link></Button>{canEdit && <Button asChild><Link href={`${basePath}/pipeline?new=1`}><Plus data-icon="inline-start" />{t("new")}</Link></Button>}</>} />

      <section className="grid gap-3 sm:grid-cols-3" aria-label={t("summary")}>
        <Metric label={t("openDeals")} value={String(forecast.openDeals)} />
        <Metric label={t("weightedOneOff")} value={money(forecast.oneOffCents)} />
        <Metric label={t("weightedMrr")} value={`${money(forecast.mrrCents)} / ${t("month")}`} />
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="border-b"><CardTitle>{t("listTitle")}</CardTitle><CardDescription>{t("listDescription")}</CardDescription></CardHeader>
        {openDeals.length === 0 ? <CardContent className="py-12 text-center text-sm text-muted-foreground">{t("empty")}</CardContent> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>{t("opportunity")}</TableHead><TableHead>{t("stage")}</TableHead><TableHead>{t("nextAction")}</TableHead><TableHead>{t("lastContact")}</TableHead><TableHead className="text-right">{t("value")}</TableHead><TableHead>{t("proposal")}</TableHead><TableHead className="text-right">{t("open")}</TableHead></TableRow></TableHeader>
              <TableBody>{openDeals.map((deal) => {
                const quote = latestQuote.get(deal.id);
                return <TableRow key={deal.id}>
                  <TableCell className="min-w-52"><Link className="font-semibold hover:text-primary" href={`${basePath}/clients/${deal.client_id}`}>{deal.client_name}</Link><Link className="mt-0.5 block text-xs text-muted-foreground hover:text-primary" href={`${basePath}/pipeline?deal=${deal.id}`}>{deal.title}</Link></TableCell>
                  <TableCell>{stageNames.get(deal.stage_id) ?? "—"}<span className="ml-2 text-xs text-muted-foreground">{format.number((deal.probability_bps ?? 0) / 10_000, { style: "percent", maximumFractionDigits: 0 })}</span></TableCell>
                  <TableCell className="min-w-44">{deal.next_action ? <><span className="block text-sm">{deal.next_action}</span><span className="text-xs text-muted-foreground">{deal.next_action_on ?? t("noDate")}</span></> : <span className="text-sm text-muted-foreground">{t("noAction")}</span>}</TableCell>
                  <TableCell className={deal.last_contact_direction === "incoming" ? "text-sm font-semibold text-amber-600 dark:text-amber-400" : "text-sm text-muted-foreground"}>{lastContact(deal)}</TableCell>
                  <TableCell className="text-right tabular-nums"><span className="block">{money(deal.est_one_off_cents ?? 0)}</span>{(deal.est_mrr_cents ?? 0) > 0 && <span className="text-xs text-muted-foreground">{money(deal.est_mrr_cents ?? 0)} / {t("month")}</span>}</TableCell>
                  <TableCell>{quote ? <Link href={`${basePath}/quotes/${quote.id}`} className="inline-flex items-center gap-1 text-sm font-medium hover:text-primary"><FileText className="size-4" />{quote.number ?? quote.title ?? t("proposal")}<span className="text-xs text-muted-foreground">· {t(`quoteState.${quote.state ?? "draft"}`)}</span></Link> : canEdit ? <Button asChild variant="outline" size="sm"><Link href={quoteHref(deal.id, deal.client_id)}>{t("createProposal")}</Link></Button> : <span className="text-sm text-muted-foreground">{t("noProposal")}</span>}</TableCell>
                  <TableCell className="text-right"><Link aria-label={t("openOpportunity", { name: deal.title })} href={`${basePath}/pipeline?deal=${deal.id}`} className="inline-flex size-9 items-center justify-center rounded-full hover:bg-muted"><ArrowUpRight className="size-4" /></Link></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </div>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{t("historyHint")}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardHeader className="pb-1"><CardDescription className="font-semibold">{label}</CardDescription></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{value}</p></CardContent></Card>;
}
