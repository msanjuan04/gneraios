import { FileDown, FileText, Users } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ExportPanel } from "@/components/dataio/export-panel";
import { ImportJobsList } from "@/components/dataio/import-jobs-list";
import { ImportUpload } from "@/components/dataio/import-upload";
import { ReadOnlyNotice, SettingsCard, SettingsSectionHeader } from "@/components/settings/settings-card";
import type { ImportKind } from "@/domain/dataio/fields";
import { previousQuarter } from "@/domain/dataio/period";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { loadDataPage } from "@/server/dataio/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.data")} · ${t("title")}` };
}

async function ImportCard({ slug, kind, canImport }: { slug: string; kind: ImportKind; canImport: boolean }) {
  const t = await getTranslations(`dataio.page.${kind}`);
  const tPage = await getTranslations("dataio.page");
  const Icon = kind === "clients" ? Users : FileText;
  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          <Icon className="size-4 text-primary" />
          {t("title")}
        </span>
      }
      description={t("description")}
      bodyClassName="space-y-4"
    >
      <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
        <li>{t("point1")}</li>
        <li>{t("point2")}</li>
        <li>{t("point3")}</li>
      </ul>
      <ImportUpload slug={slug} kind={kind} disabled={!canImport} />
      <a href={`/api/dataio/${slug}/template?kind=${kind}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
        <FileDown className="size-3.5" />
        {tPage("template")}
      </a>
    </SettingsCard>
  );
}

/**
 * Ajustes → Datos: importar clientes y facturas históricas (subir → mapear → simular → confirmar)
 * y exportar el libro registro de facturas expedidas para la gestoría.
 */
export default async function DataSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const canImport = hasRole(member.role, "partner");
  const t = await getTranslations("dataio.page");
  const supabase = await createClient();
  const { jobs, issuers } = await loadDataPage(supabase, org.id);

  const today = nowInZone(org.timezone).date;
  const last = previousQuarter(today);
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 7 }, (_, i) => thisYear - i);

  return (
    <div className="space-y-10">
      <section>
        <SettingsSectionHeader title={t("importTitle")} description={t("importDescription")} />
        {!canImport && <ReadOnlyNotice className="mb-4">{t("partnerOnly")}</ReadOnlyNotice>}
        <div className="grid gap-4 md:grid-cols-2">
          <ImportCard slug={org.slug} kind="clients" canImport={canImport} />
          <ImportCard slug={org.slug} kind="invoices" canImport={canImport} />
        </div>
      </section>

      <section>
        <SettingsSectionHeader title={t("jobsTitle")} description={t("jobsDescription")} />
        <ImportJobsList basePath={`/${org.slug}`} jobs={jobs} />
      </section>

      <section>
        <SettingsSectionHeader title={t("exportTitle")} description={t("exportDescription")} />
        <SettingsCard>
          <ExportPanel slug={org.slug} issuers={issuers} defaultYear={last.year} defaultQuarter={last.quarter ?? 1} years={years} />
        </SettingsCard>
      </section>
    </div>
  );
}
