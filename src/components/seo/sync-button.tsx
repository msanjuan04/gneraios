"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { syncSeoNow } from "@/app/[org]/seo/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Sincroniza con Google ahora. Si queda histórico por cargar, lo sigue el cron diario. */
export function SyncButton({ slug, variant = "outline", className }: { slug: string; variant?: "outline" | "ghost" | "secondary"; className?: string }) {
  const t = useTranslations("seo.sync");
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      const result = await syncSeoNow(slug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.errors > 0) toast.warning(t("partialErrors", { count: result.errors }));
      else if (result.pending) toast.success(t("pending"));
      else toast.success(t("done", { rows: result.rows }));
    });

  return (
    <Button variant={variant} size="sm" onClick={run} disabled={pending} className={className}>
      <RefreshCw data-icon="inline-start" className={cn(pending && "animate-spin")} />
      {pending ? t("running") : t("now")}
    </Button>
  );
}
