"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "dark", icon: Moon },
  { value: "light", icon: Sun },
  { value: "system", icon: Monitor },
] as const;

const noopSubscribe = () => () => {};

/** Mini vista previa de cada tema: fondo, una tarjeta y el acento azul. */
function ThemeSwatch({ value }: { value: (typeof OPTIONS)[number]["value"] }) {
  const pane = (tone: "dark" | "light") => (
    <div className={cn("flex h-full flex-1 flex-col gap-1.5 p-2.5", tone === "dark" ? "bg-[#04060a]" : "bg-[#f7f8fa]")}>
      <div className={cn("h-1.5 w-2/3 rounded-full", tone === "dark" ? "bg-white/70" : "bg-[#04060a]/70")} />
      <div className={cn("h-1.5 w-1/2 rounded-full", tone === "dark" ? "bg-white/25" : "bg-[#04060a]/20")} />
      <div className="mt-auto h-3 w-10 rounded-full bg-brand-gradient" />
    </div>
  );
  return (
    <div className="flex h-20 overflow-hidden rounded-xl border">
      {value === "light" ? pane("light") : pane("dark")}
      {value === "system" && pane("light")}
    </div>
  );
}

/** Tema de la interfaz en este dispositivo (next-themes lo guarda en el navegador). */
export function ThemePicker() {
  const t = useTranslations("theme");
  const { theme, setTheme } = useTheme();
  // El tema solo se conoce en el navegador: hasta hidratar, ninguna opción aparece marcada.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : null;

  return (
    <div role="group" aria-label={t("label")} className="grid gap-3 sm:grid-cols-3">
      {OPTIONS.map((option) => {
        const selected = current === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => setTheme(option.value)}
            className={cn(
              "rounded-2xl border bg-card p-3 text-left text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
              selected && "border-primary/60 ring-3 ring-primary/20",
            )}
          >
            <ThemeSwatch value={option.value} />
            <span className="mt-3 flex items-center gap-2 font-semibold">
              <option.icon className="size-4 text-muted-foreground" />
              {t(option.value)}
              {selected && <Check className="ml-auto size-4 text-primary" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
