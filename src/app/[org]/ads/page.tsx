import { ArrowUpRight, CircleAlert, Eye, MousePointerClick, Megaphone, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { createClient } from "@/lib/supabase/server";
import { getOpenAiAdsReport, isOpenAiAdsConfigured, type AdsReport } from "@/server/ads/openai";
import { getOrgContext, hasRole } from "@/server/session";
import { saveAdsCampaignClient } from "./actions";

export const metadata: Metadata = { title: "Ads · GNERAI OS" };

function displayNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function displayMoney(value: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Eye }) {
  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</div>
      <p className="mt-3 text-2xl font-extrabold tabular heading-tight sm:text-3xl">{value}</p>
    </div>
  );
}

type ClientOption = { id: string; display_name: string };
type CampaignLink = { campaign_id: string; client_id: string; visible_to_client: boolean };

function CampaignAssignment({ campaign, slug, clients, link, canEdit }: { campaign: AdsReport["campaigns"][number]; slug: string; clients: ClientOption[]; link?: CampaignLink; canEdit: boolean }) {
  if (!canEdit) return <span className="text-xs text-muted-foreground">{clients.find((client) => client.id === link?.client_id)?.display_name ?? "Sin asignar"}{link?.visible_to_client ? " · visible en portal" : ""}</span>;
  return (
    <form action={saveAdsCampaignClient.bind(null, slug)} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="campaign_id" value={campaign.id} />
      <select name="client_id" defaultValue={link?.client_id ?? ""} aria-label={`Cliente de ${campaign.name}`} className="min-h-10 min-w-0 max-w-full flex-1 rounded-lg border bg-background px-2 text-sm sm:flex-none">
        <option value="">Sin asignar</option>
        {clients.map((client) => <option key={client.id} value={client.id}>{client.display_name}</option>)}
      </select>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="visible" defaultChecked={link?.visible_to_client ?? false} className="size-4" /> Portal</label>
      <button type="submit" className="min-h-10 rounded-lg border px-3 text-sm font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Guardar</button>
    </form>
  );
}

