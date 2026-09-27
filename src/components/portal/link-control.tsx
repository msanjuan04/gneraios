"use client";

import { Ban, Check, Copy, ExternalLink, Eye, Link2, RefreshCw } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { InlineConfirm } from "@/components/quotes/inline-confirm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { renewLink, revokeLink } from "@/server/portal/actions";
import type { LinkStatus, ShareLinkView } from "./types";
import { notAfter } from "@/lib/relative-time";

const STATUS_STYLES: Record<LinkStatus, string> = {
  active: "bg-success/15 text-success",
  expired: "bg-warning/15 text-warning",
  revoked: "bg-muted text-muted-foreground",
};

type Confirm = "rotate" | "revoke" | null;

/**
 * Crear, copiar, revocar y renovar un enlace público. El token solo existe en la respuesta de
 * crearlo: se enseña (y se copia) en ese momento y no se puede recuperar después; si se pierde,
 * se crea otro y el anterior deja de funcionar. Las visitas no cuentan las de los miembros.
 */
export function LinkControl({
  slug,
  link: initial,
  canAct,
  blockedReason,
  renewable,
  create,
}: {
  slug: string;
  link: ShareLinkView | null;
  canAct: boolean;
  /** Por qué no se puede crear un enlace ahora (p. ej. un presupuesto en borrador). */
  blockedReason?: string | null;
  /** El portal de un cliente se renueva; el de un presupuesto caduca con su validez. */
  renewable: boolean;
  create: () => Promise<ActionResult<{ url: string; link: ShareLinkView }>>;
}) {
  const t = useTranslations("portal.link");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [link, setLink] = useState(initial);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, startTransition] = useTransition();
  const [serverLink, setServerLink] = useState(initial);
  if (initial !== serverLink) {
    setServerLink(initial);
    setLink(initial);
  }

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const canCreate = canAct && !blockedReason;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(t("copied"));
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Sin portapapeles: el enlace está a la vista para copiarlo a mano.
    }
  };

  const onCreate = () =>
    startTransition(async () => {
      const result = await create();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirm(null);
      setLink(result.link);
      setFresh(result.url);
      void copy(result.url);
    });

  const onRevoke = () =>
    startTransition(async () => {
      if (!link) return;
      const result = await revokeLink(slug, link.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirm(null);
      setFresh(null);
      setLink({ ...link, status: "revoked" });
      toast.success(t("revoked"));
    });

  const onRenew = () =>
    startTransition(async () => {
      if (!link) return;
      const result = await renewLink(slug, link.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLink({ ...link, status: "active", expiresAt: result.expiresAt });
      toast.success(t("renewed", { date: date(result.expiresAt) }));
    });

  return (
    <div className="space-y-3">
      {fresh && (
        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Link2 className="size-4 text-primary" />
            {t("freshTitle")}
          </p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={fresh}
              onFocus={(e) => e.currentTarget.select()}
              // Dentro del formulario del presupuesto: Enter no lo guarda.
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              aria-label={t("freshTitle")}
              className="bg-background font-mono text-xs"
            />
            <Button type="button" size="sm" onClick={() => copy(fresh)}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {t("copy")}
            </Button>
            <Button type="button" size="icon-sm" variant="outline" asChild>
              <a href={fresh} target="_blank" rel="noopener noreferrer" aria-label={t("open")}>
                <ExternalLink />
              </a>
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("freshNotice")}</p>
        </div>
      )}

      {link ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn(STATUS_STYLES[link.status])}>{t(`status.${link.status}`)}</Badge>
              <span className="text-xs text-muted-foreground">
                {link.createdBy ? t("createdBy", { date: date(link.createdAt), name: link.createdBy }) : t("created", { date: date(link.createdAt) })}
              </span>
            </div>
            {link.status !== "revoked" && (
              <p className="text-xs text-muted-foreground">
                {link.status === "expired" ? t("expiredOn", { date: date(link.expiresAt) }) : t("expires", { date: date(link.expiresAt) })}
              </p>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t("viewsHint")}>
              <Eye className="size-3.5" />
              {t("views", { count: link.viewCount })}
              {link.lastViewedAt && <> · {t("lastView", { when: format.relativeTime(notAfter(new Date(link.lastViewedAt), now), now) })}</>}
            </p>
          </div>
          {canAct && (
            <div className="flex flex-wrap gap-2">
              {renewable && link.status !== "revoked" && (
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onRenew}>
                  <RefreshCw data-icon="inline-start" />
                  {t("renew")}
                </Button>
              )}
              {link.status === "active" && (
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirm("revoke")} className="hover:text-destructive">
                  <Ban data-icon="inline-start" />
                  {t("revoke")}
                </Button>
              )}
              {canCreate && (
                <Button
                  type="button"
                  variant={link.status === "active" ? "outline" : "default"}
                  size="sm"
                  disabled={pending}
                  onClick={() => (link.status === "active" ? setConfirm("rotate") : onCreate())}
                >
                  <Link2 data-icon="inline-start" />
                  {pending && confirm === null ? t("creating") : t("createNew")}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground">{t("none")}</p>
          {canCreate && (
            <Button type="button" size="sm" disabled={pending} onClick={onCreate}>
              <Link2 data-icon="inline-start" />
              {pending ? t("creating") : t("create")}
            </Button>
          )}
        </div>
      )}

      {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}

      {confirm === "rotate" && (
        <InlineConfirm tone="warning" icon={<Link2 className="text-warning" />} confirmLabel={t("createNewAction")} onConfirm={onCreate} onCancel={() => setConfirm(null)} pending={pending}>
          {t("createNewConfirm")}
        </InlineConfirm>
      )}
      {confirm === "revoke" && (
        <InlineConfirm tone="destructive" icon={<Ban className="text-destructive" />} confirmLabel={t("revokeAction")} onConfirm={onRevoke} onCancel={() => setConfirm(null)} pending={pending}>
          {t("revokeConfirm")}
        </InlineConfirm>
      )}
    </div>
  );
}
