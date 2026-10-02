import { CircleAlert, Eye, Link2, Megaphone, MousePointerClick, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArchiveAccountButton, RefreshAccountButton } from "@/components/ads/account-actions";
import { AdsToolbar } from "@/components/ads/ads-toolbar";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  AD_TYPE_LABEL,
  AD_TYPE_PROVIDER,
  AD_TYPES,
  ADS_PROVIDERS,
  type AdsCampaign,
  type AdsProvider,
  type AdType,
  adsTotals,
  campaignsForAdType,
} from "@/domain/ads/types";
import { createClient } from "@/lib/supabase/server";
import { type AdsAccountView, type AdsSnapshot, listAdsAccounts, loadAdsSnapshot } from "@/server/ads/accounts";
import { getOrgContext, hasRole } from "@/server/session";
import { importEnvOpenAiAccount, saveAdsCampaignClient } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ads"))("title") };
}

const param = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);
const isProvider = (value: string | undefined): value is AdsProvider => (ADS_PROVIDERS as readonly string[]).includes(value ?? "");

type ClientOption = { id: string; name: string };
type CampaignLink = { ad_account_id: string; campaign_id: string; client_id: string; visible_to_client: boolean };

export default async function AdsPage({ params, searchParams }: PageProps<"/[org]/ads">) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  const [t, format, accounts, clientsResult] = await Promise.all([
    getTranslations("ads"),
    getFormatter(),
    listAdsAccounts(org.id),
    (await createClient()).from("clients").select("id, display_name").eq("org_id", org.id).is("archived_at", null).order("display_name"),
  ]);
  if (clientsResult.error) throw clientsResult.error;
  const clients: ClientOption[] = (clientsResult.data ?? []).map((c) => ({ id: c.id, name: c.display_name }));
  const canEdit = hasRole(member.role, "partner");
  const basePath = `/${org.slug}`;

  // De quién son las cuentas que se enseñan: la agencia o un cliente (arriba a la derecha).
  const requestedOwner = param(query.owner);
  const owner = requestedOwner && clients.some((c) => c.id === requestedOwner) ? requestedOwner : "agency";
  const ownerName = owner === "agency" ? t("owner.agency") : (clients.find((c) => c.id === owner)?.name ?? "");
  const ownerAccounts = accounts.filter((account) => (owner === "agency" ? account.owner_client_id === null : account.owner_client_id === owner));
  const presetProvider = param(query.add);

  // Una foto por cuenta conectada (Google Ads y YouTube Ads comparten la misma); la caché evita pedirla dos veces.
  const snapshots = new Map<string, AdsSnapshot>();
  await Promise.all(
    ownerAccounts
      .filter((account) => account.connected)
      .map(async (account) => snapshots.set(account.id, await loadAdsSnapshot(account, { timezone: org.timezone }))),
  );
  let links: CampaignLink[] = [];
  if (ownerAccounts.length) {
    const db = await createClient();
    const { data, error } = await db
      .from("ads_client_campaigns")
      .select("ad_account_id, campaign_id, client_id, visible_to_client")
      .eq("org_id", org.id)
      .in("ad_account_id", ownerAccounts.map((account) => account.id));
    if (error) throw error;
    links = data ?? [];
  }

  // Inversión total del dueño en el periodo, moneda a moneda (nunca se mezclan).
  const spendByCurrency = new Map<string, number>();
  for (const account of ownerAccounts) {
    const snapshot = snapshots.get(account.id);
    if (!snapshot) continue;
    const currency = account.currency ?? org.currency;
    spendByCurrency.set(currency, (spendByCurrency.get(currency) ?? 0) + adsTotals(snapshot.campaigns).spend_cents);
  }

  const envKeyOffer = canEdit && Boolean(process.env.OPENAI_ADS_API_KEY?.trim()) && !accounts.some((a) => a.provider === "openai" && a.owner_client_id === null);
  const flash = param(query.ads);
  const flashError = param(query.ads_error);
  const money = (cents: number, currency: string) => format.number(cents / 100, { style: "currency", currency });
  const number = (value: number) => format.number(value, { maximumFractionDigits: 0 });
  const percent = (value: number | null) => (value === null ? "—" : format.number(value, { style: "percent", maximumFractionDigits: 2 }));
  const day = (date: string) => format.dateTime(new Date(`${date}T12:00:00Z`), { day: "numeric", month: "short" });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<AdsToolbar slug={org.slug} basePath={basePath} owner={owner} clients={clients} canEdit={canEdit} presetProvider={isProvider(presetProvider) ? presetProvider : null} />}
      />
      {flashError && t.has(`flash.${flashError}`) && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">{t(`flash.${flashError}`)}</p>
      )}
      {flash && t.has(`flash.${flash}`) && (
        <p role="status" className="rounded-xl border border-success/30 bg-success/5 p-3 text-sm">{t(`flash.${flash}`)}</p>
      )}

      {envKeyOffer && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5">
          <div className="min-w-0">
            <h3 className="font-bold">{t("envKey.title")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t("envKey.body")}</p>
          </div>
          <form action={importEnvOpenAiAccount.bind(null, org.slug)}>
            <Button type="submit" variant="outline">{t("envKey.import")}</Button>
          </form>
        </section>
      )}

      {spendByCurrency.size > 0 && (
        <section className="rounded-2xl border bg-card p-5" aria-label={t("totals.title")}>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("totals.title")} · {ownerName}</p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            {[...spendByCurrency].map(([currency, cents]) => (
              <p key={currency} className="text-3xl font-extrabold tabular heading-tight">{money(cents, currency)}</p>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("totals.hint")}</p>
        </section>
      )}

      {AD_TYPES.map((type) => {
        const provider = AD_TYPE_PROVIDER[type];
        const account = ownerAccounts.find((item) => item.provider === provider);
        return (
          <AdTypeSection
            key={type}
            type={type}
            account={account}
            snapshot={account ? snapshots.get(account.id) : undefined}
            links={links}
            clients={clients}
            owner={owner}
            ownerName={ownerName}
            slug={org.slug}
            basePath={basePath}
            canEdit={canEdit}
            currency={account?.currency ?? org.currency}
            t={t}
            fmt={{ money, number, percent, day }}
          />
        );
      })}

      <p className="text-xs text-muted-foreground">{t("clientNote")}</p>
    </div>
  );
}

