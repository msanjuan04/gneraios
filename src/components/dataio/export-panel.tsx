"use client";

import { Download, FileArchive, FileSpreadsheet, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ExportIssuerOption } from "./types";

type Props = {
  slug: string;
  issuers: ExportIssuerOption[];
  /** Trimestre que se propone (el último cerrado) y años que se ofrecen. */
  defaultYear: number;
  defaultQuarter: 1 | 2 | 3 | 4;
  years: number[];
};

/**
 * Exportar para la gestoría: el libro registro de facturas expedidas de un emisor por trimestre (o
 * año) en CSV para Excel, en XLSX, o en un ZIP con el libro y los PDF emitidos del periodo.
 */
export function ExportPanel({ slug, issuers, defaultYear, defaultQuarter, years }: Props) {
  const t = useTranslations("dataio.export");
  const [issuerId, setIssuerId] = useState(issuers[0]?.id ?? "");
  const [year, setYear] = useState(String(defaultYear));
  const [period, setPeriod] = useState<string>(`T${defaultQuarter}`);

  if (issuers.length === 0) return <p className="text-sm text-muted-foreground">{t("noIssuers")}</p>;

  const key = period === "year" ? year : `${year}-${period}`;
  const href = (format: "csv" | "xlsx" | "zip") =>
    `/api/dataio/${slug}/ledger?${new URLSearchParams({ issuer: issuerId, period: key, format }).toString()}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="export-issuer" label={t("issuer")}>
          <Select value={issuerId} onValueChange={setIssuerId}>
            <SelectTrigger id="export-issuer" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {issuers.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                  {i.taxId && <span className="text-muted-foreground"> · {i.taxId}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="export-year" label={t("year")}>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger id="export-year" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="export-period" label={t("period")}>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger id="export-period" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["T1", "T2", "T3", "T4"] as const).map((q) => (
                <SelectItem key={q} value={q}>
                  {t(`quarters.${q}`)}
                </SelectItem>
              ))}
              <SelectItem value="year">{t("wholeYear")}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={href("csv")} download>
            <FileText data-icon="inline-start" />
            {t("csv")}
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={href("xlsx")} download>
            <FileSpreadsheet data-icon="inline-start" />
            {t("xlsx")}
          </a>
        </Button>
        <Button asChild size="sm">
          <a href={href("zip")} download>
            <FileArchive data-icon="inline-start" />
            {t("zip")}
          </a>
        </Button>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Download className="size-3.5" />
          {t("hint")}
        </span>
      </div>
    </div>
  );
}
