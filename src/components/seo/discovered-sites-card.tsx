"use client";

import { Globe, Plus, Radar } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addDiscoveredSite } from "@/app/[org]/seo/actions";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import type { DiscoveredSite } from "@/server/seo/queries";

/**
 * Webs que ya están en el Search Console de la cuenta conectada pero aún no en GNERAI OS. Se dan
 * de alta con un clic, con la propiedad exacta que usa Google y el cliente cuya web coincide.
 */
export function DiscoveredSitesCard({ slug, sites, canEdit }: { slug: string; sites: DiscoveredSite[]; canEdit: boolean }) {
  const t = useTranslations("seo.discovered");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);

  if (sites.length === 0) return null;

  const add = (site: DiscoveredSite) => {
    setAdding(site.siteUrl);
    startTransition(async () => {
      const result = await addDiscoveredSite(slug, site.siteUrl, site.suggestedClientId);
      setAdding(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("added", { site: site.host }));
      router.refresh();
    });
  };

  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          <Radar className="size-4 text-primary" />
          {t("title", { count: sites.length })}
        </span>
      }
      description={t("description")}
    >
      <ul className="divide-y">
        {sites.map((site) => (
          <li key={site.siteUrl} className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <Globe className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{site.host}</p>
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-mono">{site.siteUrl}</span>
                {" · "}
                {site.suggestedClientName ? t("suggestedClient", { client: site.suggestedClientName }) : t("ownOrUnlinked")}
              </p>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => add(site)} disabled={pending}>
                <Plus data-icon="inline-start" />
                {adding === site.siteUrl ? t("adding") : t("add")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
