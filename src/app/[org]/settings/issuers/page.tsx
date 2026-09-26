import { Landmark } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReadOnlyNotice, SettingsSectionHeader } from "@/components/settings/settings-card";
import { formatInvoiceNumber } from "@/domain/invoicing/number-format";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext, hasRole } from "@/server/session";
import { currentYear } from "@/server/action-utils";
import { IssuerCard, type IssuerSeries } from "./issuer-card";
import { IssuerSheetButton, type MemberOption } from "./issuer-sheet";
import { ISSUER_COLUMNS, newIssuerDefaults } from "./schema";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.issuers")} · ${t("title")}` };
}

export default async function IssuersSettingsPage({ params }: PageProps<"/[org]/settings/issuers">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const canEdit = hasRole(member.role, "owner");
  const t = await getTranslations("settings.issuers");
  const tCommon = await getTranslations("common");
  const supabase = await createClient();
  const year = currentYear(org.timezone);

  const [issuersRes, seriesRes, countersRes, membersRes] = await Promise.all([
    supabase
      .from("issuers")
      .select(ISSUER_COLUMNS)
      .eq("org_id", org.id)
      .is("archived_at", null)
      .order("is_primary", { ascending: false })
      .order("kind")
      .order("legal_name"),
    supabase
      .from("invoice_series")
      .select("id, issuer_id, code, name, kind, format, reset_yearly")
      .eq("org_id", org.id)
      .is("archived_at", null)
      .order("kind")
      .order("code"),
    supabase.rpc("series_counters", { p_org: org.id }),
    supabase.from("members").select("id, full_name, is_active").eq("org_id", org.id).order("full_name"),
  ]);
  if (issuersRes.error) throw issuersRes.error;
  if (seriesRes.error) throw seriesRes.error;
  if (countersRes.error) throw countersRes.error;
  if (membersRes.error) throw membersRes.error;

  const issuers = issuersRes.data;
  const members: MemberOption[] = membersRes.data.map((m) => ({ id: m.id, name: m.full_name, active: m.is_active }));

  // Último número usado por serie en el año en curso (año 0 si la serie no se reinicia).
  const lastNumbers = new Map(countersRes.data.map((c) => [`${c.series_id}:${c.year}`, c.last_number]));
  const seriesByIssuer = new Map<string, IssuerSeries[]>();
  for (const s of seriesRes.data) {
    const lastNumber = lastNumbers.get(`${s.id}:${s.reset_yearly ? year : 0}`) ?? 0;
    const list = seriesByIssuer.get(s.issuer_id) ?? [];
    list.push({
      id: s.id,
      code: s.code,
      name: s.name,
      kind: s.kind,
      format: s.format,
      resetYearly: s.reset_yearly,
      lastNumber,
      next: formatInvoiceNumber(s.format, year, lastNumber + 1),
    });
    seriesByIssuer.set(s.issuer_id, list);
  }

  const addButton = canEdit ? (
    <IssuerSheetButton
      slug={org.slug}
      defaults={newIssuerDefaults(!issuers.some((i) => i.is_primary))}
      members={members}
    />
  ) : undefined;

  return (
    <div>
      <SettingsSectionHeader title={t("title")} description={t("description")} actions={addButton} />
      {!canEdit && <ReadOnlyNotice className="mb-4">{tCommon("ownerOnly")}</ReadOnlyNotice>}

      {issuers.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
          <Landmark className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {issuers.map((issuer) => (
            <IssuerCard
              key={issuer.id}
              slug={org.slug}
              issuer={issuer}
              series={seriesByIssuer.get(issuer.id) ?? []}
              members={members}
              canEdit={canEdit}
              year={year}
            />
          ))}
        </div>
      )}
    </div>
  );
}
