import { Percent } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ReadOnlyNotice, SettingsSectionHeader } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBps } from "@/domain/money";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext, hasRole } from "@/server/session";
import { AddTaxRateButton, TaxRateRowActions } from "./tax-rate-sheet";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.taxes")} · ${t("title")}` };
}

export default async function TaxesSettingsPage({ params }: PageProps<"/[org]/settings/taxes">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const canEdit = hasRole(member.role, "owner");
  const t = await getTranslations("settings.taxes");
  const tRegime = await getTranslations("vatRegime");
  const tCommon = await getTranslations("common");
  const locale = await getLocale();
  const supabase = await createClient();

  // El enum ordena primero el IVA y después el IRPF.
  const { data: rates, error } = await supabase
    .from("tax_rates")
    .select("id, kind, name, rate_bps, regime, legal_note, is_default")
    .eq("org_id", org.id)
    .is("archived_at", null)
    .order("kind")
    .order("position")
    .order("name");
  if (error) throw error;

  return (
    <div>
      <SettingsSectionHeader
        title={t("title")}
        description={t("description")}
        actions={canEdit ? <AddTaxRateButton slug={org.slug} /> : undefined}
      />
      {!canEdit && <ReadOnlyNotice className="mb-4">{tCommon("ownerOnly")}</ReadOnlyNotice>}

      {rates.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
          <Percent className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <div className="rounded-2xl border bg-card px-2 py-1">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs text-muted-foreground">{t("name")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("kind")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("regime")}</TableHead>
                <TableHead className="text-right text-xs text-muted-foreground">{t("rate")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("legalNote")}</TableHead>
                {canEdit && (
                  <TableHead className="w-0">
                    <span className="sr-only">{t("actions")}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      {rate.name}
                      {rate.is_default && <Badge variant="secondary">{t("default")}</Badge>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t(rate.kind)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {rate.regime ? tRegime(rate.regime) : tCommon("none")}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular">{formatBps(rate.rate_bps, locale)}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-muted-foreground">
                    <span className="line-clamp-2" title={rate.legal_note ?? undefined}>
                      {rate.legal_note ?? tCommon("none")}
                    </span>
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <TaxRateRowActions slug={org.slug} rate={rate} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
