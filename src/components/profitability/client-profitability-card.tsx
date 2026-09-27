"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { SettingsCard } from "@/components/settings/settings-card";
import { Skeleton } from "@/components/ui/skeleton";
import { hasOtherCosts, otherCostsCents } from "@/domain/profitability";
import { cn } from "@/lib/utils";
import { FlagPills } from "./flags";
import { useProfitabilityFormat } from "./format";
import type { ClientProfitabilitySummary, ClientProfitabilityWindow } from "./types";

type Loaded = { clientId: string; summary: ClientProfitabilitySummary | null; failed: boolean };

/**
 * «Rentabilidad» en la ficha del cliente: desde siempre (de su primera factura o su primer coste),
 * lo que ha pagado (con IVA) y lo que falta, frente a lo que ha costado (horas, gastos e
 * infraestructura) y el margen; y los últimos 3 y 12 meses, con sus avisos. Enlaza con Finanzas →
 * Rentabilidad con el cliente abierto.
 *
 * Solo para socios (el coste por hora es sensible). Para montarlo:
 * `{data.isPartner && <ClientProfitabilityCard slug={slug} clientId={client.id} />}`. No necesita
 * datos de la página: los pide al montarse (GET /api/profitability/clients/[clientId]).
 */
export function ClientProfitabilityCard({ slug, clientId }: { slug: string; clientId: string }) {
  const t = useTranslations("profitability.card");
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/profitability/clients/${clientId}`, { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<ClientProfitabilitySummary>) : Promise.reject(new Error(String(res.status)))))
      .then((summary) => setLoaded({ clientId, summary, failed: false }))
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ clientId, summary: null, failed: true });
      });
    return () => controller.abort();
  }, [clientId]);

  const current = loaded?.clientId === clientId ? loaded : null;

  return (
    <SettingsCard
      title={t("title")}
      actions={
        <Link
          href={`/${slug}/finance/profitability?client=${clientId}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground focus-visible:underline"
        >
          {t("open")}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      }
    >
      {current === null ? (
        <div className="grid grid-cols-2 gap-4" aria-busy>
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      ) : current.summary === null ? (
        <p className="text-muted-foreground">{t("error")}</p>
      ) : (
        <ProfitabilityCardBody summary={current.summary} />
      )}
    </SettingsCard>
  );
}

/** El contenido de la tarjeta con los datos ya cargados. */
export function ProfitabilityCardBody({ summary }: { summary: ClientProfitabilitySummary }) {
  const t = useTranslations("profitability.card");
  const quiet = (w: ClientProfitabilityWindow) => w.revenueCents === 0 && w.minutes === 0 && !hasOtherCosts(w.otherCosts) && w.collectedCents === 0;
  if (summary.lifetime === null && quiet(summary.last12m)) return <p className="text-muted-foreground">{t("empty")}</p>;
  return (
    <div className="space-y-3">
      {summary.lifetime && <Lifetime window={summary.lifetime} summary={summary} />}
      <div className="grid grid-cols-2 gap-3">
        <Window label={t("last3m")} window={summary.last3m} summary={summary} />
        <Window label={t("last12m")} window={summary.last12m} summary={summary} />
      </div>
      {!summary.costsConfigured && <p className="text-xs text-muted-foreground">{t("noCosts")}</p>}
    </div>
  );
}

function Row({ term, value, tone, hint }: { term: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="min-w-0 text-xs text-muted-foreground">
        {term}
        {hint && <span className="block text-[11px] opacity-80">{hint}</span>}
      </dt>
      <dd className={cn("shrink-0 font-semibold tabular", tone)}>{value}</dd>
    </div>
  );
}

/**
 * Desde siempre (de su primera factura o su primer coste a hoy): lo que ha pagado el cliente frente a
 * lo que nos ha costado. Lo cobrado y lo pendiente van con IVA; los ingresos, el coste y el margen, sin él.
 */
function Lifetime({ window, summary }: { window: ClientProfitabilityWindow; summary: ClientProfitabilitySummary }) {
  const t = useTranslations("profitability.card");
  const fmt = useProfitabilityFormat();
  const flags = summary.costsConfigured ? window.flags : window.flags.filter((flag) => flag !== "lowMargin");
  const other = otherCostsCents(window.otherCosts);
  const margin = !summary.costsConfigured
    ? "—"
    : window.marginBps === null
      ? fmt.money(window.marginCents)
      : t("marginValue", { amount: fmt.money(window.marginCents), value: fmt.percent(window.marginBps) });
  return (
    <section className="min-w-0 rounded-xl border bg-muted/20 px-3 py-2.5">
      <h4 className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
        {t("lifetime")}
        <span className="font-medium tracking-normal normal-case">{t("since", { date: fmt.date(window.from) })}</span>
      </h4>
      <dl className="space-y-1">
        <Row
          term={t("collected")}
          value={fmt.money(window.collectedCents)}
          hint={window.receiptsCents !== 0 ? t("collectedReceipts", { amount: fmt.money(window.receiptsCents) }) : undefined}
        />
        {window.pendingCents !== 0 && <Row term={t("pending")} value={fmt.money(window.pendingCents)} tone="text-warning" />}
        <Row term={t("revenueBase")} value={fmt.money(window.revenueCents)} />
        <Row
          term={t("cost")}
          value={fmt.money(window.costCents)}
          hint={other !== 0 ? t("costSplit", { hours: fmt.money(window.hoursCostCents), amount: fmt.money(other) }) : undefined}
        />
        <Row term={t("margin")} value={margin} tone={summary.costsConfigured && window.marginCents < 0 ? "text-destructive" : undefined} />
      </dl>
      <FlagPills flags={flags} thresholds={summary} className="mt-2" />
    </section>
  );
}

function Window({ label, window, summary }: { label: string; window: ClientProfitabilityWindow; summary: ClientProfitabilitySummary }) {
  const t = useTranslations("profitability.card");
  const fmt = useProfitabilityFormat();
  // Sin costes por hora no hay margen que dar (ni su aviso); el resto no depende de ellos.
  const flags = summary.costsConfigured ? window.flags : window.flags.filter((flag) => flag !== "lowMargin");
  return (
    <section className="min-w-0 rounded-xl border px-3 py-2.5">
      <h4 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</h4>
      <dl className="space-y-1">
        <Row term={t("revenue")} value={fmt.money(window.revenueCents)} />
        <Row term={t("collectedShort")} value={fmt.money(window.collectedCents)} />
        <Row term={t("hours")} value={fmt.hours(window.minutes)} />
        {hasOtherCosts(window.otherCosts) && <Row term={t("otherCosts")} value={fmt.money(otherCostsCents(window.otherCosts))} />}
        <Row
          term={t("margin")}
          value={!summary.costsConfigured || window.marginBps === null ? "—" : fmt.percent(window.marginBps)}
          tone={summary.costsConfigured && window.marginCents < 0 ? "text-destructive" : undefined}
        />
        <Row term={t("rate")} value={window.rateCents === null ? "—" : fmt.rate(window.rateCents)} />
      </dl>
      <FlagPills flags={flags} thresholds={summary} className="mt-2" />
    </section>
  );
}
