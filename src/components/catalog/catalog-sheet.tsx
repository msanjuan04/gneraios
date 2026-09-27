"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Panel lateral de ajustes, más ancho: el formulario y, debajo, la vista previa del documento. El
 * contenido se monta al abrir, así que cada apertura empieza con el formulario limpio.
 */
export function CatalogSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b px-5 py-4 pr-14">
          <SheetTitle className="text-base font-bold">{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <SheetClose asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-3.5 right-3.5" aria-label={t("close")}>
            <XIcon />
          </Button>
        </SheetClose>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** Grupo de botones en píldora donde se elige una opción (tipo de precio, periodicidad, idioma). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  size = "default",
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  size?: "default" | "sm";
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit items-center gap-0.5 rounded-full border bg-muted/40 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
            "aria-pressed:bg-secondary aria-pressed:text-foreground aria-pressed:shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]",
            size === "sm" ? "h-6 px-2.5 text-xs" : "h-7 px-3 text-[0.8rem]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
