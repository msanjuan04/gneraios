"use client";

import { CircleAlert, CircleCheck, KeyRound, Unplug } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { disconnectGoogle } from "@/app/[org]/seo/actions";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import type { SeoIntegrationView } from "@/server/seo/queries";
import { SyncButton } from "./sync-button";

/** La conexión con Google de la org: con qué cuenta, qué permite, cuándo sincronizó y sus acciones. */
export function GoogleConnection({
  slug,
  integration,
  googleConfigured,
  isOwner,
  isPartner,
  startHref,
}: {
  slug: string;
  integration: SeoIntegrationView | null;
  googleConfigured: boolean;
  isOwner: boolean;
  isPartner: boolean;
  startHref: string;
}) {
  const t = useTranslations("seo.connection");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const status = integration?.status ?? null;
  const connected = status === "connected";

  const disconnect = () =>
    startTransition(async () => {
      const result = await disconnectGoogle(slug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("disconnectedToast"));
      setConfirm(false);
    });

  const missing = integration && connected ? [!integration.features.searchConsole && "searchConsole", !integration.features.analytics && "analytics"].filter(Boolean) : [];

  return (
    <SettingsCard
      title={t("title")}
      description={googleConfigured ? t("description") : t("notConfigured")}
      actions={
        <>
          {connected && isPartner && <SyncButton slug={slug} />}
          {isOwner && googleConfigured && (
            <Button asChild variant={connected ? "ghost" : "default"} size="sm">
              <a href={startHref}>
                <KeyRound data-icon="inline-start" />
                {status === null || status === "disconnected" ? t("connect") : t("reconnect")}
              </a>
            </Button>
          )}
        </>
      }
    >
      {status === null || status === "disconnected" ? (
        <p className="text-muted-foreground">{status === "disconnected" ? t("disconnected") : t("never")}</p>
      ) : (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {connected ? (
              <CircleCheck aria-hidden className="size-4 text-success" />
            ) : (
              <CircleAlert aria-hidden className="size-4 text-destructive" />
            )}
            <span className="font-semibold">{connected ? t("connected") : t("error")}</span>
            {integration?.accountEmail && <span className="text-muted-foreground">· {integration.accountEmail}</span>}
          </p>
          {!connected && <p className="text-sm text-destructive">{t("errorBody")}</p>}
          {missing.length > 0 && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
              {t("missingScopes", { features: missing.map((m) => t(`features.${m}`)).join(" · ") })}
            </p>
          )}
          <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("connectedBy")}</dt>
              <dd>
                {integration?.connectedByName ?? "—"}
                {integration?.connectedAt && ` · ${format.dateTime(new Date(integration.connectedAt), { dateStyle: "medium" })}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("lastSync")}</dt>
              <dd>{integration?.lastSyncAt ? format.relativeTime(new Date(integration.lastSyncAt), now) : t("neverSynced")}</dd>
            </div>
            {integration?.lastError && (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t("lastError")}</dt>
                <dd className="break-words text-destructive">{integration.lastError}</dd>
              </div>
            )}
          </dl>
          {isOwner && (
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setConfirm(true)}>
              <Unplug data-icon="inline-start" />
              {t("disconnect")}
            </Button>
          )}
        </div>
      )}
      {isOwner && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t("disconnectTitle")}
          description={t("disconnectBody")}
          confirmLabel={t("disconnect")}
          onConfirm={disconnect}
          pending={pending}
        />
      )}
    </SettingsCard>
  );
}
