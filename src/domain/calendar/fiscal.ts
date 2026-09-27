// Calendario fiscal de una agencia en España: los plazos de la AEAT que tocan a cada emisor
// activo (la SL y los socios autónomos), derivados de los emisores y de los ajustes de la org.
// No se guarda ninguna fecha: se calcula para el rango que se pinta.
//
// Todo es ORIENTATIVO y la pantalla lo marca así: hay que validarlo con la gestoría.
//
// Plazos (fechas del calendario del contribuyente de la AEAT, ejercicio = año natural):
// - Trimestrales (303 IVA, 111 retenciones, 115 alquileres, 130 pago fraccionado IRPF, 349
//   intracomunitarias): 1T del 1 al 20 de abril, 2T del 1 al 20 de julio, 3T del 1 al 20 de
//   octubre. El 4T, en enero del año siguiente: hasta el 30 el 303, el 130 y el 349, y hasta el
//   20 el 111 y el 115.
// - 202 (pagos fraccionados del Impuesto sobre Sociedades, solo la SL): del 1 al 20 de abril,
//   octubre y diciembre del propio ejercicio.
// - 200 (Impuesto sobre Sociedades, solo la SL): del 1 al 25 de julio del año siguiente.
// - Anuales de enero del año siguiente: 390 (resumen del IVA) hasta el 30; 190 (resumen del 111)
//   y 180 (resumen del 115) hasta el 31.
// - 347 (operaciones con terceros de más de 3.005,06 €): todo febrero del año siguiente.
//
// Fines de semana, de forma simple y documentada: si el último día cae en sábado o domingo, el
// plazo pasa al lunes siguiente. Los festivos (nacionales o autonómicos) no se tienen en cuenta
// (ninguno cae en un día 20, 25, 30 o 31 de los meses con plazo, salvo casos raros), y con
// domiciliación bancaria el plazo acaba unos días antes: por eso, validar con la gestoría.
//
// Qué modelos aplican: `orgs.settings.fiscal_calendar` (ver readFiscalCalendarSettings), por tipo
// de emisor y, si hace falta, por emisor. El 115 y su resumen, el 180, solo si la org los añade
// (hay que tener un local alquilado). El 349, solo si hay operaciones intracomunitarias. El 130 es
// solo de autónomos y el 202 y el 200, solo de sociedades, los pida quien los pida.
//
// Un emisor tiene plazos de un periodo si estuvo activo en algún momento de él, con la misma
// regla que la emisión de facturas: la SL sin fecha de alta aún no está constituida (sin plazos);
// un autónomo sin fecha, sí está activo. Un emisor archivado ya no tiene plazos (para cerrar su
// actividad con fecha, se usa su fecha de baja). La fecha Verifactu de cada emisor no archivado
// también sale en el calendario.

import { addDays, compareCivil, daysBetween, daysInMonth, formatCivil, parseCivilDate, type CivilDate } from "../dates/civil-date";
import type { CalendarEvent, CalendarEventStatus, CalendarFact, FiscalPeriod } from "./types";

/** Modelos que conoce el calendario, en el orden en que se ofrecen en los ajustes. */
export const FISCAL_MODELS = ["303", "111", "115", "130", "349", "202", "200", "390", "190", "180", "347"] as const;
export type FiscalModel = (typeof FISCAL_MODELS)[number];

export type FiscalIssuerKind = "company" | "self_employed";

/** Lo que se lee de `orgs.settings.fiscal_calendar`. */
export type FiscalCalendarSettings = {
  enabled: boolean;
  /** Modelos que aplican por tipo de emisor. */
  models: Readonly<Record<FiscalIssuerKind, readonly FiscalModel[]>>;
  /** Excepciones por emisor (id → modelos): p. ej. un autónomo con trabajadores (111). */
  byIssuer: Readonly<Record<string, readonly FiscalModel[]>>;
  /**
   * 349: "auto" = solo si el emisor ha facturado operaciones intracomunitarias en los últimos 12
   * meses; "always" = siempre (p. ej. por compras a la UE, como Meta o Google Ads facturadas desde
   * Irlanda, que la app no ve); "never" = nunca.
   */
  intraEu: "auto" | "always" | "never";
};

export const FISCAL_CALENDAR_DEFAULTS: FiscalCalendarSettings = {
  enabled: true,
  models: {
    company: ["303", "111", "190", "202", "200", "390", "347", "349"],
    self_employed: ["303", "130", "390", "347", "349"],
  },
  byIssuer: {},
  intraEu: "auto",
};

