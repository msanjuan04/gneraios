"use client";

import { Building2, FileSignature, FileText, Keyboard, Languages, LogOut, Moon, Receipt, SquareKanban, Sun, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState, useTransition } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { localeNames, locales } from "@/i18n/config";
import { type SearchResult, searchOrg } from "@/server/crm/search";
import { setLocale } from "@/server/preferences";
import { ALL_NAV_ITEMS } from "./nav-config";
import { useShell } from "./shell-context";

// Acciones de creación (en /preview, sin base de datos, se ven desactivadas).
const CREATE_ACTIONS = [
  { key: "newClient", icon: Building2, path: "/clients?new=1" },
  { key: "newDeal", icon: SquareKanban, path: "/pipeline?new=1" },
  { key: "newContract", icon: FileSignature, path: "/contracts?new=1" },
  { key: "newInvoice", icon: Receipt, path: "/invoices/new" },
  { key: "newQuote", icon: FileText, path: "/quotes/new" },
] as const;

const RESULT_ICONS = { client: Building2, contact: UserRound, deal: SquareKanban, contract: FileSignature, invoice: Receipt, quote: FileText } as const;

function resultPath(r: SearchResult): string {
  if (r.kind === "deal") return `/pipeline?deal=${r.id}`;
  if (r.kind === "contract") return `/contracts/${r.id}`;
  if (r.kind === "invoice") return `/invoices/${r.id}`;
  if (r.kind === "quote") return `/quotes/${r.id}`;
  return `/clients/${r.clientId}`;
}

/** POST real a /auth/signout (responde 303 → /login): navegación completa, sin estado viejo en el cliente. */
export function signOut() {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/auth/signout";
  document.body.appendChild(form);
  form.submit();
}

export function CommandMenu() {
  const t = useTranslations("commandMenu");
  const tNav = useTranslations("nav");
  const tUser = useTranslations("user");
  const tShortcuts = useTranslations("shortcuts");
  const { org, basePath, commandOpen, setCommandOpen, setShortcutsOpen, preview } = useShell();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const router = useRouter();
  const { setTheme } = useTheme();
  const locale = useLocale();
  const [, startTransition] = useTransition();

  const run = (fn: () => void) => {
    setCommandOpen(false);
    setQuery("");
    fn();
  };

  // Búsqueda en el servidor con un pequeño retardo mientras se escribe.
  const q = query.trim();
  useEffect(() => {
    if (preview || q.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      void searchOrg(org.slug, q).then((r) => alive && setResults(r));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, org.slug, preview]);
  const visibleResults = q.length >= 2 ? results : [];

  return (
    <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} title={tNav("search")} description={t("placeholder")}>
      <Command className="glass">
        <CommandInput placeholder={t("placeholder")} value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{t("empty")}</CommandEmpty>
          {visibleResults.length > 0 && (
            <>
              <CommandGroup heading={t("groupResults")}>
                {visibleResults.map((r) => {
                  const Icon = RESULT_ICONS[r.kind];
                  return (
                    <CommandItem
                      key={`${r.kind}-${r.id}`}
                      // El texto buscado va en el valor para que cmdk no oculte lo que ya filtró el servidor.
                      value={`${r.kind} ${r.id} ${r.title} ${r.subtitle ?? ""} ${q}`}
                      onSelect={() => run(() => router.push(`${basePath}${resultPath(r)}`))}
                    >
                      <Icon />
                      <span className="truncate">{r.title}</span>
                      {r.subtitle && <span className="truncate text-xs text-muted-foreground">{r.subtitle}</span>}
                      <span className="ml-auto text-[11px] text-muted-foreground">{t(`kind.${r.kind}`)}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading={t("groupGo")}>
            {ALL_NAV_ITEMS.map((item) => (
              <CommandItem key={item.key} value={tNav(item.key)} onSelect={() => run(() => router.push(`${basePath}${item.path}`))}>
                <item.icon />
                {tNav(item.key)}
                {item.shortcut && <CommandShortcut>{item.shortcut.toUpperCase()}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={t("groupCreate")}>
            {CREATE_ACTIONS.map((action) => (
              <CommandItem
                key={action.key}
                value={t(action.key)}
                disabled={preview}
                onSelect={() => run(() => router.push(`${basePath}${action.path}`))}
              >
                <action.icon />
                {t(action.key)}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading={t("groupPreferences")}>
            <CommandItem value={t("themeDark")} onSelect={() => run(() => setTheme("dark"))}>
              <Moon />
              {t("themeDark")}
            </CommandItem>
            <CommandItem value={t("themeLight")} onSelect={() => run(() => setTheme("light"))}>
              <Sun />
              {t("themeLight")}
            </CommandItem>
            {locales
              .filter((l) => l !== locale)
              .map((l) => (
                <CommandItem
                  key={l}
                  value={t("language", { language: localeNames[l] })}
                  onSelect={() =>
                    run(() =>
                      startTransition(async () => {
                        await setLocale(l);
                        router.refresh();
                      }),
                    )
                  }
                >
                  <Languages />
                  {t("language", { language: localeNames[l] })}
                </CommandItem>
              ))}
            <CommandItem value={tShortcuts("title")} onSelect={() => run(() => setShortcutsOpen(true))}>
              <Keyboard />
              {tShortcuts("title")}
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          {!preview && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("groupAccount")}>
                <CommandItem value={tUser("signOut")} onSelect={() => run(signOut)}>
                  <LogOut />
                  {tUser("signOut")}
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
