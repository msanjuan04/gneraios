"use client";

import { Archive, ArchiveRestore, BarChart3, Building2, Globe, Pencil, Plus, Star } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setSeoPropertyArchived } from "@/app/[org]/seo/actions";
import { EMPTY_PROPERTY_FORM, type PropertyFormInput } from "@/app/[org]/seo/schema";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SeoPropertyView } from "@/server/seo/queries";
import { formatDay, siteName } from "./format";
import { type ClientOption, PropertySheet } from "./property-sheet";

type Editing = { open: boolean; propertyId?: string; defaults: PropertyFormInput };

function toForm(p: SeoPropertyView): PropertyFormInput {
  return {
    label: p.label,
    owner: p.clientId ? "client" : "own",
    client_id: p.clientId ?? "",
    gsc_site_url: p.gscSiteUrl ?? "",
    ga4_property_id: p.ga4PropertyId ?? "",
    is_primary: p.isPrimary,
  };
}

/** Las webs de la org: la propia y las de los clientes, con de dónde salen sus datos y hasta cuándo. */
export function PropertiesManager({
  slug,
  basePath,
  properties,
  clients,
  canEdit,
  googleConnected,
  openNew,
  newClientId,
}: {
  slug: string;
  basePath: string;
  properties: SeoPropertyView[];
  clients: ClientOption[];
  canEdit: boolean;
  googleConnected: boolean;
  /** Abrir el alta nada más llegar (después de conectar Google o desde la ficha de un cliente). */
  openNew: boolean;
  newClientId: string | null;
}) {
  const t = useTranslations("seo.properties");
  const format = useFormatter();
  const newDefaults = (clientId: string | null): PropertyFormInput => {
    const client = clientId ? clients.find((c) => c.id === clientId) : undefined;
    const hasPrimary = properties.some((p) => !p.archived && p.isPrimary && p.clientId === (client?.id ?? null));
    return client
      ? { ...EMPTY_PROPERTY_FORM, owner: "client", client_id: client.id, label: client.name, is_primary: !hasPrimary }
      : { ...EMPTY_PROPERTY_FORM, is_primary: !hasPrimary };
  };
  const [editing, setEditing] = useState<Editing>({ open: canEdit && openNew, defaults: newDefaults(newClientId) });
  const [pending, startTransition] = useTransition();
  const [showArchived, setShowArchived] = useState(false);

  const live = properties.filter((p) => !p.archived);
  const archived = properties.filter((p) => p.archived);

  const archive = (p: SeoPropertyView, value: boolean) =>
    startTransition(async () => {
      const result = await setSeoPropertyArchived(slug, p.id, value);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (value) toast.success(t("archivedToast", { name: p.label }), { action: { label: t("undo"), onClick: () => archive(p, false) } });
      else toast.success(t("restoredToast", { name: p.label }));
    });

  const coverage = (p: SeoPropertyView) => {
    const span = p.searchSpan ?? p.webSpan;
    if (!span) return p.gscSiteUrl || p.ga4PropertyId ? (googleConnected ? t("waiting") : t("noData")) : t("noData");
    return t("coverage", { from: formatDay(format, span.first, true), to: formatDay(format, span.last, true) });
  };

  const row = (p: SeoPropertyView) => {
    const error = p.gsc.lastError ?? p.ga4.lastError;
    return (
      <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {p.clientId ? <Building2 aria-hidden className="size-4" /> : <Globe aria-hidden className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{p.label}</span>
            {p.isPrimary && (
              <Badge variant="secondary" className="gap-1">
                <Star aria-hidden className="fill-current" />
                {t("primary")}
              </Badge>
            )}
            {p.source === "demo" && <Badge variant="outline">{t("demo")}</Badge>}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {[p.clientName ?? t("ownSite"), siteName(p.gscSiteUrl), p.ga4PropertyId && t("ga4Id", { id: p.ga4PropertyId })].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {coverage(p)}
            {error && <span className="text-destructive"> · {t("syncError", { error })}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!p.archived && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`${basePath}/seo?property=${p.id}`}>
                <BarChart3 data-icon="inline-start" />
                {t("open")}
              </Link>
            </Button>
          )}
          {canEdit && !p.archived && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setEditing({ open: true, propertyId: p.id, defaults: toForm(p) })}>
                  <Pencil />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("edit")}</TooltipContent>
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={p.archived ? t("restore") : t("archive")}
                  onClick={() => archive(p, !p.archived)}
                  disabled={pending}
                >
                  {p.archived ? <ArchiveRestore /> : <Archive />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{p.archived ? t("restore") : t("archive")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <SettingsCard
        title={t("title")}
        description={t("description")}
        actions={
          canEdit && (
            <Button size="sm" onClick={() => setEditing({ open: true, defaults: newDefaults(null) })}>
              <Plus data-icon="inline-start" />
              {t("add")}
            </Button>
          )
        }
      >
        {live.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center">
            <p className="font-semibold">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{googleConnected ? t("emptyConnected") : t("emptyBody")}</p>
          </div>
        ) : (
          <ul className="divide-y">{live.map(row)}</ul>
        )}
        {archived.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? t("hideArchived") : t("showArchived", { count: archived.length })}
            </Button>
            {showArchived && <ul className="mt-2 divide-y opacity-80">{archived.map(row)}</ul>}
          </div>
        )}
      </SettingsCard>

      {canEdit && (
        <PropertySheet
          slug={slug}
          open={editing.open}
          onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
          propertyId={editing.propertyId}
          defaults={editing.defaults}
          clients={clients}
          googleConnected={googleConnected}
        />
      )}
    </>
  );
}