/** Modelos que solo tienen sentido para un tipo de emisor, aunque los ajustes digan otra cosa. */
const ONLY_FOR: Partial<Record<FiscalModel, FiscalIssuerKind>> = { "130": "self_employed", "202": "company", "200": "company" };

export function isFiscalModel(value: unknown): value is FiscalModel {
  return (typeof value === "string" || typeof value === "number") && (FISCAL_MODELS as readonly string[]).includes(String(value));
}

function modelList(value: unknown): FiscalModel[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter(isFiscalModel).map((m) => String(m) as FiscalModel))];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ajustes del calendario fiscal a partir de `orgs.settings` (el objeto entero). Forma:
 *
 *   "fiscal_calendar": {
 *     "enabled": true,
 *     "models": { "company": ["303", "111", …], "self_employed": ["303", "130", …] },
 *     "by_issuer": { "<id del emisor>": ["303", "111", "130"] },
 *     "intra_eu": "auto" | "always" | "never"
 *   }
 *
 * Lo que falte o no sea válido toma el valor por defecto, campo a campo.
 */
export function readFiscalCalendarSettings(orgSettings: unknown): FiscalCalendarSettings {
  const raw = isObject(orgSettings) && isObject(orgSettings.fiscal_calendar) ? orgSettings.fiscal_calendar : {};
  const models = isObject(raw.models) ? raw.models : {};
  const byIssuer: Record<string, FiscalModel[]> = {};
  if (isObject(raw.by_issuer)) {
    for (const [issuerId, list] of Object.entries(raw.by_issuer)) {
      const parsed = modelList(list);
      if (parsed) byIssuer[issuerId] = parsed;
    }
  }
  const intraEu = raw.intra_eu;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : FISCAL_CALENDAR_DEFAULTS.enabled,
    models: {
      company: modelList(models.company) ?? FISCAL_CALENDAR_DEFAULTS.models.company,
      self_employed: modelList(models.self_employed) ?? FISCAL_CALENDAR_DEFAULTS.models.self_employed,
    },
    byIssuer,
    intraEu: intraEu === "auto" || intraEu === "always" || intraEu === "never" ? intraEu : FISCAL_CALENDAR_DEFAULTS.intraEu,
  };
}

export type FiscalIssuer = {
  id: string;
  kind: FiscalIssuerKind;
  name: string;
  /** Socio del autónomo: sus plazos son suyos. Los de la SL, de todos. */
  memberId: string | null;
  activeFrom: CivilDate | null;
  activeUntil: CivilDate | null;
  archived: boolean;
  verifactuFrom: CivilDate;
  fiscalProvider: string;
  /** Si ha facturado operaciones intracomunitarias en los últimos 12 meses (lo calcula el servidor). */
  hasIntraEuOperations: boolean;
};

export type FiscalDeadline = {
  model: FiscalModel;
  issuerId: string;
  period: FiscalPeriod;
  /** Primer día para presentar. */
  opensOn: CivilDate;
  /** Último día según el calendario de la AEAT. */
  statutoryDueOn: CivilDate;
  /** El que se usa: el legal o, si cae en sábado o domingo, el lunes siguiente. */
  dueOn: CivilDate;
};

