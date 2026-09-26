"use client";

import { Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Tarjeta de una gráfica con su vista de tabla (el equivalente accesible, y la forma de leer
 * cada cifra sin pasar el ratón). El conmutador vive en la cabecera.
 */
export function ChartCard({
  title,
  description,
  legend,
  table,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  legend?: ReactNode;
  table?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations("dashboard.chart");
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="font-semibold">
          <h3>{title}</h3>
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
        {table !== undefined && (
          <CardAction>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("showTable")}
                  aria-pressed={asTable}
                  onClick={() => setAsTable((value) => !value)}
                  className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
                >
                  <Table2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("showTable")}</TooltipContent>
            </Tooltip>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {!asTable && legend}
        {asTable && table !== undefined ? <div className="-mx-2 overflow-x-auto">{table}</div> : children}
      </CardContent>
    </Card>
  );
}

/** Leyenda: la marca de cada serie como en la gráfica (rectángulo para barras, trazo para líneas). */
export function Legend({ items }: { items: { key: string; label: string; color: string; mark: "bar" | "line" | "dashed" }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          {item.mark === "bar" ? (
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: item.color }} />
          ) : (
            <svg aria-hidden width="16" height="4" className="overflow-visible">
              <line
                x1="0"
                y1="2"
                x2="16"
                y2="2"
                stroke={item.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={item.mark === "dashed" ? "3 3" : undefined}
              />
            </svg>
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}
