"use client";

import { Check, ChevronsUpDown, Keyboard, LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Isotype } from "@/components/brand/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { signOut } from "./command-menu";
import { activeNavKey, navGroups, SETTINGS_ITEM } from "./nav-config";
import { useShell } from "./shell-context";

export function AppSidebar() {
  const t = useTranslations("nav");
  const { basePath, modules } = useShell();
  const active = activeNavKey(usePathname(), basePath);

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {navGroups(modules).map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{t(group.label)}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton asChild isActive={active === item.key} tooltip={t(item.key)}>
                    <Link href={`${basePath}${item.path}`}>
                      <item.icon />
                      <span>{t(item.key)}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.hito && (
                    <SidebarMenuBadge className="text-[10px] font-semibold text-muted-foreground">{item.hito}</SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={active === "settings"} tooltip={t("settings")}>
              <Link href={`${basePath}${SETTINGS_ITEM.path}`}>
                <SETTINGS_ITEM.icon />
                <span>{t("settings")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function OrgSwitcher() {
  const t = useTranslations("nav");
  const { org, orgs, preview } = useShell();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={t("switchOrg")} className="data-[state=open]:bg-sidebar-accent">
              <div className="flex size-8 items-center justify-center rounded-lg bg-black/90 ring-1 ring-white/10 dark:bg-white/5">
                <Isotype size={20} className="brightness-100" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-extrabold tracking-tight">{org.name}</span>
                <span className="truncate text-xs text-muted-foreground">GNERAI OS</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t("switchOrg")}</DropdownMenuLabel>
            {orgs.map((o) => (
              <DropdownMenuItem key={o.slug} asChild disabled={preview}>
                <Link href={preview ? "#" : `/${o.slug}`}>
                  {o.name}
                  {o.slug === org.slug && <Check className="ml-auto" />}
                </Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function UserMenu() {
  const t = useTranslations("user");
  const tRoles = useTranslations("roles");
  const tTheme = useTranslations("theme");
  const { member, basePath, preview, setShortcutsOpen } = useShell();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={t("menu")} className="data-[state=open]:bg-sidebar-accent">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">
            {member.initials}
          </span>
          <div className="grid flex-1 text-left leading-tight">
            <span className="truncate text-sm font-semibold">{member.fullName}</span>
            <span className="truncate text-xs text-muted-foreground">{tRoles(member.role)}</span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuItem asChild>
          <Link href={`${basePath}/settings/preferences`}>
            <UserRound />
            {t("preferences")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
          <Keyboard />
          {t("shortcuts")}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Moon />
            {tTheme("label")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="dark">
                <Moon />
                {tTheme("dark")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">
                <Sun />
                {tTheme("light")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor />
                {tTheme("system")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {!preview && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut}>
              <LogOut />
              {t("signOut")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
