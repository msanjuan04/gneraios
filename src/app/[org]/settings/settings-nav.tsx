"use client";

import {
  BrainCircuit,
  DatabaseZap,
  Landmark,
  type LucideIcon,
  Package,
  Percent,
  ReceiptEuro,
  SlidersHorizontal,
  SquareKanban,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import type { OrgModules } from "@/domain/org";
import { cn } from "@/lib/utils";

const TABS: {
  key: "general" | "issuers" | "taxes" | "catalog" | "expenses" | "pipeline" | "council" | "data" | "team" | "preferences";
  path: string;
  icon: LucideIcon;
}[] = [
  { key: "general", path: "", icon: SlidersHorizontal },
  { key: "issuers", path: "/issuers", icon: Landmark },
  { key: "taxes", path: "/taxes", icon: Percent },
  { key: "catalog", path: "/catalog", icon: Package },
  { key: "expenses", path: "/expenses", icon: ReceiptEuro },
  { key: "pipeline", path: "/pipeline", icon: SquareKanban },
  { key: "council", path: "/council", icon: BrainCircuit },
  { key: "data", path: "/data", icon: DatabaseZap },
  { key: "team", path: "/team", icon: Users },
  { key: "preferences", path: "/preferences", icon: UserRound },
];

/** Pestañas de Ajustes como enlaces: cada una tiene su URL y se puede compartir. */
export function SettingsNav({ basePath, modules }: { basePath: string; modules: OrgModules }) {
  // La pestaña de un módulo apagado no se enseña (su página tampoco existe).
  const tabs = TABS.filter((tab) => tab.key !== "council" || modules.council);
  const t = useTranslations("settings");
  const pathname = usePathname();
  const root = `${basePath}/settings`;
  const active =
    TABS.find((tab) => tab.path !== "" && (pathname === root + tab.path || pathname.startsWith(`${root}${tab.path}/`)))
      ?.key ?? "general";
  const activeRef = useRef<HTMLAnchorElement>(null);

  // En móvil las pestañas se desplazan en horizontal: la activa siempre a la vista.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <nav aria-label={t("title")} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="inline-flex min-w-max items-center gap-0.5 rounded-full border bg-card/60 p-1">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                ref={isActive ? activeRef : undefined}
                href={root + tab.path}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  isActive && "bg-secondary text-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]",
                )}
              >
                <tab.icon className={cn("size-4", isActive && "text-primary")} />
                {t(`tabs.${tab.key}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
