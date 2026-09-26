"use client";

import { useTranslations } from "next-intl";
import type { ClientStatus } from "@/app/[org]/clients/schema";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<ClientStatus, string> = {
  lead: "bg-secondary text-secondary-foreground",
  active: "bg-success/15 text-success",
  paused: "bg-warning/15 text-warning",
  former: "border-border bg-transparent text-muted-foreground",
};

/** Estado derivado del cliente (lead, activo, pausado, ex-cliente). Nunca se guarda. */
export function ClientStatusBadge({ status, className }: { status: ClientStatus; className?: string }) {
  const t = useTranslations("crm.clientStatus");
  return <Badge className={cn(STATUS_STYLES[status], className)}>{t(status)}</Badge>;
}
