"use client";

import { Moon, Search, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { TimerControl } from "@/components/projects/timer-control";
import { InboxBell } from "./inbox-bell";
import { activeNavKey } from "./nav-config";
import { useShell } from "./shell-context";

export function Topbar() {
  const t = useTranslations("nav");
  const tTheme = useTranslations("theme");
  const { basePath, setCommandOpen } = useShell();
  const active = activeNavKey(usePathname(), basePath);
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 rounded-t-xl border-b px-3 glass">
      <SidebarTrigger className="-ml-1" aria-label={t("toggleSidebar")} />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <h1 className="min-w-0 truncate text-sm font-semibold">{t(active)}</h1>
      <div className="ml-auto flex items-center gap-1.5">
        {/* El temporizador de horas (proyectos): se oculta solo para viewers y en /preview. */}
        <TimerControl />
        <Button
          variant="outline"
          size="sm"
          aria-label={t("search")}
          className="justify-between font-medium text-muted-foreground sm:w-64"
          onClick={() => setCommandOpen(true)}
        >
          <span className="flex items-center gap-2">
            <Search />
            <span className="hidden sm:inline">{t("search")}</span>
          </span>
          <KbdGroup className="hidden sm:inline-flex">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
        <InboxBell />
        {/* En el móvil no cabe: el tema también está en ⌘K y en Ajustes → Preferencias. */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden sm:inline-flex"
          aria-label={tTheme("toggle")}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </div>
    </header>
  );
}
