import type { OrgModules } from "@/domain/org";
import {
  Activity,
  BrainCircuit,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  KeyRound,
  Landmark,
  LayoutTemplate,
  Megaphone,
  FileSignature,
  FileText,
  FolderKanban,
  LayoutDashboard,
  type LucideIcon,
  Receipt,
  Settings,
  SquareKanban,
  UserRoundSearch,
} from "lucide-react";

export type NavKey =
  | "dashboard"
  | "calendar"
  | "council"
  | "passwords"
  | "seo"
  | "ads"
  | "pipeline"
  | "leads"
  | "clients"
  | "projects"
  | "sites"
  | "quotes"
  | "quoteTemplates"
  | "contracts"
  | "invoices"
  | "finance"
  | "settings";

export type NavItem = {
  key: NavKey;
  /** Ruta relativa a la org: "" es el dashboard. */
  path: string;
  icon: LucideIcon;
  /** Secuencia de teclado (tinykeys), p. ej. "g d". */
  shortcut?: string;
  /** Hito en el que llega el módulo; sin hito = ya disponible. */
  hito?: string;
};

export const NAV_GROUPS: { label: "groupDirection" | "groupSales" | "groupWork" | "groupBilling"; items: NavItem[] }[] = [
  {
    label: "groupDirection",
    items: [
      { key: "dashboard", path: "", icon: LayoutDashboard, shortcut: "g d" },
      { key: "calendar", path: "/calendar", icon: CalendarDays, shortcut: "g l" },
      { key: "council", path: "/council", icon: BrainCircuit, shortcut: "g a" },
      { key: "passwords", path: "/passwords", icon: KeyRound, shortcut: "g w" },
    ],
  },
  {
    label: "groupSales",
    items: [
      { key: "leads", path: "/leads", icon: UserRoundSearch },
      { key: "pipeline", path: "/pipeline", icon: SquareKanban, shortcut: "g p" },
      { key: "clients", path: "/clients", icon: Building2, shortcut: "g c" },
      { key: "quotes", path: "/quotes", icon: FileText, shortcut: "g q" },
      { key: "quoteTemplates", path: "/quotes/templates", icon: LayoutTemplate },
    ],
  },
  {
    // Lo que se hace para los clientes: los proyectos con sus horas, el SEO de sus webs (y la nuestra)
    // y la vigilancia de las webs que alojamos (uptime, SSL y dominios).
    label: "groupWork",
    items: [
      { key: "projects", path: "/projects", icon: FolderKanban, shortcut: "g r" },
      { key: "seo", path: "/seo", icon: ChartNoAxesCombined, shortcut: "g e" },
      { key: "ads", path: "/ads", icon: Megaphone },
      { key: "sites", path: "/sites", icon: Activity },
    ],
  },
  {
    label: "groupBilling",
    items: [
      { key: "contracts", path: "/contracts", icon: FileSignature, shortcut: "g o" },
      { key: "invoices", path: "/invoices", icon: Receipt, shortcut: "g f" },
      { key: "finance", path: "/finance", icon: Landmark, shortcut: "g n" },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { key: "settings", path: "/settings", icon: Settings, shortcut: "g s" };

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

/** Entradas que dependen de un módulo que la org puede tener apagado (src/domain/org/modules.ts). */
const MODULE_OF: Partial<Record<NavKey, keyof OrgModules>> = { council: "council" };

const enabled = (item: NavItem, modules: OrgModules) => {
  const needs = MODULE_OF[item.key];
  return needs === undefined || modules[needs];
};

/** Los grupos del menú sin lo que la org tiene apagado (un grupo que se queda vacío desaparece). */
export function navGroups(modules: OrgModules): typeof NAV_GROUPS {
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => enabled(item, modules)) })).filter(
    (group) => group.items.length > 0,
  );
}

/** Todas las entradas (menú y ajustes) que la org tiene encendidas: atajos y buscador. */
export function navItems(modules: OrgModules): NavItem[] {
  return ALL_NAV_ITEMS.filter((item) => enabled(item, modules));
}

/** Elemento de navegación activo para una ruta (la más específica gana). */
export function activeNavKey(pathname: string, basePath: string): NavKey {
  const rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  const match = ALL_NAV_ITEMS.filter((i) => i.path !== "" && (rest === i.path || rest.startsWith(`${i.path}/`)));
  return match.sort((a, b) => b.path.length - a.path.length)[0]?.key ?? "dashboard";
}
