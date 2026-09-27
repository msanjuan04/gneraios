import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { readGoals } from "@/domain/metrics/goals";
import { nowInZone } from "@/lib/clock";
import { getOrgContext, hasRole } from "@/server/session";
import { GeneralSettingsForm } from "./general-form";
import { GoalsForm } from "./goals-form";
import { type GeneralSettingsInput, readOrgSettings } from "./schema";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

export default async function GeneralSettingsPage({ params }: PageProps<"/[org]/settings">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const settings = readOrgSettings(org.settings);
  const defaults: GeneralSettingsInput = {
    name: org.name,
    payment_terms_days: settings.payment_terms_days,
    billing_day: settings.billing_day,
    dunning_days: settings.dunning_days.join(", "),
    renewal_alert_days: settings.renewal_alert_days.join(", "),
    quote_validity_days: settings.quote_validity_days,
    concentration_alert_percent: Math.round(settings.concentration_alert_bps / 100),
    target_hourly_rate_euros: Math.round(settings.target_hourly_rate_cents / 100),
  };

  const goals = readGoals(org.settings);
  const year = Number(nowInZone(org.timezone).date.slice(0, 4));
  const goalDefaults = {
    mrr_euros: goals.mrr ? String(Math.round(goals.mrr.targetCents / 100)) : "",
    mrr_by: goals.mrr?.by ?? "",
    revenue_euros: goals.revenueYear ? String(Math.round(goals.revenueYear.targetCents / 100)) : "",
    revenue_year: goals.revenueYear?.year ?? year,
  };
  const canEdit = hasRole(member.role, "owner");

  // La clave remonta el formulario al guardar, para enseñar los valores ya normalizados.
  return (
    <div className="space-y-8">
      <GeneralSettingsForm key={JSON.stringify(defaults)} slug={org.slug} defaults={defaults} canEdit={canEdit} />
      <div id="goals" className="scroll-mt-24">
        <GoalsForm key={JSON.stringify(goalDefaults)} slug={org.slug} defaults={goalDefaults} canEdit={canEdit} />
      </div>
    </div>
  );
}
