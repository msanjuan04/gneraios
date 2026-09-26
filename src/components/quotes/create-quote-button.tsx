"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/** Ruta de un presupuesto nuevo, con el cliente y el deal ya elegidos si se conocen. */
export function newQuoteHref(slug: string, opts: { dealId?: string | null; clientId?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (opts.clientId) params.set("client", opts.clientId);
  if (opts.dealId) params.set("deal", opts.dealId);
  const query = params.toString();
  return `/${slug}/quotes/new${query ? `?${query}` : ""}`;
}

/**
 * «Crear presupuesto» desde un deal o la ficha de un cliente. Con `dealId`, el editor parte del
 * deal: su cliente, su título y sus importes estimados (puntual y mensual) como primeras líneas.
 */
export function CreateQuoteButton({
  slug,
  dealId,
  clientId,
  variant = "outline",
  size = "sm",
  className,
}: {
  slug: string;
  dealId?: string | null;
  clientId?: string | null;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const t = useTranslations("quotes");
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={newQuoteHref(slug, { dealId, clientId })}>
        <FileText data-icon="inline-start" />
        {t("create")}
      </Link>
    </Button>
  );
}