type Fmt = {
  money: (cents: number, currency: string) => string;
  number: (value: number) => string;
  percent: (value: number | null) => string;
  day: (date: string) => string;
};

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Eye }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</div>
      <p className="mt-2 text-2xl font-extrabold tabular heading-tight">{value}</p>
    </div>
  );
}

function AdTypeSection({
  type, account, snapshot, links, clients, owner, ownerName, slug, basePath, canEdit, currency, t, fmt,
}: {
  type: AdType;
  account: AdsAccountView | undefined;
  snapshot: AdsSnapshot | undefined;
  links: CampaignLink[];
  clients: ClientOption[];
  owner: string;
  ownerName: string;
  slug: string;
  basePath: string;
  canEdit: boolean;
  currency: string;
  t: Awaited<ReturnType<typeof getTranslations<"ads">>>;
  fmt: Fmt;
}) {
  const label = AD_TYPE_LABEL[type];
  const provider = AD_TYPE_PROVIDER[type];

  if (!account) {
    return (
      <section className="rounded-2xl border border-dashed bg-card/60 p-5" aria-label={label}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("section.empty", { type: label, owner: ownerName })}</p>
            {type === "youtube" && <p className="mt-1 text-xs text-muted-foreground">{t("section.sharesGoogle")}</p>}
          </div>
          {canEdit && type !== "youtube" && (
            <Button asChild variant="outline">
              <Link href={`${basePath}/ads?owner=${encodeURIComponent(owner)}&add=${provider}`}>{t("section.addType", { type: label })}</Link>
            </Button>
          )}
        </div>
      </section>
    );
  }

  const campaigns: AdsCampaign[] = snapshot ? campaignsForAdType(type, snapshot.campaigns) : [];
  const totals = adsTotals(campaigns);
  const rows = [...campaigns].sort((a, b) => b.spend_cents - a.spend_cents);

  return (
    <section className="overflow-hidden rounded-2xl border bg-card" aria-label={label}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">{label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {account.label}
            {account.platform_name && ` · ${account.platform_name}`}
            {` · ${account.external_account_id}`}
            {` · ${t("section.accountOf", { owner: ownerName })}`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular">
            {snapshot ? `${t("period", { from: fmt.day(snapshot.from), to: fmt.day(snapshot.to) })} · ` : ""}
            {snapshot?.ageMinutes !== null && snapshot?.ageMinutes !== undefined ? t("fetchedAgo", { minutes: snapshot.ageMinutes }) : t("neverFetched")}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {account.connected ? (
              <RefreshAccountButton slug={slug} accountId={account.id} />
            ) : (
              <Button asChild size="sm">
                <a href={`/api/integrations/ads-google/start?org=${encodeURIComponent(slug)}&account=${account.id}`}>
                  <Link2 data-icon="inline-start" />
                  {t("section.connectGoogle")}
                </a>
              </Button>
            )}
            <ArchiveAccountButton slug={slug} accountId={account.id} />
          </div>
        )}
      </header>

      <div className="space-y-5 p-5">
        {!account.connected && (
          <p role="status" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{t("section.notConnected")}</p>
        )}
        {snapshot?.error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />{t("section.error", { message: snapshot.error })}</p>
        )}
        {snapshot && (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Metric label={t("metrics.impressions")} value={fmt.number(totals.impressions)} icon={Eye} />
            <Metric label={t("metrics.clicks")} value={fmt.number(totals.clicks)} icon={MousePointerClick} />
            <Metric label={t("metrics.spend")} value={fmt.money(totals.spend_cents, currency)} icon={Wallet} />
            <Metric label={t("metrics.ctr")} value={fmt.percent(totals.ctr)} icon={Megaphone} />
          </div>
        )}
        {snapshot && (
          <div className="overflow-hidden rounded-2xl border">
            <div className="border-b bg-muted/35 px-4 py-3">
              <h3 className="font-bold">{t("section.campaigns")}</h3>
              <p className="text-xs text-muted-foreground">{t("section.campaignsHint")}</p>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">{t("section.noCampaigns")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2">{t("section.campaign")}</th>
                      <th className="px-4 py-2 text-right">{t("metrics.impressions")}</th>
                      <th className="px-4 py-2 text-right">{t("metrics.clicks")}</th>
                      <th className="px-4 py-2 text-right">{t("metrics.ctr")}</th>
                      <th className="px-4 py-2 text-right">{t("metrics.spend")}</th>
                      <th className="px-4 py-2">{t("section.client")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((campaign) => {
                      const link = links.find((item) => item.ad_account_id === account.id && item.campaign_id === campaign.id);
                      const ctr = campaign.impressions > 0 ? campaign.clicks / campaign.impressions : null;
                      return (
                        <tr key={campaign.id}>
                          <td className="px-4 py-3"><p className="font-semibold">{campaign.name}</p><p className="text-xs text-muted-foreground">{campaign.id}</p></td>
                          <td className="px-4 py-3 text-right tabular">{fmt.number(campaign.impressions)}</td>
                          <td className="px-4 py-3 text-right tabular">{fmt.number(campaign.clicks)}</td>
                          <td className="px-4 py-3 text-right tabular">{fmt.percent(ctr)}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular">{fmt.money(campaign.spend_cents, currency)}</td>
                          <td className="px-4 py-3">
                            {canEdit ? (
                              <form action={saveAdsCampaignClient.bind(null, slug)} className="flex flex-wrap items-center gap-2">
                                <input type="hidden" name="owner" value={owner} />
                                <input type="hidden" name="account_id" value={account.id} />
                                <input type="hidden" name="campaign_id" value={campaign.id} />
                                <select name="client_id" defaultValue={link?.client_id ?? account.owner_client_id ?? ""} aria-label={`${t("section.client")} · ${campaign.name}`} className="min-h-9 max-w-48 rounded-lg border bg-background px-2 text-sm">
                                  <option value="">{t("section.unassigned")}</option>
                                  {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                                </select>
                                <label className="flex min-h-9 items-center gap-1.5 text-sm"><input type="checkbox" name="visible" defaultChecked={link?.visible_to_client ?? false} className="size-4" /> {t("section.portal")}</label>
                                <Button type="submit" variant="outline" size="sm">{t("section.save")}</Button>
                              </form>
                            ) : (
                              <span className="text-xs text-muted-foreground">{clients.find((c) => c.id === link?.client_id)?.name ?? t("section.unassigned")}{link?.visible_to_client ? ` · ${t("section.portal")}` : ""}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
