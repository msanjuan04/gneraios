import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DigestSettings } from "@/components/push/digest-settings";
import { PushSettings } from "@/components/push/push-settings";
import { SettingsSectionHeader } from "@/components/settings/settings-card";
import { createClient } from "@/lib/supabase/server";
import { accessStatus } from "@/server/auth/access-code";
import { getOrgContext } from "@/server/session";
import { ProfileForm } from "./profile-form";
import { SecurityCard } from "./security-card";
import type { ProfileInput } from "./schema";
import { ThemePicker } from "./theme-picker";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.preferences")} · ${t("title")}` };
}

export default async function PreferencesSettingsPage({ params }: PageProps<"/[org]/settings/preferences">) {
  const { org: slug } = await params;
  const { org, member, user } = await getOrgContext(slug);
  const t = await getTranslations("settings.preferences");
  const defaults: ProfileInput = { full_name: member.fullName, initials: member.initials, locale: member.locale };
  const [{ data: prefs }, access] = await Promise.all([
    (await createClient()).from("members").select("weekly_digest").eq("id", member.id).maybeSingle(),
    accessStatus(user.id),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <SettingsSectionHeader title={t("title")} description={t("description")} />
        {/* La clave remonta el formulario con lo guardado. */}
        <ProfileForm key={JSON.stringify(defaults)} slug={org.slug} defaults={defaults} />
      </section>
      <section id="security">
        <SettingsSectionHeader title={t("securityTitle")} description={t("securityDescription")} />
        <SecurityCard slug={org.slug} name={member.fullName} access={access} backTo={`/${org.slug}/settings/preferences`} />
      </section>
      <section>
        <SettingsSectionHeader title={t("theme")} description={t("themeDescription")} />
        <ThemePicker />
      </section>
      <section id="push">
        <SettingsSectionHeader title={t("deviceTitle")} description={t("deviceDescription")} />
        <div className="space-y-6">
          <PushSettings slug={org.slug} />
          <DigestSettings slug={org.slug} enabled={prefs?.weekly_digest ?? true} />
        </div>
      </section>
    </div>
  );
}
