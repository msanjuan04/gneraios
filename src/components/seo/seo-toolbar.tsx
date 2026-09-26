"use client";

import { Building2, Check, ChevronsUpDown, Globe, Settings2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SeoComparison, SeoPeriod } from "@/domain/seo";
import { cn } from "@/lib/utils";
import { SeoLink, useSeoNavigation } from "./seo-frame";

export type ToolbarProperty = { id: string; label: string; clientName: string | null; site: string | null; href: string; active: boolean };
export type ToolbarOption<T> = { value: T; href: string; active: boolean };

function Pills<T extends string>({ label, options, text }: { label: string; options: ToolbarOption<T>[]; text: (value: T) => string }) {
  return (
    <nav aria-label={label} className="flex w-fit flex-wrap gap-1 rounded-2xl border bg-card/60 p-1 sm:rounded-full">
      {options.map((option) => (
        <SeoLink
          key={option.value}
          href={option.href}
          aria-current={option.active ? "true" : undefined}
          className={cn(
            "rounded-full px-3.5 py-1 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            option.active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text(option.value)}
        </SeoLink>
      ))}
    </nav>
  );
}

/** Una sola fila encima de todo lo que filtra: la propiedad, el periodo y con qué se compara. */
export function SeoToolbar({
  properties,
  periods,
  comparisons,
  caption,
  manageHref,
}: {
  properties: ToolbarProperty[];
  periods: ToolbarOption<SeoPeriod>[];
  comparisons: ToolbarOption<SeoComparison>[];
  caption: string;
  manageHref: string;
}) {
  const t = useTranslations("seo.toolbar");
  const { navigate } = useSeoNavigation();
  const current = properties.find((p) => p.active);
  const own = properties.filter((p) => p.clientName === null);
  const clients = properties.filter((p) => p.clientName !== null);

  const item = (p: ToolbarProperty) => (
    <DropdownMenuItem key={p.id} onSelect={() => navigate(p.href)} className="items-start gap-2 py-1.5">
      <Check aria-hidden className={cn("mt-0.5 size-4", p.active ? "opacity-100" : "opacity-0")} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{p.clientName ?? p.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{p.clientName ? p.label : (p.site ?? "")}</span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 max-w-full min-w-0 justify-between gap-2 pl-3 sm:max-w-80" aria-label={t("property")}>
            {current?.clientName ? <Building2 aria-hidden className="text-muted-foreground" /> : <Globe aria-hidden className="text-muted-foreground" />}
            <span className="min-w-0 truncate">{current ? (current.clientName ?? current.label) : t("property")}</span>
            <ChevronsUpDown aria-hidden className="opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start">
          {own.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t("own")}</DropdownMenuLabel>
              {own.map(item)}
            </DropdownMenuGroup>
          )}
          {clients.length > 0 && (
            <>
              {own.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t("clients")}</DropdownMenuLabel>
                {clients.map(item)}
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={manageHref}>
              <Settings2 aria-hidden />
              {t("manage")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Pills label={t("period")} options={periods} text={(value) => t(`periods.${value}`)} />
      <Pills label={t("compareLabel")} options={comparisons} text={(value) => t(`compare.${value}`)} />

      <p className="text-sm text-muted-foreground tabular lg:ml-auto">{caption}</p>
    </div>
  );
}
