"use client";

import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { setClientManualStatus } from "@/app/[org]/clients/actions";
import type { ClientStatus } from "@/app/[org]/clients/schema";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CLIENT_MANUAL_STATUSES, type ClientManualStatus, derivedAsManual, effectiveClientStatus, manualDiffers } from "@/domain/clients/status";
import { cn } from "@/lib/utils";
import { STATUS_STYLES } from "./client-status-badge";

const DOTS: Record<ClientManualStatus, string> = {
  pending_contact: "bg-primary",
  lead: "bg-secondary-foreground/50",
  active: "bg-success",
  paused: "bg-warning",
  finished: "bg-muted-foreground/50",
  discarded: "bg-muted-foreground/25",
};

/**
 * En la ficha, para socios: el estado se elige a mano o se deja en «Automático» (el que sale de
 * los contratos). Si el elegido no coincide con los contratos, se dice al lado sin cambiar nada.
 */
export function ClientStatusControl({
  slug,
  clientId,
  status,
  manual,
  manualAt,
  disabled,
}: {
  slug: string;
  clientId: string;
  status: ClientStatus;
  manual: ClientManualStatus | null;
  manualAt: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations("crm.clientStatus");
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const shown = effectiveClientStatus(status, manual);

  const choose = (next: ClientManualStatus | null) =>
    startTransition(async () => {
      const result = await setClientManualStatus(slug, clientId, next);
      if (!result.ok) toast.error(result.error);
      else toast.success(next ? t("changed", { status: t(next) }) : t("changedAuto"));
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled || pending}>
          <button
            type="button"
            className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            aria-label={t("change")}
          >
            <Badge className={cn("cursor-pointer gap-1 pr-1.5", STATUS_STYLES[shown])}>
              {manual && <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />}
              {t(shown)}
              <ChevronDown className="size-3 opacity-70" />
            </Badge>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{t("change")}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => choose(null)} className="gap-2">
            <Sparkles className="size-3.5 text-muted-foreground" />
            <span className="flex-1">{t("auto", { status: t(derivedAsManual(status)) })}</span>
            {!manual && <Check className="size-3.5" />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {CLIENT_MANUAL_STATUSES.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => choose(s)} className="gap-2">
              <span aria-hidden className={cn("size-2 rounded-full", DOTS[s])} />
              <span className="flex-1">{t(s)}</span>
              {manual === s && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {manual && manualAt && (
        <span className="text-xs text-muted-foreground">{t("since", { date: format.dateTime(new Date(manualAt), { dateStyle: "medium" }) })}</span>
      )}
      {manualDiffers(status, manual) && (
        <span className="text-xs text-muted-foreground">· {t("calculated", { status: t(derivedAsManual(status)) })}</span>
      )}
    </span>
  );
}
