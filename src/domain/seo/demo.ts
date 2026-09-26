// Datos ficticios pero verosímiles de Search Console y GA4 para la org demo (scripts/seed-demo-seo.ts)
// y para la vista previa. Determinista: la misma semilla da siempre los mismos números.
//
// El modelo, por consulta y día: la posición evoluciona de `from` a `to` (el trabajo de SEO) con
// ruido diario; las impresiones siguen la demanda (volumen × temporada × día de la semana ×
// crecimiento) y la visibilidad de la posición; los clics, el CTR esperado en esa posición. Los
// totales del día añaden las consultas anonimizadas que Search Console no desglosa, y GA4 se deriva
// de los clics (sesiones orgánicas) y de la parte orgánica del tráfico.

import { addDays, type CivilDate, compareCivil, daysInclusive, daysInMonth, parseCivilDate } from "../dates/civil-date";
import { expectedCtr } from "./opportunities";
import type { DayRange } from "./period";
import type { QueryDailyFact, SearchDailyFact, WebDailyFact } from "./provider";

export type DemoQuery = {
  text: string;
  /** Índice de la página que posiciona en `DemoSiteProfile.pages`. */
  page: number;
  /** Otra página que a veces se lleva una parte de las impresiones (canibalización). */
  altPage?: number;
  /** Impresiones al mes en primera página y temporada media. */
  volume: number;
  /** Posición media al principio y al final del periodo. */
  from: number;
  to: number;
  /** Consulta de marca: el CTR es mucho más alto que el de la curva. */
  brand?: boolean;
  /** Fracción del periodo (0..1) en la que empieza a aparecer (contenido nuevo). */
  since?: number;
};

export type DemoSiteProfile = {
  /** Semilla del generador. */
  seed: string;
  /** "https://gnerai.com": las páginas se guardan como URL completa, como las da Search Console. */
  origin: string;
  /** Rutas de las páginas ("/", "/seo/"…). */
  pages: readonly string[];
  queries: readonly DemoQuery[];
  /** Cola larga: combinaciones "cabeza + cola" con pocas impresiones cada una. */
  longTail?: {
    heads: readonly string[];
    tails: readonly string[];
    page: number;
    /** Impresiones al mes de cada combinación. */
    volume: readonly [number, number];
    position: readonly [number, number];
  };
  /** Factor de demanda por mes, de enero a diciembre. */
  seasonality: readonly number[];
  /** Factor de demanda por día de la semana, de domingo a sábado. */
  weekday: readonly number[];
  /** Demanda al final del periodo frente al principio (1,2 = un 20 % más). */
  growth: number;
  /** Fracción del periodo desde la que mejoran las posiciones (0 = desde el principio). */
  improveFrom?: number;
  /** Parte de las impresiones de consultas anonimizadas (no salen consulta por consulta). */
  anonymizedShare: number;
  /** Cambios puntuales de posición (una actualización de Google, una migración…). */
  events?: readonly { from: number; to: number; positionShift: number }[];
  web: {
    /** Parte orgánica del tráfico al principio y al final del periodo. */
    organicShare: readonly [number, number];
    /** Sesiones orgánicas por clic de Google (otros buscadores suman un poco). */
    sessionsPerClick: number;
    engagementRate: number;
    /** Conversiones por sesión orgánica y por sesión de otros canales. */
    organicConversionRate: number;
    otherConversionRate: number;
  };
};

export type DemoSiteData = { daily: SearchDailyFact[]; queries: QueryDailyFact[]; web: WebDailyFact[] };

// ---------------------------------------------------------------------------
// Aleatoriedad determinista
// ---------------------------------------------------------------------------

/** Hash de 32 bits de un texto (FNV-1a), para sembrar el generador. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Generador mulberry32: rápido, determinista y suficiente para datos de demo. */
export function createRandom(seed: number) {
  let state = seed | 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return {
    next,
    gaussian,
    between: (min: number, max: number) => min + (max - min) * next(),
    /** Ruido multiplicativo centrado en 1. */
    noise: (sigma: number) => Math.exp(sigma * gaussian() - (sigma * sigma) / 2),
    /** Recuento con media `mean` (Poisson; aproximación normal para medias grandes). */
    poisson: (mean: number) => {
      if (!(mean > 0)) return 0;
      if (mean > 40) return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian()));
      const limit = Math.exp(-mean);
      let k = 0;
      for (let p = next(); p > limit; p *= next()) k++;
      return k;
    },
  };
}

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Factor de temporada del día, interpolado entre los días 15 de cada mes (sin saltos de mes a mes). */
function seasonal(date: CivilDate, factors: readonly number[]): number {
  const { year, month, day } = parseCivilDate(date);
  const at = (m: number) => factors[((m % 12) + 12) % 12] ?? 1;
  const length = daysInMonth(year, month);
  const position = (day - 15) / length; // −0,5..0,5 alrededor del centro del mes
  const m = month - 1;
  return position >= 0 ? at(m) + (at(m + 1) - at(m)) * position : at(m) + (at(m) - at(m - 1)) * position;
}

