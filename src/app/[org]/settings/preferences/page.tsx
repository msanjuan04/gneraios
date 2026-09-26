import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsSectionHeader } from "@/components/settings/settings-card";
import { getOrgContext } from "@/server/session";
import { ProfileForm } from "./profile-form";
import type { ProfileInput } from "./schema";
import { ThemePicker } from "./theme-picker";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.preferences")} · ${t("title")}` };
}

export default async function PreferencesSettingsPage({ params }: PageProps<"/[org]/settings/preferences">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const t = await getTranslations("settings.preferences");
  const defaults: ProfileInput = { full_name: member.fullName, initials: member.initials, locale: member.locale };

  return (
    <div className="space-y-10">
      <section>
        <SettingsSectionHeader title={t("title")} description={t("description")} />
        {/* La clave remonta el formulario con lo guardado. */}
        <ProfileForm key={JSON.stringify(defaults)} slug={org.slug} defaults={defaults} />
      </section>
      <section>
        <SettingsSectionHeader title={t("theme")} description={t("themeDescription")} />
        <ThemePicker />
      </section>
    </div>
  );
}
