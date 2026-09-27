"use client";

import { ArrowUpRight, Globe } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFinanceFormat } from "@/components/finance/format";
import { SettingsCard } from "@/components/settings/settings-card";
import type { InfrastructureReport } from "@/domain/finance/infrastructure";
import { cn } from "@/lib/utils";

/**
 * Coste por web alojada: lo mensual que se reparte entre las webs alojadas, a partes iguales entre
 * las activas, y lo que le toca a cada cliente (con sus webs). Las webs sin cliente, al final.
 */
export function HostingCard({ hosting, basePath, className }: { hosting: InfrastructureReport["hosting"]; basePath: string; className?: string }) {
  const t = useTranslations("infrastructure.hosting");
  const { money } = useFinanceFormat();
  const shared = hosting.monthlyCents !== 0;
  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      className={className}
      bodyClassName="p-0"
      actions={
        <Link
          href={`${basePath}/sites`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline"
        >
          {t("openSites")}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      }
    >
      {hosting.sites === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("noSites")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-5 py-3">
            <p className="text-lg font-bold tabular heading-tight">
              {hosting.perSiteCents === null ? "—" : t("perSite", { amount: money(hosting.perSiteCents) })}
            </p>
            <p className="text-xs text-muted-foreground">{t("summary", { count: hosting.sites, amount: money(hosting.monthlyCents) })}</p>
          </div>
          {!shared && <p className="border-b px-5 py-3 text-xs text-muted-foreground">{t("noShared")}</p>}
          <ul className="divide-y">
            {hosting.groups.map((group) => (
              <li key={group.clientId ?? "none"} className="px-5 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  {group.clientId ? (
                    <Link
                      href={`${basePath}/clients/${group.clientId}`}
                      className="min-w-0 truncate text-sm font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                    >
                      {group.name ?? t("unknownClient")}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate text-sm font-semibold text-muted-foreground italic">{t("noClient")}</span>
                  )}
                  <span className={cn("shrink-0 text-sm font-semibold tabular", !shared && "text-muted-foreground")}>
                    {shared ? t("perMonth", { amount: money(group.monthlyCents) }) : "—"}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {group.sites.map((site) => (
                    <li key={site.id} className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                      <Link
                        href={`${basePath}/sites/${site.id}`}
                        className="inline-flex min-w-0 items-center gap-1.5 outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline"
                      >
                        <Globe aria-hidden className="size-3 shrink-0" />
                        <span className="truncate">{site.name}</span>
                      </Link>
                      {shared && group.sites.length > 1 && <span className="shrink-0 tabular">{money(site.monthlyCents)}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </SettingsCard>
  );
}
