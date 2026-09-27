"use client";

import { MoreHorizontal, Pause, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/app-shell/shell-context";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { checkSiteNow, deleteSite, setSiteActive } from "@/server/sites/actions";
import { useSiteFormat } from "./format";
import type { SiteListItem } from "./types";

/** «Comprobar ahora»: comprueba al momento y dice qué ha visto. */
export function useCheckNow(slug: string) {
  const t = useTranslations("sites.actions");
  const fmt = useSiteFormat();
  const { preview } = useShell();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const check = (site: Pick<SiteListItem, "id" | "name">) => {
    if (preview) {
      toast.info(t("previewOnly"));
      return;
    }
    setPendingId(site.id);
    startTransition(async () => {
      const result = await checkSiteNow(slug, site.id);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { check: c } = result;
      if (c.ok) toast.success(t("checkedUp", { name: site.name, time: c.responseMs === null ? "—" : fmt.ms(c.responseMs) }));
      else toast.error(t("checkedDown", { name: site.name, reason: fmt.error(c.error, c.statusCode) }));
    });
  };
  return { check, pendingId };
}

export function CheckNowButton({
  onClick,
  pending,
  variant = "icon",
  className,
}: {
  onClick: () => void;
  pending: boolean;
  variant?: "icon" | "full";
  className?: string;
}) {
  const t = useTranslations("sites.actions");
  if (variant === "full") {
    return (
      <Button onClick={onClick} disabled={pending} className={className}>
        <RefreshCw data-icon="inline-start" className={cn(pending && "animate-spin")} />
        {pending ? t("checking") : t("checkNow")}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} disabled={pending} aria-label={t("checkNow")} className={className}>
          <RefreshCw className={cn(pending && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{pending ? t("checking") : t("checkNow")}</TooltipContent>
    </Tooltip>
  );
}

/** Editar, pausar o reanudar y quitar una web. Quitarla pide confirmación (desde la página, no desde el menú). */
export function SiteActionsMenu({
  slug,
  site,
  onEdit,
  onDeleted,
  className,
}: {
  slug: string;
  site: SiteListItem;
  onEdit: () => void;
  onDeleted?: () => void;
  className?: string;
}) {
  const t = useTranslations("sites.actions");
  const { preview } = useShell();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggleActive = () => {
    if (preview) {
      toast.info(t("previewOnly"));
      return;
    }
    startTransition(async () => {
      const result = await setSiteActive(slug, site.id, !site.isActive);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(site.isActive ? t("paused", { name: site.name }) : t("resumed", { name: site.name }));
    });
  };

  const remove = () => {
    if (preview) {
      toast.info(t("previewOnly"));
      return;
    }
    startTransition(async () => {
      const result = await deleteSite(slug, site.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirmOpen(false);
      toast.success(t("deleted", { name: site.name }));
      onDeleted?.();
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t("more", { name: site.name })} className={className} disabled={pending}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            {t("edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleActive}>
            {site.isActive ? <Pause /> : <Play />}
            {site.isActive ? t("pause") : t("resume")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <Trash2 />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("deleteTitle", { name: site.name })}
        description={t("deleteBody")}
        confirmLabel={t("delete")}
        onConfirm={remove}
        pending={pending}
      />
    </>
  );
}