function weekdayOf(date: CivilDate): number {
  const { year, month, day } = parseCivilDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Qué parte de las impresiones de la primera página recibe un resultado en esa posición. */
function visibility(position: number): number {
  if (position <= 10) return 1;
  if (position <= 20) return 0.5;
  if (position <= 30) return 0.22;
  return 0.08;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function longTailQueries(profile: DemoSiteProfile, random: ReturnType<typeof createRandom>): DemoQuery[] {
  const tail = profile.longTail;
  if (!tail) return [];
  const known = new Set(profile.queries.map((q) => q.text));
  const out: DemoQuery[] = [];
  for (const head of tail.heads) {
    for (const suffix of tail.tails) {
      const text = `${head} ${suffix}`;
      if (known.has(text)) continue;
      const start = random.between(tail.position[0], tail.position[1]);
      out.push({
        text,
        page: tail.page,
        volume: random.between(tail.volume[0], tail.volume[1]),
        from: start,
        to: Math.max(2, start - random.between(0, start * 0.35)),
        since: random.next() < 0.3 ? random.between(0, 0.7) : 0,
      });
    }
  }
  return out;
}

/** 16 meses (o el rango que se pida) de una web: totales diarios, consultas y GA4. */
export function generateDemoSite(profile: DemoSiteProfile, range: DayRange): DemoSiteData {
  const random = createRandom(hashSeed(profile.seed));
  const queries = [...profile.queries, ...longTailQueries(profile, random)];
  const total = daysInclusive(range.from, range.to);
  const improveFrom = clamp(profile.improveFrom ?? 0, 0, 0.95);

  const daily: SearchDailyFact[] = [];
  const rows: QueryDailyFact[] = [];
  const web: WebDailyFact[] = [];
  // Una deriva lenta de la posición por consulta, para que no todas se muevan a la vez.
  const drift = queries.map(() => 0);

  let index = 0;
  for (let date = range.from; compareCivil(date, range.to) <= 0; date = addDays(date, 1), index++) {
    const t = total > 1 ? index / (total - 1) : 1;
    const progress = t <= improveFrom ? 0 : smoothstep((t - improveFrom) / (1 - improveFrom));
    const demand =
      seasonal(date, profile.seasonality) * (profile.weekday[weekdayOf(date)] ?? 1) * (1 + (profile.growth - 1) * t);
    const shift = (profile.events ?? []).reduce((sum, e) => (t >= e.from && t <= e.to ? sum + e.positionShift : sum), 0);

    let clicks = 0;
    let impressions = 0;
    let weightedPosition = 0;
    queries.forEach((q, i) => {
      drift[i] = clamp(drift[i]! * 0.92 + random.gaussian() * 0.18, -2.5, 2.5);
      if (t < (q.since ?? 0)) return;
      const base = q.from + (q.to - q.from) * progress;
      const position = clamp(base + drift[i]! + shift + random.gaussian() * (0.25 + base * 0.03), 1, 100);
      const expected = (q.volume / 30.4) * demand * visibility(position) * random.noise(0.16);
      const shown = random.poisson(expected);
      if (shown === 0) return;

      const split = q.altPage !== undefined && random.next() < 0.35 ? Math.round(shown * random.between(0.1, 0.3)) : 0;
      const parts: [number, number, number][] = [[q.page, shown - split, position]];
      if (split > 0) parts.push([q.altPage!, split, clamp(position + random.between(2, 6), 1, 100)]);
      for (const [page, shownHere, positionHere] of parts) {
        if (shownHere <= 0) continue;
        const ctr = Math.min(0.85, expectedCtr(positionHere) * (q.brand ? 2.4 : 1) * random.noise(0.3));
        const clicked = Math.min(shownHere, random.poisson(shownHere * ctr));
        rows.push({
          metricOn: date,
          query: q.text,
          page: `${profile.origin}${profile.pages[page] ?? "/"}`,
          clicks: clicked,
          impressions: shownHere,
          position: round2(positionHere),
        });
        clicks += clicked;
        impressions += shownHere;
        weightedPosition += positionHere * shownHere;
      }
    });

    // Las consultas anonimizadas: muchas impresiones de cola larga, peor posición y menos clics.
    const anonymized = profile.anonymizedShare / Math.max(0.05, 1 - profile.anonymizedShare);
    const anonImpressions = Math.round(impressions * anonymized * random.noise(0.1));
    const anonClicks = Math.round(clicks * anonymized * 0.45 * random.noise(0.15));
    const averagePosition = impressions > 0 ? weightedPosition / impressions : 0;
    const dayImpressions = impressions + anonImpressions;
    const dayClicks = clicks + anonClicks;
    if (dayImpressions > 0) {
      daily.push({
        metricOn: date,
        clicks: dayClicks,
        impressions: dayImpressions,
        position: round2((weightedPosition + anonImpressions * (averagePosition + 7)) / dayImpressions),
      });
    }

    const w = profile.web;
    const organic = Math.round(dayClicks * w.sessionsPerClick * random.noise(0.07));
    const share = clamp((w.organicShare[0] + (w.organicShare[1] - w.organicShare[0]) * t) * random.noise(0.06), 0.05, 0.95);
    const sessions = Math.max(organic, Math.round(organic / share));
    const organicConversions = random.poisson(organic * w.organicConversionRate);
    const conversions = organicConversions + random.poisson((sessions - organic) * w.otherConversionRate);
    const engaged = (n: number) => Math.min(n, Math.round(n * w.engagementRate * random.noise(0.05)));
    web.push(
      {
        metricOn: date,
        channel: "all",
        sessions,
        users: Math.round(sessions * 0.82 * random.noise(0.04)),
        engagedSessions: engaged(sessions),
        conversions,
      },
      {
        metricOn: date,
        channel: "organic_search",
        sessions: organic,
        users: Math.round(organic * 0.86 * random.noise(0.04)),
        engagedSessions: engaged(organic),
        conversions: organicConversions,
      },
    );
  }

  return { daily, queries: rows, web };
}
