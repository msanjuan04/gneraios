import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getOrgContext, hasRole } from "@/server/session";
import { GeneralSettingsForm } from "./general-form";
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
  };

  // La clave remonta el formulario al guardar, para enseñar los valores ya normalizados.
  return (
    <GeneralSettingsForm
      key={JSON.stringify(defaults)}
      slug={org.slug}
      defaults={defaults}
      canEdit={hasRole(member.role, "owner")}
    />
  );
}
