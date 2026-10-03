import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { readOrgModules } from "@/domain/org";
import { getOrgContext } from "@/server/session";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children, params }: LayoutProps<"/[org]/settings">) {
  const { org: slug } = await params;
  const { org } = await getOrgContext(slug);
  const t = await getTranslations("settings");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SettingsNav basePath={`/${org.slug}`} modules={readOrgModules(org.settings)} />
      <div className="mt-8">{children}</div>
    </div>
  );
}
