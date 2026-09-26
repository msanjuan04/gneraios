"use client";

import { Check, Filter, Handshake } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { saveSeoSources } from "@/app/[org]/seo/actions";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { SeoBusiness } from "@/server/seo/queries";
import { SEO_ACCENT, SEO_MUTED, SEO_TRACK } from "./chart-colors";
import { formatPercent } from "./format";

type Money = { locale: string; currency: string };

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/50 px-3 py-2.5">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p className="mt-0.5 text-xl font-extrabold heading-tight">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * SEO → negocio: lo que las fuentes de SEO y web traen al CRM en el periodo (leads y ganados) y lo
 * que se ha facturado a los clientes que llegaron por ellas. Debajo, todos los canales por lo
 * facturado desde siempre: los de SEO en azul y el resto en gris, para ver quién trae clientes que
 * pagan.
 */
export function BusinessCard({
  slug,
  data,
  money,
  canEdit,
  className,
}: {
  slug: string;
  data: SeoBusiness;
  money: Money;
  canEdit: boolean;
  className?: string;
}) {
  const t = useTranslations("seo.business");
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useOptimistic(data.seoSourceIds);
  const seo = new Set(selected);
  const names = new Map(data.sources.map((s) => [s.id, s.name]));
  // Cifras de resumen: euros enteros (el detalle al céntimo está en las facturas).
  const eur = (cents: number) => formatMoney(Math.round(cents / 100) * 100, { ...money, wholeUnits: true });
  const share = (value: number | null) => (value === null ? null : formatPercent(format, value, 0));

  const save = (ids: string[] | null) =>
    startTransition(async () => {
      setSelected(ids ?? data.seoSourceIds);
      const result = await saveSeoSources(slug, ids);
      if (!result.ok) toast.error(result.error);
    });
  const toggle = (id: string) => save(seo.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const { impact } = data;
  const rows = data.rows.filter((r) => r.lifetimeBilledCents > 0 || r.leads > 0 || r.won > 0 || r.billedCents !== 0);
  const max = Math.max(1, ...rows.map((r) => r.lifetimeBilledCents));
  const sourceLabels = format.list(
    selected.flatMap((id) => (names.has(id) ? [`«${names.get(id)}»`] : [])),
    { type: "conjunction" },
  );

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-semibold">
          <Handshake aria-hidden className="size-4 text-primary" />
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription className="text-xs">
          {sourceLabels ? t("description", { sources: sourceLabels }) : t("noSources")}
          {!data.custom && selected.length > 0 && <span className="block">{t("suggested")}</span>}
        </CardDescription>
        {canEdit && (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={pending}>
                  <Filter data-icon="inline-start" />
                  {t("sources")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t("sourcesLabel")}</DropdownMenuLabel>
                {data.sources.map((s) => (
                  <DropdownMenuCheckboxItem
                    key={s.id}
                    checked={seo.has(s.id)}
                    onCheckedChange={() => toggle(s.id)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {s.name}
                  </DropdownMenuCheckboxItem>
                ))}
                {data.custom && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => save(null)}>
                      <Check aria-hidden className="opacity-0" />
                      {t("resetSources")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3">
          <Figure
            label={t("leads")}
            value={format.number(impact.leads)}
            hint={share(impact.share.leads) ? t("shareOfLeads", { share: share(impact.share.leads)! }) : t("inPeriod")}
          />
          <Figure
            label={t("won")}
            value={format.number(impact.won)}
            hint={
              impact.wonMrrCents > 0 || impact.wonOneOffCents > 0
                ? [impact.wonOneOffCents > 0 ? eur(impact.wonOneOffCents) : null, impact.wonMrrCents > 0 ? t("perMonth", { amount: eur(impact.wonMrrCents) }) : null]
                    .filter(Boolean)
                    .join(" + ")
                : t("inPeriod")
            }
          />
          <Figure
            label={t("billed")}
            value={eur(impact.billedCents)}
            hint={share(impact.share.billed) ? t("shareOfBilled", { share: share(impact.share.billed)! }) : t("inPeriod")}
          />
        </div>

        <p className="text-sm">
          {t.rich("lifetime", {
            amount: eur(impact.lifetimeBilledCents),
            clients: impact.payingClients,
            share: share(impact.share.lifetimeBilled) ?? "—",
            strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
          })}
        </p>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <section aria-label={t("channelsLabel")}>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("channels")}</h3>
            <ul className="-mx-2 space-y-0.5">
              {rows.map((row) => {
                const isSeo = row.sourceId !== null && seo.has(row.sourceId);
                const name = row.sourceId === null ? t("noSource") : (names.get(row.sourceId) ?? t("archivedSource"));
                return (
                  <Tooltip key={row.sourceId ?? "none"}>
                    <TooltipTrigger asChild>
                      <li
                        tabIndex={0}
                        className="grid grid-cols-[clamp(6rem,32%,9rem)_minmax(0,1fr)] items-center gap-x-3 rounded-md px-2 py-1 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 text-sm">
                          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: isSeo ? SEO_ACCENT : SEO_MUTED }} />
                          <span className={cn("truncate", isSeo && "font-semibold")}>{name}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: SEO_TRACK }}>
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${(row.lifetimeBilledCents / max) * 100}%`, background: isSeo ? SEO_ACCENT : SEO_MUTED }}
                            />
                          </span>
                          <span className="w-20 shrink-0 text-right text-sm tabular">{eur(row.lifetimeBilledCents)}</span>
                        </span>
                      </li>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="flex-col items-start gap-0.5">
                      <span className="text-sm font-semibold tabular">{eur(row.lifetimeBilledCents)}</span>
                      <span className="opacity-70">{name}</span>
                      <span className="tabular">
                        {t("channelTooltip", { leads: row.leads, won: row.won, billed: eur(row.billedCents), paying: row.payingClients })}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">{t("footnote")}</p>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
