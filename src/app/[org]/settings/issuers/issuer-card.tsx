import { Building2, ShieldCheck, TriangleAlert, UserRound } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { DetailItem } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { formatBps } from "@/domain/money";
import { formatIban } from "@/domain/tax-id";
import { ArchiveIssuerButton } from "./archive-issuer-button";
import { IssuerSheetButton, type MemberOption } from "./issuer-sheet";
import { issuerFormDefaults, type IssuerRow } from "./schema";
import { SeriesNumberButton, type SeriesNumbering } from "./series-number-dialog";

export type IssuerSeries = SeriesNumbering & { kind: "ordinary" | "rectifying"; next: string };

type Props = {
  slug: string;
  issuer: IssuerRow;
  series: IssuerSeries[];
  members: MemberOption[];
  canEdit: boolean;
  year: number;
};

/** Ficha de un emisor con sus datos fiscales y sus series de facturación. */
export async function IssuerCard({ slug, issuer, series, members, canEdit, year }: Props) {
  const t = await getTranslations("settings.issuers");
  const tKind = await getTranslations("issuerKind");
  const tSeriesKind = await getTranslations("seriesKind");
  const format = await getFormatter();
  const locale = await getLocale();

  const isCompany = issuer.kind === "company";
  const pendingConstitution = isCompany && !issuer.active_from;
  const Icon = isCompany ? Building2 : UserRound;
  const longDate = (date: string) => format.dateTime(new Date(`${date}T12:00:00Z`), { dateStyle: "long" });
  const address = [issuer.address_line, [issuer.postal_code, issuer.city].filter(Boolean).join(" "), issuer.province]
    .filter(Boolean)
    .join(", ");
  const memberName = members.find((m) => m.id === issuer.member_id)?.name;
  const none = <span className="text-muted-foreground">—</span>;

  return (
    <article className="rounded-2xl border bg-card text-sm">
      <header className="flex flex-wrap items-start gap-3 p-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-bold">{issuer.legal_name}</h4>
            {issuer.is_primary && <Badge>{t("primary")}</Badge>}
            <Badge variant="outline">{tKind(issuer.kind)}</Badge>
            {pendingConstitution && <Badge className="bg-warning/15 text-warning">{t("pending")}</Badge>}
            {!issuer.tax_id && (
              <Badge className="bg-warning/15 text-warning">
                <TriangleAlert data-icon="inline-start" />
                {t("missingTaxId")}
              </Badge>
            )}
          </div>
          {issuer.trade_name && issuer.trade_name !== issuer.legal_name && (
            <p className="mt-0.5 text-muted-foreground">{issuer.trade_name}</p>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <IssuerSheetButton
              slug={slug}
              issuerId={issuer.id}
              defaults={issuerFormDefaults(issuer)}
              members={members}
              primaryLocked={issuer.is_primary}
            />
            {!issuer.is_primary && <ArchiveIssuerButton slug={slug} issuerId={issuer.id} name={issuer.legal_name} />}
          </div>
        )}
      </header>

      <dl className="grid gap-x-6 gap-y-4 border-t px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        <DetailItem label={t("taxId")}>{issuer.tax_id ? <span className="font-mono">{issuer.tax_id}</span> : none}</DetailItem>
        <DetailItem label={t("address")}>{address || none}</DetailItem>
        <DetailItem label={t("iban")}>
          {issuer.iban ? <span className="font-mono tabular">{formatIban(issuer.iban)}</span> : none}
        </DetailItem>
        <DetailItem label={t("email")}>{issuer.email ?? none}</DetailItem>
        {!isCompany && (
          <DetailItem label={t("irpf")}>
            <span className="tabular">{formatBps(issuer.default_irpf_bps, locale)}</span>
          </DetailItem>
        )}
        {!isCompany && (
          <DetailItem label={t("linkedMember")}>
            {memberName ?? <span className="text-muted-foreground">{t("noMember")}</span>}
          </DetailItem>
        )}
        {issuer.active_from && <DetailItem label={t("activeFrom")}>{longDate(issuer.active_from)}</DetailItem>}
        <DetailItem label={t("verifactuFrom")}>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 shrink-0 text-primary" />
            {longDate(issuer.verifactu_from)}
          </span>
        </DetailItem>
        <DetailItem label={t("provider")}>
          {issuer.fiscal_provider === "internal" ? t("providerInternal") : issuer.fiscal_provider}
        </DetailItem>
        {isCompany && issuer.registry_info && (
          <DetailItem label={t("registryInfo")} className="whitespace-pre-line sm:col-span-2 lg:col-span-3">
            {issuer.registry_info}
          </DetailItem>
        )}
      </dl>

      <div className="border-t px-5 py-4">
        <h5 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("series")}</h5>
        {series.length === 0 ? (
          <p className="mt-2 text-muted-foreground">{t("noSeries")}</p>
        ) : (
          <ul className="mt-1 divide-y">
            {series.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="inline-flex h-6 min-w-8 items-center justify-center rounded-md border bg-muted/50 px-1.5 font-mono text-xs font-semibold">
                  {s.code}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tSeriesKind(s.kind)} · <span className="font-mono">{s.format}</span>
                  </p>
                </div>
                <p className="ml-auto text-xs text-muted-foreground tabular">{t("next", { number: s.next })}</p>
                {canEdit && <SeriesNumberButton slug={slug} series={s} year={year} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
