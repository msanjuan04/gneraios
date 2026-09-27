"use client";

import { AlertTriangle, House, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Lo que se ve cuando una pantalla falla (error.tsx): el resto de la app sigue ahí. Enseña el
 * código del error (el `digest` que Next deja en los logs del servidor) para poder buscarlo.
 */
export function ErrorPanel({ error, retry, homeHref }: { error: Error & { digest?: string }; retry: () => void; homeHref: string }) {
  const t = useTranslations("errorBoundary");
  useEffect(() => {
    console.error("[pantalla]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="gos-rise w-full max-w-md rounded-3xl border bg-card/60 p-8 text-center shadow-[0_40px_120px_-60px_rgb(46_128_255/0.45)] backdrop-blur-xl">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-warning/15 text-warning">
          <AlertTriangle className="size-6" />
        </span>
        <h2 className="mt-5 text-xl font-bold heading-tight">{t("title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("body")}</p>
        {error.digest && (
          <code className="mt-3 inline-block rounded-lg bg-muted px-2 py-1 font-mono text-xs text-muted-foreground select-all">{error.digest}</code>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()} className="rounded-full">
            <RotateCcw data-icon="inline-start" />
            {t("retry")}
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href={homeHref}>
              <House data-icon="inline-start" />
              {t("home")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
