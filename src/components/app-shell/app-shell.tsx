"use client";

import { Eye } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { CommandMenu } from "./command-menu";
import { navItems } from "./nav-config";
import type { OrgModules } from "@/domain/org";
import { type ShellMember, type ShellOrg, type ShellOrgOption, ShellProvider, useShell } from "./shell-context";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { Topbar } from "./topbar";
import { useHotkeys } from "./use-hotkeys";

type AppShellProps = {
  org: ShellOrg;
  member: ShellMember;
  orgs: ShellOrgOption[];
  basePath: string;
  modules: OrgModules;
  preview?: boolean;
  sidebarOpen?: boolean;
  children: ReactNode;
};

export function AppShell({ children, sidebarOpen = true, preview = false, ...data }: AppShellProps) {
  return (
    <ShellProvider {...data} preview={preview}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <Topbar />
          {preview && <PreviewBanner />}
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </SidebarInset>
        <CommandMenu />
        <ShortcutsDialog />
        <GlobalHotkeys />
        <RememberLastOrg />
      </SidebarProvider>
    </ShellProvider>
  );
}

function GlobalHotkeys() {
  const router = useRouter();
  const { basePath, modules, commandOpen, setCommandOpen, setShortcutsOpen } = useShell();

  const navigation = Object.fromEntries(
    navItems(modules).filter((i) => i.shortcut).map((i) => [i.shortcut!, () => router.push(`${basePath}${i.path}`)]),
  );

  useHotkeys({
    "$mod+KeyK": (event) => {
      event.preventDefault();
      setCommandOpen(!commandOpen);
    },
    "Shift+?": () => setShortcutsOpen(true),
    ...navigation,
  });
  return null;
}

/** La raíz (/) abre la última org usada. */
function RememberLastOrg() {
  const { org, preview } = useShell();
  useEffect(() => {
    if (!preview) document.cookie = `last_org=${org.slug}; path=/; max-age=31536000; samesite=lax`;
  }, [org.slug, preview]);
  return null;
}

function PreviewBanner() {
  const t = useTranslations("preview");
  return (
    <div className="flex items-center gap-2 border-b bg-primary/10 px-4 py-2 text-xs font-medium text-primary md:px-8">
      <Eye className="size-3.5" />
      {t("banner")}
      <Link href="/login" className="ml-auto shrink-0 font-semibold underline-offset-4 hover:underline">
        {t("openRealApp")}
      </Link>
      <Link href="/preview/onboarding" className="hidden shrink-0 font-semibold underline-offset-4 hover:underline sm:inline">
        {t("seeOnboarding")}
      </Link>
    </div>
  );
}
