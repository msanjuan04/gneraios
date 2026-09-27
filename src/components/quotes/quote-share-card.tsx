"use client";

import { FileCheck2, ShieldCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { LinkControl } from "@/components/portal/link-control";
import type { QuoteShareData } from "@/components/portal/types";
import { SettingsCard } from "@/components/settings/settings-card";
import { createQuoteLink } from "@/server/portal/actions";

/**
 * «Compartir enlace» del presupuesto: el enlace público para que el cliente lo vea y lo acepte
 * online (crear, copiar, revocar, visitas) y, si lo aceptó así, la evidencia de la aceptación.
 * Los datos salen de getQuoteShareData (src/server/portal/links.ts).
 */
export function QuoteShareCard({ slug, data, canAct }: { slug: string; data: QuoteShareData; canAct: boolean }) {
  const t = useTranslations("portal.quoteShare");
  const format = useFormatter();
  const acceptance = data.acceptance;
  const blocked = data.blockedReason ? t(`blocked.${data.blockedReason}`) : null;
  // Uno ya respondido sin enlace no tiene nada que enseñar.
  if (!data.link && !acceptance && data.blockedReason === "answered") return null;

  return (
    <SettingsCard title={t("title")} description={t("description")} bodyClassName="space-y-4">
      <LinkControl
        slug={slug}
        link={data.link}
        canAct={canAct}
        blockedReason={blocked}
        renewable={false}
        create={() => createQuoteLink(slug, data.quoteId)}
      />
      {data.link && !acceptance && <p className="text-xs text-muted-foreground">{t("followsValidity")}</p>}

      {acceptance && (
        <div className="space-y-1.5 rounded-2xl border border-success/30 bg-success/10 p-3.5 text-sm">
          <p className="flex items-center gap-1.5 font-semibold">
            <ShieldCheck className="size-4 text-success" />
            {t("acceptedOnline")}
          </p>
          <p>{t("acceptedBy", { name: acceptance.signerName, email: acceptance.signerEmail })}</p>
          {acceptance.signature && <p className="text-muted-foreground">{t("signature", { signature: acceptance.signature })}</p>}
          <p className="text-muted-foreground">
            {t("acceptedAt", { date: format.dateTime(new Date(acceptance.acceptedAt), { dateStyle: "medium", timeStyle: "medium" }) })}
            {acceptance.ipAddress && <> · {t("ip", { ip: acceptance.ipAddress })}</>}
          </p>
          {acceptance.userAgent && <p className="truncate text-xs text-muted-foreground" title={acceptance.userAgent}>{acceptance.userAgent}</p>}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" title={acceptance.pdfSha256}>
            <FileCheck2 className="size-3.5" />
            {t("fingerprint", { hash: `${acceptance.pdfSha256.slice(0, 16)}…` })} · {acceptance.hasPdf ? t("copyStored") : t("copyMissing")}
          </p>
        </div>
      )}
    </SettingsCard>
  );
}
