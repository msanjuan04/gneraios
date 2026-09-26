"use client";

import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { QueryRow } from "@/server/seo/queries";
import { Delta, directionOf } from "./delta";
import { formatChange, formatCount, formatPercent, formatPosition, formatPositionDelta, pagePath, toneOf } from "./format";

const COLLAPSED_ROWS = 10;

function RowsTable({ rows, dimension, comparable }: { rows: QueryRow[]; dimension: "query" | "page"; comparable: boolean }) {
  const t = useTranslations("seo.top");
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  if (rows.length === 0) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="-mx-(--card-spacing) overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">{t(dimension === "query" ? "queriesCaption" : "pagesCaption")}</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="py-2 pr-3 pl-(--card-spacing) text-left font-medium">
                {t(dimension === "query" ? "query" : "page")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">{t("clicks")}</th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">{t("impressions")}</th>
              <th scope="col" className="hidden px-3 py-2 text-right font-medium md:table-cell">{t("ctr")}</th>
              <th scope="col" className="py-2 pr-(--card-spacing) pl-3 text-right font-medium">{t("position")}</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {shown.map((row) => (
              <tr key={row.key} className="border-b transition-colors last:border-0 hover:bg-muted/60">
                <th scope="row" className="max-w-0 py-2 pr-3 pl-(--card-spacing) text-left font-normal">
                  {dimension === "page" ? (
                    <a
                      href={row.key}
                      target="_blank"
                      rel="noreferrer"
                      title={row.key}
                      className="group inline-flex max-w-full items-center gap-1 hover:text-primary"
                    >
                      <span className="truncate">{pagePath(row.key)}</span>
                      <ExternalLink aria-hidden className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                    </a>
                  ) : (
                    <span className="block truncate" title={row.key}>
                      {row.key}
                    </span>
                  )}
                </th>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <span className="font-semibold">{formatCount(format, row.clicks)}</span>
                  {comparable && row.clicksChange !== null && (
                    <Delta tone={toneOf(row.clicksChange, 0.05)} direction={directionOf(row.clicksChange)} className="ml-1.5 text-xs">
                      {formatChange(format, row.clicksChange)}
                    </Delta>
                  )}
                  {comparable && row.clicksChange === null && row.compareClicks === 0 && row.clicks > 0 && (
                    <span className="ml-1.5 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">{t("new")}</span>
                  )}
                </td>
                <td className="hidden px-3 py-2 text-right text-muted-foreground sm:table-cell">{formatCount(format, row.impressions)}</td>
                <td className="hidden px-3 py-2 text-right text-muted-foreground md:table-cell">
                  {row.ctr === null ? "—" : formatPercent(format, row.ctr, 1)}
                </td>
                <td className="py-2 pr-(--card-spacing) pl-3 text-right whitespace-nowrap">
                  {row.position === null ? "—" : formatPosition(format, row.position)}
                  {row.positionDelta !== null && Math.abs(row.positionDelta) >= 0.1 && (
                    <Delta tone={toneOf(row.positionDelta, 0.5)} direction={directionOf(row.positionDelta)} className="ml-1.5 text-xs">
                      {formatPositionDelta(format, row.positionDelta)}
                    </Delta>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > COLLAPSED_ROWS && (
        <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} className="text-muted-foreground">
          {expanded ? t("showLess") : t("showAll", { count: rows.length })}
        </Button>
      )}
    </div>
  );
}

/** Las consultas y las páginas que más clics traen, con su variación y su posición. */
export function QueryTables({
  queries,
  pages,
  comparable,
  className,
}: {
  queries: QueryRow[];
  pages: QueryRow[];
  comparable: boolean;
  className?: string;
}) {
  const t = useTranslations("seo.top");
  return (
    <Card className={cn("gap-3", className)}>
      <Tabs defaultValue="queries" className="gap-3">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-semibold">
              <h2>{t("title")}</h2>
            </CardTitle>
            <CardDescription className="mt-1 text-xs">{t("description")}</CardDescription>
          </div>
          <TabsList>
            <TabsTrigger value="queries" className="px-3">
              {t("queriesTab")}
            </TabsTrigger>
            <TabsTrigger value="pages" className="px-3">
              {t("pagesTab")}
            </TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent>
          <TabsContent value="queries">
            <RowsTable rows={queries} dimension="query" comparable={comparable} />
          </TabsContent>
          <TabsContent value="pages">
            <RowsTable rows={pages} dimension="page" comparable={comparable} />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
