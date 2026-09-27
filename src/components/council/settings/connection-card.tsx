import { CircleCheck, CircleDashed, KeyRound, ReceiptText } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

/**
 * Si el consejo puede trabajar: la clave de la API y el cron (solo se dice si están, nunca su valor).
 * Sin clave, los pasos para conectarlo.
 */
export async function ConnectionCard({ configured, cronConfigured, basePath, isOwner }: { configured: boolean; cronConfigured: boolean; basePath: string; isOwner: boolean }) {
  const t = await getTranslations("council.settings.connection");
  const items = [
    { key: "apiKey", ok: configured },
    { key: "cron", ok: cronConfigured },
  ] as const;
  return (
    <section aria-labelledby="council-connection" className={cn("rounded-2xl border px-5 py-4 text-sm", configured ? "bg-card" : "border-warning/40 bg-warning/5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="council-connection" className="flex items-center gap-2 font-bold">
            <KeyRound aria-hidden className={cn("size-4", configured ? "text-primary" : "text-warning")} />
            {configured ? t("readyTitle") : t("missingTitle")}
          </h3>
          <p className="mt-1 text-muted-foreground">{configured ? t("readyBody") : t("missingBody")}</p>
        </div>
        {isOwner && (
          <Link href={`${basePath}/council/runs`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
            <ReceiptText aria-hidden className="size-3.5" />
            {t("runsLink")}
          </Link>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.key} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", item.ok ? "text-success" : "text-muted-foreground")}>
            {item.ok ? <CircleCheck aria-hidden className="size-3.5" /> : <CircleDashed aria-hidden className="size-3.5" />}
            {t(`${item.key}.${item.ok ? "ok" : "missing"}`)}
          </li>
        ))}
      </ul>
      {!configured && (
        <ol className="mt-4 space-y-2 text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">1.</span> {t("steps.key")}
            <code className="mt-1 block rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground select-all">ANTHROPIC_API_KEY=sk-ant-…</code>
          </li>
          <li>
            <span className="font-semibold text-foreground">2.</span> {t("steps.cron")}
            <code className="mt-1 block rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all text-foreground select-all">POST /api/cron/council · Authorization: Bearer $CRON_SECRET · 0 * * * *</code>
          </li>
          <li>
            <span className="font-semibold text-foreground">3.</span> {t("steps.policy")}
          </li>
        </ol>
      )}
    </section>
  );
}
