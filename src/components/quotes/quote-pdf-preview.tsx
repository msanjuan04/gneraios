"use client";

import { Download, ExternalLink, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Ruta del PDF de un presupuesto (generado al momento con sus datos de hoy). */
export function quotePdfHref(quoteId: string, opts: { download?: boolean; version?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.download) params.set("download", "1");
  // Cambia con cada guardado para que el iframe vuelva a pedir el PDF.
  if (opts.version) params.set("v", opts.version);
  const query = params.toString();
  return `/api/quotes/${quoteId}/pdf${query ? `?${query}` : ""}`;
}

/** Vista previa del PDF en un iframe, con abrir en otra pestaña y descargar. Sin guardar aún, un aviso. */
export function QuotePdfPreview({
  quoteId,
  title,
  version,
  stale = false,
  className,
}: {
  quoteId: string | null;
  title: string;
  /** updated_at del presupuesto: recarga la vista previa al guardar. */
  version?: string | null;
  /** Hay cambios sin guardar que el PDF aún no refleja. */
  stale?: boolean;
  className?: string;
}) {
  const t = useTranslations("quotes.pdf");
  if (!quoteId) {
    return (
      <SettingsCard title={t("title")} className={className}>
        <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
          <FileText className="size-5" />
          <p>{t("unsaved")}</p>
        </div>
      </SettingsCard>
    );
  }
  const src = quotePdfHref(quoteId, { version });
  return (
    <SettingsCard
      title={t("title")}
      description={stale ? <span className="text-warning">{t("stale")}</span> : undefined}
      actions={
        <>
          <Button asChild variant="ghost" size="icon-sm" aria-label={t("open")} title={t("open")}>
            <a href={src} target="_blank" rel="noreferrer">
              <ExternalLink />
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={quotePdfHref(quoteId, { download: true, version })}>
              <Download data-icon="inline-start" />
              {t("download")}
            </a>
          </Button>
        </>
      }
      className={className}
      bodyClassName="p-2"
    >
      <iframe
        key={src}
        src={src}
        title={title}
        className={cn("h-[72vh] min-h-[480px] w-full rounded-xl border bg-white transition-opacity", stale && "opacity-60")}
      />
    </SettingsCard>
  );
}
