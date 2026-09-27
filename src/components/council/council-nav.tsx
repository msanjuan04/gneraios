"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Secciones del consejo: el feed, el briefing semanal, el cierre mensual y (owners) las ejecuciones. */
export function CouncilNav({ basePath, isOwner }: { basePath: string; isOwner: boolean }) {
  const t = useTranslations("council.nav");
  const pathname = usePathname();
  const root = `${basePath}/council`;
  const tabs = [
    { href: root, label: t("feed"), exact: true },
    { href: `${root}/briefing`, label: t("briefing"), exact: false },
    { href: `${root}/close`, label: t("close"), exact: false },
    ...(isOwner ? [{ href: `${root}/runs`, label: t("runs"), exact: false }] : []),
  ];
  return (
    <nav aria-label={t("label")} className="-mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="flex w-fit gap-1 rounded-full border bg-card/60 p-1">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