const QUARTERLY: ReadonlySet<FiscalModel> = new Set(["303", "111", "115", "130", "349"]);
const day =(year: number, month: number, d: number) => formatCivil({ year, month, day: d });

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function isoWeekday(date: CivilDate): number {
  const { year, month, day: d } = parseCivilDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Si el último día de un plazo cae en sábado o domingo, pasa al lunes siguiente. */
export function shiftWeekend(date: CivilDate): CivilDate {
  const weekday = isoWeekday(date);
  return weekday === 6 ? addDays(date, 2) : weekday === 7 ? addDays(date, 1) : date;
}

/** Clave estable de un periodo: "2026-Q3", "2026", "2026-P1". */
export function fiscalPeriodKey(period: FiscalPeriod): string {
  if (period.kind === "quarter") return `${period.year}-Q${period.quarter}`;
  if (period.kind === "installment") return `${period.year}-P${period.index}`;
  return String(period.year);
}

/** Fechas que abarca lo que se declara (para saber si el emisor estaba activo). */
function declaredRange(period: FiscalPeriod): { start: CivilDate; end: CivilDate } {
  if (period.kind === "quarter") {
    const lastMonth = period.quarter * 3;
    return { start: day(period.year, lastMonth - 2, 1), end: day(period.year, lastMonth, daysInMonth(period.year, lastMonth)) };
  }
  if (period.kind === "installment") {
    // Cada pago fraccionado cubre el ejercicio hasta el mes anterior a su plazo.
    const lastMonth = [3, 9, 11][period.index - 1]!;
    return { start: day(period.year, 1, 1), end: day(period.year, lastMonth, daysInMonth(period.year, lastMonth)) };
  }
  return { start: day(period.year, 1, 1), end: day(period.year, 12, 31) };
}

/** Plazo legal [abre, cierra] de un modelo para un periodo. */
function statutoryWindow(model: FiscalModel, period: FiscalPeriod): { opensOn: CivilDate; dueOn: CivilDate } {
  const { year } = period;
  if (period.kind === "quarter") {
    if (period.quarter < 4) {
      const month = period.quarter * 3 + 1;
      return { opensOn: day(year, month, 1), dueOn: day(year, month, 20) };
    }
    return { opensOn: day(year + 1, 1, 1), dueOn: day(year + 1, 1, model === "111" || model === "115" ? 20 : 30) };
  }
  if (period.kind === "installment") {
    const month = [4, 10, 12][period.index - 1]!;
    return { opensOn: day(year, month, 1), dueOn: day(year, month, 20) };
  }
  switch (model) {
    case "200":
      return { opensOn: day(year + 1, 7, 1), dueOn: day(year + 1, 7, 25) };
    case "347":
      return { opensOn: day(year + 1, 2, 1), dueOn: day(year + 1, 2, daysInMonth(year + 1, 2)) };
    case "190":
    case "180":
      return { opensOn: day(year + 1, 1, 1), dueOn: day(year + 1, 1, 31) };
    default:
      return { opensOn: day(year + 1, 1, 1), dueOn: day(year + 1, 1, 30) };
  }
}

/** Periodos de un modelo que se declaran por el ejercicio `year` (sus plazos caen en `year` o `year + 1`). */
function periodsOf(model: FiscalModel, year: number): FiscalPeriod[] {
  if (QUARTERLY.has(model)) return ([1, 2, 3, 4] as const).map((quarter) => ({ kind: "quarter", year, quarter }));
  if (model === "202") return ([1, 2, 3] as const).map((index) => ({ kind: "installment", year, index }));
  return [{ kind: "year", year }];
}

/** Si el emisor estuvo activo en algún momento de [start, end]. Misma regla que al emitir. */
export function issuerActiveDuring(issuer: FiscalIssuer, start: CivilDate, end: CivilDate): boolean {
  if (issuer.archived) return false;
  // La SL sin fecha de alta aún no está constituida; un autónomo sin fecha, sí.
  if (issuer.activeFrom === null && issuer.kind === "company") return false;
  if (issuer.activeFrom !== null && compareCivil(issuer.activeFrom, end) > 0) return false;
  if (issuer.activeUntil !== null && compareCivil(issuer.activeUntil, start) < 0) return false;
  return true;
}

/** Modelos que aplican a un emisor según los ajustes (y las reglas que no se pueden saltar). */
export function modelsForIssuer(issuer: FiscalIssuer, settings: FiscalCalendarSettings): FiscalModel[] {
  const configured = settings.byIssuer[issuer.id] ?? settings.models[issuer.kind];
  return FISCAL_MODELS.filter((model) => {
    if (!configured.includes(model)) return false;
    const only = ONLY_FOR[model];
    if (only && only !== issuer.kind) return false;
    if (model === "349") return settings.intraEu === "always" || (settings.intraEu === "auto" && issuer.hasIntraEuOperations);
    return true;
  });
}

/** Plazos fiscales cuyo último día (ya trasladado) cae en [from, to], por fecha y modelo. */
export function fiscalDeadlines(
  issuers: readonly FiscalIssuer[],
  settings: FiscalCalendarSettings,
  from: CivilDate,
  to: CivilDate,
): FiscalDeadline[] {
  if (!settings.enabled || compareCivil(from, to) > 0) return [];
  const firstYear = parseCivilDate(from).year - 1;
  const lastYear = parseCivilDate(to).year;
  const out: FiscalDeadline[] = [];
  for (const issuer of issuers) {
    for (const model of modelsForIssuer(issuer, settings)) {
      for (let year = firstYear; year <= lastYear; year++) {
        for (const period of periodsOf(model, year)) {
          const { opensOn, dueOn: statutoryDueOn } = statutoryWindow(model, period);
          const dueOn = shiftWeekend(statutoryDueOn);
          if (compareCivil(dueOn, from) < 0 || compareCivil(dueOn, to) > 0) continue;
          const { start, end } = declaredRange(period);
          if (!issuerActiveDuring(issuer, start, end)) continue;
          out.push({ model, issuerId: issuer.id, period, opensOn, statutoryDueOn, dueOn });
        }
      }
    }
  }
  const order = (model: FiscalModel) => FISCAL_MODELS.indexOf(model);
  return out.sort((a, b) => compareCivil(a.dueOn, b.dueOn) || order(a.model) - order(b.model) || a.issuerId.localeCompare(b.issuerId));
}

/** Días antes de la fecha Verifactu en que el calendario la marca como pendiente (como la cuenta atrás). */
const VERIFACTU_ALERT_DAYS = 90;

function deadlineStatus(deadline: FiscalDeadline, today: CivilDate): CalendarEventStatus {
  if (compareCivil(deadline.dueOn, today) < 0) return "past";
  return compareCivil(deadline.opensOn, today) <= 0 ? "pending" : "scheduled";
}

/**
 * Eventos del calendario fiscal en [from, to]: un evento por emisor, modelo y periodo (el ICS los
 * quiere por separado), más la fecha Verifactu de cada emisor no archivado. Los plazos de un
 * autónomo son de su socio; los de la SL, de todos.
 */
export function fiscalEvents(
  issuers: readonly FiscalIssuer[],
  settings: FiscalCalendarSettings,
  range: { from: CivilDate; to: CivilDate; today: CivilDate },
): CalendarEvent[] {
  const byId = new Map(issuers.map((issuer) => [issuer.id, issuer]));
  const owner = (issuer: FiscalIssuer) => (issuer.kind === "self_employed" ? issuer.memberId : null);
  const events: CalendarEvent[] = fiscalDeadlines(issuers, settings, range.from, range.to).map((deadline) => {
    const issuer = byId.get(deadline.issuerId)!;
    const facts: CalendarFact[] = [
      { key: "issuer", type: "text", value: issuer.name },
      { key: "period", type: "fiscalPeriod", value: deadline.period },
      { key: "window", type: "range", from: deadline.opensOn, to: deadline.statutoryDueOn },
    ];
    if (deadline.dueOn !== deadline.statutoryDueOn) facts.push({ key: "statutoryDue", type: "date", value: deadline.statutoryDueOn });
    return {
      id: `fiscal:${issuer.id}:${deadline.model}:${fiscalPeriodKey(deadline.period)}`,
      type: "fiscal",
      kind: deadline.model,
      date: deadline.dueOn,
      time: null,
      startsAt: null,
      title: deadline.model,
      subtitle: issuer.name,
      amountCents: null,
      amountPeriod: null,
      amountBasis: null,
      status: deadlineStatus(deadline, range.today),
      ownerMemberId: owner(issuer),
      href: "/settings/issuers",
      source: { table: "issuers", id: issuer.id },
      movable: false,
      facts,
      links: [],
    };
  });

  if (settings.enabled) {
    for (const issuer of issuers) {
      if (issuer.archived) continue;
      const date = issuer.verifactuFrom;
      if (compareCivil(date, range.from) < 0 || compareCivil(date, range.to) > 0) continue;
      const daysLeft = daysBetween(range.today, date);
      events.push({
        id: `fiscal:${issuer.id}:verifactu`,
        type: "fiscal",
        kind: "verifactu",
        date,
        time: null,
        startsAt: null,
        title: "verifactu",
        subtitle: issuer.name,
        amountCents: null,
        amountPeriod: null,
        amountBasis: null,
        status: daysLeft <= 0 ? "past" : daysLeft <= VERIFACTU_ALERT_DAYS ? "pending" : "scheduled",
        ownerMemberId: owner(issuer),
        href: "/settings/issuers",
        source: { table: "issuers", id: issuer.id },
        movable: false,
        facts: [
          { key: "issuer", type: "text", value: issuer.name },
          { key: "provider", type: "label", value: `provider.${issuer.fiscalProvider}` },
        ],
        links: [],
      });
    }
  }
  return events;
}
