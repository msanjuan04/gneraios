"use client";

import { RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { archiveAdsAccount, refreshAdsAccount } from "@/app/[org]/ads/actions";
import { Button } from "@/components/ui/button";

/** «Actualizar»: pide las cifras a la plataforma ahora mismo y vuelve a pintar la página. */
export function RefreshAccountButton({ slug, accountId }: { slug: string; accountId: string }) {
  const t = useTranslations("ads");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await refreshAdsAccount(slug, accountId);
          if (!result.ok) toast.error(result.error);
          else if (result.error) toast.error(t("section.error", { message: result.error }));
          else toast.success(t("refreshed"));
          router.refresh();
        })
      }
    >
      <RefreshCw data-icon="inline-start" className={pending ? "animate-spin" : undefined} />
      {pending ? t("refreshing") : t("refresh")}
    </Button>
  );
}

/** «Quitar cuenta» con confirmación en línea (sin modal encima de la página). */
export function ArchiveAccountButton({ slug, accountId }: { slug: string; accountId: string }) {
  const t = useTranslations("ads.section");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 data-icon="inline-start" />
        {t("archive")}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="max-w-72">{t("archiveConfirm")}</span>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
        {tCommon("cancel")}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await archiveAdsAccount(slug, accountId);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(t("archived"));
            router.refresh();
          })
        }
      >
        {t("archive")}
      </Button>
    </span>
  );
}
