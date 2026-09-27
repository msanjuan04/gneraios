"use client";

import { FolderPlus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/** Ruta del alta de un proyecto con el cliente, el contrato y el nombre ya elegidos. */
export function newProjectHref(slug: string, opts: { clientId?: string | null; contractId?: string | null; name?: string | null; templateId?: string | null } = {}): string {
  const params = new URLSearchParams({ new: "1" });
  if (opts.clientId) params.set("client", opts.clientId);
  if (opts.contractId) params.set("contract", opts.contractId);
  if (opts.name) params.set("name", opts.name.slice(0, 200));
  if (opts.templateId) params.set("template", opts.templateId);
  return `/${slug}/projects?${params.toString()}`;
}

/**
 * «Crear proyecto» desde la ficha de un contrato, un presupuesto o un cliente: abre el alta con el
 * cliente y el contrato ya elegidos (el contrato es el que da lo facturado y la tarifa efectiva).
 */
export function CreateProjectButton({
  slug,
  clientId,
  contractId,
  defaultName,
  variant = "outline",
  size = "sm",
  className,
}: {
  slug: string;
  clientId: string;
  contractId?: string | null;
  defaultName?: string | null;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const t = useTranslations("projects");
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={newProjectHref(slug, { clientId, contractId, name: defaultName })}>
        <FolderPlus data-icon="inline-start" />
        {t("createProject")}
      </Link>
    </Button>
  );
}
