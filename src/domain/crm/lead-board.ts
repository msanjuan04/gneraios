// Cómo se ordenan y se suman los leads. Puro: ni base de datos ni React, para poder probarlo todo.

/** Calificación comercial del lead. La pone una persona; sin calificar es `null`. */
export type LeadTemperature = "hot" | "warm" | "cold";

export const LEAD_TEMPERATURES: readonly LeadTemperature[] = ["hot", "warm", "cold"];

export const isLeadTemperature = (value: unknown): value is LeadTemperature =>
  typeof value === "string" && (LEAD_TEMPERATURES as readonly string[]).includes(value);

/**
 * Las iniciales de la carpeta: dos letras. De una empresa, la primera de sus dos primeras palabras
 * («Little Forest» → LF); de una persona, nombre y apellido («Nadia Pérez» → NP); de una palabra
 * sola, sus dos primeras letras («Metrickal» → ME).
 */
export function leadInitials(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Fuera lo que no distingue a nadie: la forma jurídica y los artículos.
    .split(/[\s.,·|/-]+/)
    .filter((word) => /[A-Za-z0-9]/.test(word) && !NOISE.has(word.toLowerCase()));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}

const NOISE = new Set(["sl", "s", "l", "sa", "slu", "sociedad", "limitada", "the", "el", "la", "los", "las", "de", "del", "y"]);

/** Un lead tal y como lo necesita la portada de leads (ya sin nada de la base de datos). */
export type LeadSummary = {
  dealId: string;
  clientId: string;
  clientName: string;
  title: string;
  stageId: string;
  stageName: string;
  stagePosition: number;
  temperature: LeadTemperature | null;
  estOneOffCents: number;
  estMrrCents: number;
  /** Cierto si los importes son una estimación del histórico y no algo propio del lead. */
  estimated: boolean;
  probabilityBps: number;
  nextAction: string | null;
  nextActionOn: string | null;
  /** Días desde el último contacto (cualquiera de los dos lados); null si nunca hubo. */
  lastContactDaysAgo: number | null;
  /** Si el último mensaje fue suyo, nos toca contestar. */
  awaitingOurReply: boolean;
  quotes: number;
  messages: number;
};

/**
 * Lo que de verdad podría entrar, sin ponderar: todas las oportunidades abiertas y, aparte, solo
 * aquellas a las que ya se ha enviado presupuesto. La ponderada engaña cuando hay pocos deals, y
 * era lo que no cuadraba con los presupuestos enviados.
 */
export type LeadTotals = {
  openDeals: number;
  oneOffCents: number;
  mrrCents: number;
  quotedDeals: number;
  quotedOneOffCents: number;
  quotedMrrCents: number;
  /** Lo estimado de los leads sin importe ni presupuesto: aparte, nunca mezclado con lo real. */
  estimatedDeals: number;
  estimatedOneOffCents: number;
  estimatedMrrCents: number;
  awaitingReply: number;
};

export function leadTotals(leads: readonly LeadSummary[]): LeadTotals {
  const totals: LeadTotals = {
    openDeals: leads.length,
    oneOffCents: 0,
    mrrCents: 0,
    quotedDeals: 0,
    quotedOneOffCents: 0,
    quotedMrrCents: 0,
    estimatedDeals: 0,
    estimatedOneOffCents: 0,
    estimatedMrrCents: 0,
    awaitingReply: 0,
  };
  for (const lead of leads) {
    if (lead.estimated) {
      totals.estimatedDeals += 1;
      totals.estimatedOneOffCents += lead.estOneOffCents;
      totals.estimatedMrrCents += lead.estMrrCents;
      if (lead.awaitingOurReply) totals.awaitingReply += 1;
      continue;
    }
    totals.oneOffCents += lead.estOneOffCents;
    totals.mrrCents += lead.estMrrCents;
    if (lead.quotes > 0) {
      totals.quotedDeals += 1;
      totals.quotedOneOffCents += lead.estOneOffCents;
      totals.quotedMrrCents += lead.estMrrCents;
    }
    if (lead.awaitingOurReply) totals.awaitingReply += 1;
  }
  return totals;
}

const TEMPERATURE_RANK: Record<LeadTemperature | "none", number> = { hot: 0, warm: 1, cold: 3, none: 2 };

/**
 * El orden de las carpetas: primero lo que nos toca contestar, luego lo caliente, y dentro de cada
 * grupo lo que tiene una acción con fecha más cercana. Lo frío siempre al final.
 */
export function sortLeads(leads: readonly LeadSummary[]): LeadSummary[] {
  return [...leads].sort((a, b) => {
    if (a.awaitingOurReply !== b.awaitingOurReply) return a.awaitingOurReply ? -1 : 1;
    const rank = TEMPERATURE_RANK[a.temperature ?? "none"] - TEMPERATURE_RANK[b.temperature ?? "none"];
    if (rank !== 0) return rank;
    if (a.nextActionOn !== b.nextActionOn) {
      if (!a.nextActionOn) return 1;
      if (!b.nextActionOn) return -1;
      return a.nextActionOn < b.nextActionOn ? -1 : 1;
    }
    // A igualdad de todo, lo que más vale primero: es donde hay más que perder.
    return b.estOneOffCents + b.estMrrCents * 12 - (a.estOneOffCents + a.estMrrCents * 12);
  });
}

/** Una etapa del embudo con lo que hay dentro y lo que vale (sin ponderar). */
export type FunnelStage = {
  stageId: string;
  name: string;
  position: number;
  deals: number;
  oneOffCents: number;
  mrrCents: number;
};

/**
 * El embudo: cuántas oportunidades hay en cada etapa y cuánto suman. Las etapas vienen de la
 * configuración de la org (no se inventan aquí) y salen todas, también las vacías: un hueco en el
 * embudo es información.
 */
export function funnelStages(
  stages: readonly { id: string; name: string; position: number; kind: string }[],
  deals: readonly { stageId: string; estOneOffCents: number; estMrrCents: number }[],
): FunnelStage[] {
  const byStage = new Map<string, FunnelStage>();
  for (const stage of stages) {
    byStage.set(stage.id, { stageId: stage.id, name: stage.name, position: stage.position, deals: 0, oneOffCents: 0, mrrCents: 0 });
  }
  for (const deal of deals) {
    const stage = byStage.get(deal.stageId);
    if (!stage) continue;
    stage.deals += 1;
    stage.oneOffCents += deal.estOneOffCents;
    stage.mrrCents += deal.estMrrCents;
  }
  return [...byStage.values()].sort((a, b) => a.position - b.position);
}

/** Cuántas bolas se dibujan por etapa: todas si son pocas, y si no un puñado con el resto en número. */
export function dotsFor(count: number, max = 12): { dots: number; rest: number } {
  if (count <= max) return { dots: count, rest: 0 };
  return { dots: max, rest: count - max };
}
