"use client";

import { createContext, type ReactNode, useContext, useState } from "react";

export type ShellOrg = { id: string; slug: string; name: string };
export type ShellMember = { fullName: string; initials: string; role: "owner" | "partner" | "viewer" };
export type ShellOrgOption = { slug: string; name: string };

type ShellData = {
  org: ShellOrg;
  member: ShellMember;
  orgs: ShellOrgOption[];
  /** Prefijo de todas las rutas: `/{slug}` o `/preview`. */
  basePath: string;
  preview: boolean;
};

type ShellState = ShellData & {
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
};

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children, ...data }: ShellData & { children: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  return (
    <ShellContext.Provider value={{ ...data, commandOpen, setCommandOpen, shortcutsOpen, setShortcutsOpen }}>
      {children}
    </ShellContext.Provider>
  );
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell debe usarse dentro de <AppShell>");
  return ctx;
}
