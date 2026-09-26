"use client";

import { Download, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Ruta del PDF: emitida, la copia legal guardada; borrador, una vista previa con la marca de borrador. */
export const invoicePdfHref = (invoiceId: string, opts: { download?: boolean; version?: string | null } = {}) => {
  const params = new URLSearchParams();
  if (opts.download) params.set("download", "1");
  // Cambia con cada guardado para que el iframe vuelva a pedir la vista previa.
  if (opts.version) params.set("v", opts.version);
  const query = params.toString();
  return `/api/invoices/${invoiceId}/pdf${query ? `?${query}` : ""}`;
};

/** Vista previa del PDF en un iframe, con abrir en otra pestaña y descargar. */
export function PdfPreview({
  invoiceId,
  title,
  version,
  stale = false,
  downloadable = false,
  className,
}: {
  invoiceId: string;
  title: string;
  /** updated_at del borrador: recarga la vista previa al guardar. */
  version?: string | null;
  /** Hay cambios sin guardar que el PDF aún no refleja. */
  stale?: boolean;
  downloadable?: boolean;
  className?: string;
}) {
  const t = useTranslations("invoices.pdf");
  const src = invoicePdfHref(invoiceId, { version });
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
          {downloadable && (
            <Button asChild variant="outline" size="sm">
              <a href={invoicePdfHref(invoiceId, { download: true })}>
                <Download data-icon="inline-start" />
                {t("download")}
              </a>
            </Button>
          )}
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
