"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** Campo numérico alineado a la derecha, en cifras tabulares, con su unidad al final (€, %, días). */
export function SuffixInput({ suffix, className, ...props }: ComponentProps<typeof Input> & { suffix: ReactNode }) {
  return (
    <div className="relative">
      <Input inputMode="decimal" className={cn("pr-7 text-right tabular", className)} {...props} />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
        {suffix}
      </span>
    </div>
  );
}

export function MoneyInput(props: ComponentProps<typeof Input>) {
  return <SuffixInput suffix="€" placeholder="0" {...props} />;
}

export function PercentInput(props: ComponentProps<typeof Input>) {
  return <SuffixInput suffix="%" placeholder="0" {...props} />;
}

/** Título de un bloque dentro de un formulario, como en la ficha de cliente. */
export function FormSection({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 pt-3 first:pt-0 sm:col-span-2", className)}>
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</p>
      {action}
    </div>
  );
}

/**
 * Panel lateral como los de ajustes, con un ancho mayor para los formularios de líneas.
 * El contenido se monta al abrir: cada apertura empieza con el formulario limpio.
 */
export function ContractSheet({
  open,
  onOpenChange,
  title,
  description,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        showCloseButton={false}
        className={cn(
          "gap-0 data-[side=right]:w-full",
          wide ? "data-[side=right]:sm:max-w-3xl" : "data-[side=right]:sm:max-w-xl",
        )}
      >
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
