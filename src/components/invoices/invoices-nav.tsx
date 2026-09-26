"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Facturas y la bandeja «Por enviar» (recordatorios por aprobar), con su contador. */
export function InvoicesNav({ basePath, outboxCount }: { basePath: string; outboxCount: number }) {
  const t = useTranslations("invoices.nav");
  const pathname = usePathname();
  const tabs = [
    { href: `${basePath}/invoices`, label: t("list"), count: 0 },
    { href: `${basePath}/invoices/outbox`, label: t("outbox"), count: outboxCount },
  ];
  return (
    <nav aria-label={t("label")} className="mb-6 flex w-fit gap-1 rounded-full border bg-card/60 p-1">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
              active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] leading-5 font-bold text-primary-foreground tabular">
                {tab.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
