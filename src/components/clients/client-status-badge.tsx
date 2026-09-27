"use client";

import { useTranslations } from "next-intl";
import type { ClientStatus } from "@/app/[org]/clients/schema";
import { Badge } from "@/components/ui/badge";
import { type ClientManualStatus, effectiveClientStatus } from "@/domain/clients/status";
import { cn } from "@/lib/utils";

export const STATUS_STYLES: Record<ClientManualStatus, string> = {
  pending_contact: "bg-primary/15 text-primary",
  lead: "bg-secondary text-secondary-foreground",
  active: "bg-success/15 text-success",
  paused: "bg-warning/15 text-warning",
  finished: "border-border bg-transparent text-muted-foreground",
  discarded: "border-border bg-transparent text-muted-foreground line-through decoration-muted-foreground/40",
};

/**
 * Estado del cliente: el que un socio ha marcado a mano o, si no, el que se calcula con sus
 * contratos (src/domain/clients/status.ts). El marcado a mano lleva un punto para distinguirlo.
 */
export function ClientStatusBadge({
  status,
  manual,
  className,
}: {
  status: ClientStatus;
  manual?: ClientManualStatus | null;
  className?: string;
}) {
  const t = useTranslations("crm.clientStatus");
  const shown = effectiveClientStatus(status, manual);
  return (
    <Badge className={cn("gap-1", STATUS_STYLES[shown], className)} title={manual ? t("manualHint") : t("autoHint")}>
      {manual && <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />}
      {t(shown)}
    </Badge>
  );
}
