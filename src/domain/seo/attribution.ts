// SEO → negocio: qué traen al CRM las fuentes de adquisición que cuentan como SEO (leads, deals
// ganados y facturación). Reutiliza las definiciones del embudo (src/domain/pipeline): un lead es
// un deal creado en el periodo y un ganado se cuenta por su fecha de cierre.
//
// - Leads y ganados van por la fuente de cada deal.
// - La facturación va por la fuente de adquisición del cliente (la de su primer deal, §6.4): es el
//   cliente quien paga, no el deal. Se suma la base imponible de las facturas emitidas en el
//   periodo (las rectificativas restan) y, aparte, todo lo facturado desde siempre.
// - Qué fuentes cuentan como SEO lo decide cada org (`orgs.settings.seo_source_ids`). Mientras no lo
//   decida, se toman las que se llaman como el canal (SEO, Web, Orgánico…).

import { assertCents, type Cents } from "../money";
import { type DateRange, type FunnelDeal, type FunnelStage, type StageChange, summary } from "../pipeline";

export type AcquisitionSource = { id: string; name: string };

/** Clave de `orgs.settings` con las fuentes que cuentan como SEO. */
export const SEO_SOURCES_SETTING = "seo_source_ids";

/** Palabras que delatan una fuente de SEO o web propia (sin acentos ni mayúsculas). */
const SEO_WORDS = new Set(["seo", "web", "organico", "organica", "organic", "posicionamiento"]);

/** "Google orgánico" → ["google", "organico"]. */
export function nameWords(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function defaultSeoSourceIds(sources: readonly AcquisitionSource[]): string[] {
  return sources.filter((s) => nameWords(s.name).some((w) => SEO_WORDS.has(w))).map((s) => s.id);
}

/** Las fuentes que cuentan como SEO en la org, y si lo ha decidido ella (o es la sugerencia). */
export function resolveSeoSourceIds(
  settings: unknown,
  sources: readonly AcquisitionSource[],
): { ids: string[]; custom: boolean } {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[SEO_SOURCES_SETTING] : undefined;
  if (Array.isArray(raw) && raw.every((id) => typeof id === "string")) {
    return { ids: [...new Set(raw as string[])], custom: true };
  }
  return { ids: defaultSeoSourceIds(sources), custom: false };
}

export type ChannelClient = { id: string; sourceId: string | null; lifetimeBilledCents: Cents };
/** Una factura emitida en el periodo: su cliente y su base imponible (negativa si rectifica). */
export type ChannelInvoice = { clientId: string; subtotalCents: Cents };

export type ChannelRow = {
  /** Fuente de adquisición; null agrupa lo que no tiene fuente. */
  sourceId: string | null;
  /** Deals creados en el periodo. */
  leads: number;
  /** Deals ganados en el periodo (por fecha de cierre). */
  won: number;
  wonOneOffCents: Cents;
  wonMrrCents: Cents;
  /** Base imponible emitida en el periodo a clientes que llegaron por esta fuente. */
  billedCents: Cents;
  /** Todo lo facturado desde siempre a esos clientes (neto de rectificativas). */
  lifetimeBilledCents: Cents;
  /** Clientes de esta fuente que ya han pagado algo (facturación neta positiva). */
  payingClients: number;
};

export function channelBreakdown(input: {
  deals: readonly FunnelDeal[];
  history: readonly StageChange[];
  stages: readonly FunnelStage[];
  range: DateRange;
  clients: readonly ChannelClient[];
  invoices: readonly ChannelInvoice[];
}): ChannelRow[] {
  const sourceOfClient = new Map(input.clients.map((c) => [c.id, c.sourceId]));
  const keys = new Set<string | null>([...input.deals.map((d) => d.sourceId), ...input.clients.map((c) => c.sourceId)]);

  const rows = [...keys].map((sourceId): ChannelRow => {
    const funnel = summary(
      input.deals.filter((d) => d.sourceId === sourceId),
      input.history,
      input.stages,
      input.range,
    );
    const clients = input.clients.filter((c) => c.sourceId === sourceId);
    let billed = 0;
    for (const invoice of input.invoices) {
      if (sourceOfClient.has(invoice.clientId) && sourceOfClient.get(invoice.clientId) === sourceId) billed += invoice.subtotalCents;
    }
    return {
      sourceId,
      leads: funnel.created,
      won: funnel.won,
      wonOneOffCents: funnel.wonOneOffCents,
      wonMrrCents: funnel.wonMrrCents,
      billedCents: assertCents(billed),
      lifetimeBilledCents: assertCents(clients.reduce((sum, c) => sum + c.lifetimeBilledCents, 0)),
      payingClients: clients.filter((c) => c.lifetimeBilledCents > 0).length,
    };
  });

  return rows.sort(
    (a, b) =>
      b.billedCents - a.billedCents ||
      b.lifetimeBilledCents - a.lifetimeBilledCents ||
      b.won - a.won ||
      b.leads - a.leads ||
      (a.sourceId ?? "￿").localeCompare(b.sourceId ?? "￿"),
  );
}

export type SeoImpact = {
  leads: number;
  won: number;
  wonOneOffCents: Cents;
  wonMrrCents: Cents;
  billedCents: Cents;
  lifetimeBilledCents: Cents;
  payingClients: number;
  /** Parte de SEO sobre el total de la org, 0..1 (null si el total es 0). */
  share: { leads: number | null; won: number | null; billed: number | null; lifetimeBilled: number | null };
};

/** Lo que suman las fuentes de SEO y qué parte del total de la org representan. */
export function seoImpact(rows: readonly ChannelRow[], seoSourceIds: readonly string[]): SeoImpact {
  const seo = new Set(seoSourceIds);
  const pick = rows.filter((r) => r.sourceId !== null && seo.has(r.sourceId));
  const sum = (list: readonly ChannelRow[], field: keyof Omit<ChannelRow, "sourceId">) =>
    list.reduce((total, row) => total + row[field], 0);
  const share = (field: keyof Omit<ChannelRow, "sourceId">) => {
    const total = sum(rows, field);
    return total > 0 ? sum(pick, field) / total : null;
  };
  return {
    leads: sum(pick, "leads"),
    won: sum(pick, "won"),
    wonOneOffCents: assertCents(sum(pick, "wonOneOffCents")),
    wonMrrCents: assertCents(sum(pick, "wonMrrCents")),
    billedCents: assertCents(sum(pick, "billedCents")),
    lifetimeBilledCents: assertCents(sum(pick, "lifetimeBilledCents")),
    payingClients: sum(pick, "payingClients"),
    share: { leads: share("leads"), won: share("won"), billed: share("billedCents"), lifetimeBilled: share("lifetimeBilledCents") },
  };
}