function Report({ report, locale, slug, clients, links, canEdit }: { report: AdsReport; locale: string; slug: string; clients: ClientOption[]; links: CampaignLink[]; canEdit: boolean }) {
  const totals = report.campaigns.reduce(
    (sum, item) => ({ impressions: sum.impressions + item.impressions, clicks: sum.clicks + item.clicks, spend: sum.spend + item.spend }),
    { impressions: 0, clicks: 0, spend: 0 },
  );
  const rows = [...report.campaigns].sort((a, b) => b.spend - a.spend);
  return (
    <>
      <div className="mb-5 rounded-2xl border bg-card px-5 py-4">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Cuenta conectada · ChatGPT Ads</p>
        <p className="mt-1 text-lg font-bold">{report.account.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">Datos medidos del {report.from} al {report.to} · {report.account.timezone}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Impresiones" value={displayNumber(totals.impressions, locale)} icon={Eye} />
        <Metric label="Clics" value={displayNumber(totals.clicks, locale)} icon={MousePointerClick} />
        <Metric label="Inversión" value={displayMoney(totals.spend, report.account.currency, locale)} icon={Wallet} />
        <Metric label="CTR" value={totals.impressions ? `${new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(totals.clicks / totals.impressions)}` : "—"} icon={Megaphone} />
      </div>
      <section className="mt-6 overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-5 py-4">
          <h3 className="text-lg font-bold">Campañas</h3>
          <p className="text-sm text-muted-foreground">Rendimiento por campaña; incluye campañas sin impresiones.</p>
        </div>
        {rows.length ? (
          <>
          <ul className="divide-y md:hidden">
            {rows.map((campaign) => {
              const link = links.find((item) => item.campaign_id === campaign.id);
              return <li key={campaign.id} className="space-y-4 p-4">
                <div className="min-w-0"><p className="break-words font-semibold">{campaign.name}</p><p className="break-all text-xs text-muted-foreground">{campaign.id}</p></div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Impresiones</dt><dd className="font-semibold tabular-nums">{displayNumber(campaign.impressions, locale)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Clics</dt><dd className="font-semibold tabular-nums">{displayNumber(campaign.clicks, locale)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">CTR</dt><dd className="font-semibold tabular-nums">{campaign.ctr === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(campaign.ctr)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Inversión</dt><dd className="font-semibold tabular-nums">{displayMoney(campaign.spend, report.account.currency, locale)}</dd></div>
                </dl>
                <div><p className="mb-2 text-xs font-semibold text-muted-foreground">Cliente / portal</p><CampaignAssignment campaign={campaign} slug={slug} clients={clients} link={link} canEdit={canEdit} /></div>
              </li>;
            })}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-muted/35 text-left text-xs text-muted-foreground uppercase">
                <tr><th className="px-5 py-3">Campaña</th><th className="px-5 py-3 text-right">Impresiones</th><th className="px-5 py-3 text-right">Clics</th><th className="px-5 py-3 text-right">CTR</th><th className="px-5 py-3 text-right">Inversión</th><th className="px-5 py-3">Cliente / portal</th></tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((campaign) => (
                  <tr key={campaign.id}>
                    <td className="px-5 py-4"><p className="font-semibold">{campaign.name}</p><p className="text-xs text-muted-foreground">{campaign.id}</p></td>
                    <td className="px-5 py-4 text-right tabular">{displayNumber(campaign.impressions, locale)}</td>
                    <td className="px-5 py-4 text-right tabular">{displayNumber(campaign.clicks, locale)}</td>
                    <td className="px-5 py-4 text-right tabular">{campaign.ctr === null ? "—" : new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(campaign.ctr)}</td>
                    <td className="px-5 py-4 text-right font-semibold tabular">{displayMoney(campaign.spend, report.account.currency, locale)}</td>
                    <td className="px-5 py-4">
                      <CampaignAssignment campaign={campaign} slug={slug} clients={clients} link={links.find((link) => link.campaign_id === campaign.id)} canEdit={canEdit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : <p className="px-5 py-8 text-sm text-muted-foreground">Sin campañas en esta cuenta.</p>}
      </section>
      <p className="mt-4 text-xs text-muted-foreground">Inversión publicitaria, no facturación de GNERAI. Métricas de la API oficial; pueden ajustarse por procesamiento de datos.</p>
    </>
  );
}

export default async function AdsPage({ params, searchParams }: PageProps<"/[org]/ads">) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, orgs, member } = await getOrgContext(slug);
  const bound = process.env.OPENAI_ADS_ORG_SLUG;
  const allowed = bound ? bound === org.slug : orgs.length === 1;
  let report: AdsReport | null = null;
  let error = false;
  if (allowed && isOpenAiAdsConfigured()) {
    try { report = await getOpenAiAdsReport(); } catch { error = true; }
  }
  let clients: ClientOption[] = [];
  let links: CampaignLink[] = [];
  if (report) {
    const db = await createClient();
    const [clientResult, linkResult] = await Promise.all([
      db.from("clients").select("id, display_name").eq("org_id", org.id).is("archived_at", null).order("display_name"),
      db.from("ads_client_campaigns").select("campaign_id, client_id, visible_to_client").eq("org_id", org.id).eq("ad_account_id", report.account.id),
    ]);
    if (clientResult.error || linkResult.error) error = true;
    else { clients = clientResult.data ?? []; links = linkResult.data ?? []; }
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <PageHeader title="Ads" description="Operación interna: rendimiento medido, inversión y campañas de la cuenta conectada." />
      {query.ads_error && <p role="alert" className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">No se pudo guardar el vínculo de la campaña. Comprueba cliente, permisos y conexión.</p>}
      {query.ads_saved && <p role="status" className="mb-4 rounded-xl border border-success/30 bg-success/5 p-3 text-sm">Vínculo de campaña guardado.</p>}
      {!allowed ? (
        <div role="status" className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Asigna <code>OPENAI_ADS_ORG_SLUG</code> a esta organización antes de mostrar datos de la cuenta publicitaria.</div>
      ) : !isOpenAiAdsConfigured() ? (
        <div role="status" className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Añade <code>OPENAI_ADS_API_KEY</code> al entorno del servidor para consultar ChatGPT Ads.</div>
      ) : error ? (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm"><CircleAlert className="size-5 shrink-0 text-destructive" aria-hidden />No se pudieron cargar datos de ChatGPT Ads. Revisa acceso de la clave y vuelve a cargar.</div>
      ) : report && <Report report={report} locale={org.locale} slug={org.slug} clients={clients} links={links} canEdit={hasRole(member.role, "partner")} />}
      <div className="mt-6 rounded-2xl border bg-card p-5">
        <h3 className="font-bold">Vista para clientes</h3>
        <p className="mt-1 text-sm text-muted-foreground">El portal de cada cliente tiene su propia sección Ads, apagada por defecto. Solo mostraremos campañas vinculadas expresamente a ese cliente; nunca la cuenta completa ni otras campañas.</p>
        <Link href={`/${org.slug}/clients`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">Abrir clientes <ArrowUpRight className="size-4" aria-hidden /></Link>
      </div>
    </div>
  );
}
