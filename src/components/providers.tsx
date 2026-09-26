"use client";

import { ThemeProvider } from "next-themes";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster position="bottom-right" containerAriaLabel={t("notifications")} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
