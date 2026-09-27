"use client";

import { Activity, ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSiteFormat } from "./format";
import { ExpiryValue, StatusLine } from "./sites-table";
import { StatusDot } from "./status-dot";
import type { ClientSitesData } from "./types";

/**
 * Las webs del cliente en su ficha 360: el estado de cada una, su uptime de 7 días y lo que caduca.
 *
 * Uso (servidor): `const sites = await getClientSites(org, client.id)` (src/server/sites/queries.ts)
 * y `<ClientSitesCard basePath={`/${org.slug}`} clientId={client.id} data={sites} canEdit={isPartner} />`.
 */
export function ClientSitesCard({
  basePath,
  clientId,
  data,
  canEdit,
  className,
}: {
  basePath: string;
  clientId: string;
  data: ClientSitesData;
  /** Socio u owner: puede dar de alta webs. */
  canEdit: boolean;
  className?: string;
}) {
  const t = useTranslations("sites.client");
  const fmt = useSiteFormat();
  const newHref = `${basePath}/sites?new=1&client=${clientId}`;

  if (data.sites.length === 0) {
    return (
      <section className={cn("flex items-center gap-3 rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground", className)}>
        <Activity aria-hidden className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t("title")}</p>
          <p className="truncate text-xs">{t("empty")}</p>
        </div>
        {canEdit && (
          <Link
            href={newHref}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            <Plus aria-hidden className="size-3.5" />
            {t("add")}
          </Link>
        )}
      </section>
    );
  }

  const problems = data.sites.filter((s) => s.problem).length;
  return (
    <SettingsCard
      title={t("title")}
      description={problems > 0 ? t("problems", { count: problems }) : t("allGood", { count: data.sites.length })}
      actions={
        canEdit ? (
          <Button asChild variant="ghost" size="icon-sm" aria-label={t("add")}>
            <Link href={newHref}>
              <Plus />
            </Link>
          </Button>
        ) : undefined
      }
      className={className}
      bodyClassName="p-0"
    >
      <ul className="divide-y">
        {data.sites.map((site) => (
          <li key={site.id}>
            <Link
              href={`${basePath}/sites/${site.id}`}
              className="group flex items-center gap-3 px-5 py-2.5 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <StatusDot status={site.status} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-semibold group-hover:text-primary", site.status === "paused" && "text-muted-foreground")}>{site.name}</p>
                <StatusLine site={site} fmt={fmt} />
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className="tabular text-muted-foreground">{site.uptime.week === null ? "—" : fmt.uptime(site.uptime.week)}</p>
                <p className="flex justify-end gap-2">
                  {site.ssl && site.ssl.severity !== "ok" && <ExpiryValue expiry={site.ssl} fmt={fmt} kind="ssl" />}
                  {site.domain && site.domain.severity !== "ok" && <ExpiryValue expiry={site.domain} fmt={fmt} kind="domain" />}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <footer className="border-t px-5 py-2.5">
        <Link href={`${basePath}/sites`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          {t("open")}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </footer>
    </SettingsCard>
  );
}
