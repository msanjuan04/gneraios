"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Panel lateral para crear o editar un elemento de ajustes. El contenido se monta
 * al abrir, así que cada apertura empieza con el formulario limpio.
 */
export function SettingsSheet({
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
      <SheetContent showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
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

/** Formulario a toda altura del panel: cuerpo con scroll y pie fijo con las acciones. */
export function SheetForm({
  onSubmit,
  footer,
  children,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">{footer}</div>
    </form>
  );
}
