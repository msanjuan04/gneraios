import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

const TABS = ["new", "postponed", "accepted", "history"] as const;

/** Pestañas del feed: nuevas (y las pospuestas que vuelven hoy), pospuestas, aceptadas y el historial. */
export async function FeedTabs({ basePath, active, counts }: { basePath: string; active: (typeof TABS)[number]; counts: Record<(typeof TABS)[number], number> }) {
  const t = await getTranslations("council.tabs");
  return (
    <nav aria-label={t("label")} className="mb-4 flex w-fit flex-wrap gap-1 rounded-full border bg-card/60 p-1">
      {TABS.map((tab) => (
        <Link
          key={tab}
          href={tab === "new" ? `${basePath}/council` : `${basePath}/council?tab=${tab}`}
          scroll={false}
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8rem] font-semibold transition-colors",
            tab === active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(tab)}
          {counts[tab] > 0 && (
            <span className={cn("tabular", tab === "new" ? "inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] leading-5 font-bold text-primary-foreground" : "text-muted-foreground")}>
              {counts[tab]}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
