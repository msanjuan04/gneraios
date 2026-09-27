"use client";

import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Marca de una factura histórica importada (de un PDF o de un CSV): se emitió con otra herramienta. */
export function ImportedBadge({ className }: { className?: string }) {
  const t = useTranslations("invoiceImport.badge");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("text-muted-foreground", className)}>
          <History data-icon="inline-start" />
          {t("label")}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{t("hint")}</TooltipContent>
    </Tooltip>
  );
}
