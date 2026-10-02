import { Megaphone } from "lucide-react";
import type { SpaceData } from "@/components/portal/types";
import { portalIntlLocale } from "@/domain/portal";
import { portalCopy } from "@/server/portal/copy";
import { civil, EmptyState, SectionCard } from "../ui";
import { SPACE_SECTION_ICONS } from "./icons";

/** Informe para cliente: únicamente campañas que un socio vinculó y publicó. */
export function AdsSection({ data }: { data: SpaceData }) {
  const t = portalCopy(data.locale);
  const report = data.adsData;
  if (!report) {
    return (
      <SectionCard id="ads" icon={SPACE_SECTION_ICONS.ads} title={t("space.sections.ads.title")}>
        <EmptyState icon={Megaphone}>{t("space.sections.ads.empty")}</EmptyState>
      </SectionCard>
    );
  }
  const locale = portalIntlLocale(data.locale);
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: report.currency });
  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 });
  const totals = report.campaigns.reduce(
    (sum, campaign) => ({ impressions: sum.impressions + campaign.impressions, clicks: sum.clicks + campaign.clicks, spend: sum.spend + campaign.spend }),
    { impressions: 0, clicks: 0, spend: 0 },
  );
  return (
    <SectionCard
      id="ads"
      icon={SPACE_SECTION_ICONS.ads}
      title={t("space.sections.ads.title")}
      subtitle={t("space.sections.ads.subtitle")}
    >
      <p className="mb-4 text-sm text-muted-foreground">{t("space.sections.ads.range", { from: civil(report.from, data.locale, "medium"), to: civil(report.to, data.locale, "medium") })}</p>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t("space.sections.ads.impressions"), value: n.format(totals.impressions) },
          { label: t("space.sections.ads.clicks"), value: n.format(totals.clicks) },
          { label: t("space.sections.ads.ctr"), value: totals.impressions ? pct.format(totals.clicks / totals.impressions) : "—" },
          { label: t("space.sections.ads.spend"), value: money.format(totals.spend) },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border bg-background/50 p-3 sm:p-4">
            <dt className="text-xs font-semibold text-muted-foreground">{item.label}</dt>
            <dd className="mt-2 text-xl font-extrabold tabular heading-tight sm:text-2xl">{item.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 divide-y rounded-2xl border">
        {report.campaigns.map((campaign) => (
          <div key={campaign.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="font-semibold">{campaign.name}</span>
            <span className="text-muted-foreground tabular">{n.format(campaign.clicks)} {t("space.sections.ads.clicks").toLowerCase()} · {money.format(campaign.spend)}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t("space.sections.ads.measured")}</p>
    </SectionCard>
  );
}
