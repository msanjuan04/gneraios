"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { syncMailNow } from "@/app/[org]/mail/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Traer el correo nuevo ahora. El cron lo hace solo cada pocos minutos; esto es para no esperar. */
export function MailSyncButton({ slug }: { slug: string }) {
  const t = useTranslations("mail");
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await syncMailNow(slug);
          if (result.ok) toast.success(result.fetched > 0 ? t("syncedCount", { count: result.fetched }) : t("syncedNothing"));
          else toast.error(result.error);
        })
      }
    >
      <RefreshCw data-icon="inline-start" className={cn(pending && "animate-spin")} />
      {pending ? t("syncing") : t("sync")}
    </Button>
  );
}
