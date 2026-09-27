"use client";

import { FileUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useShell } from "@/components/app-shell/shell-context";
import { Button } from "@/components/ui/button";
import { InvoiceImportSheet } from "./invoice-import-sheet";

/**
 * Botón «Importar facturas emitidas» y su panel. En Facturas, sin cliente; en la ficha de un
 * cliente o en un proyecto, con `clientId` (todas las facturas serán de ese cliente) y, en el
 * proyecto, `projectId` (para volver a pintarlo al guardar). Solo lo ven los socios: el servidor
 * lo vuelve a comprobar en cada paso.
 */
export function InvoiceImportButton({
  slug,
  clientId = null,
  projectId = null,
  variant = "outline",
  size = "default",
  label,
}: {
  slug: string;
  clientId?: string | null;
  projectId?: string | null;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "xs";
  /** Texto del botón; por defecto «Importar facturas emitidas» (o «Adjuntar facturas» en un cliente). */
  label?: string;
}) {
  const t = useTranslations("invoiceImport.button");
  const { member } = useShell();
  const [open, setOpen] = useState(false);
  if (member.role === "viewer") return null;
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        <FileUp data-icon="inline-start" />
        {label ?? (clientId ? t("client") : t("label"))}
      </Button>
      <InvoiceImportSheet slug={slug} clientId={clientId} projectId={projectId} open={open} onOpenChange={setOpen} />
    </>
  );
}
