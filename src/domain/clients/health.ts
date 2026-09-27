// Salud de un cliente: señales deterministas y explicables, derivadas de lo que ya hay (facturas
// vencidas, la última actividad, renovaciones, el SEO de su web y su MRR). Nada se guarda: se
// calcula al pintar. Cuenta para clientes activos o en pausa; de un ex-cliente solo importa lo
// que aún debe, y un lead no tiene salud que vigilar.

import { type CivilDate, daysBetween } from "../dates/civil-date";

export type HealthLevel = "good" | "warning" | "danger";

export type HealthSignalKey = "overdue" | "silent" | "renewal" | "seoDrop" | "mrrDrop";

export type HealthSignal = {
  key: HealthSignalKey;
  level: Exclude<HealthLevel, "good">;
  /** Para el texto (i18n): días, importes en céntimos, variación… */
  values: Record<string, number | string>;
};

export type ClientHealth = { level: HealthLevel; signals: HealthSignal[] };

export type HealthInput = {
  status: "lead" | "active" | "paused" | "former";
  /** Facturas vencidas sin cobrar. */
  overdue: { count: number; oldestDueOn: CivilDate; outstandingCents: number } | null;
  /** Último contacto registrado (llamada, reunión, email, nota). */
  lastActivityOn: CivilDate | null;
  /** La renovación anual más próxima dentro de la ventana. */
  renewal: { on: CivilDate; amountCents: number } | null;
  /** Clics de su web: los últimos 28 días frente a los 28 anteriores (null sin datos). */
  seoClicksChange: number | null;
  /** MRR hoy frente a hace 90 días (null si no tenía). */
  mrr: { nowCents: number; beforeCents: number } | null;
};

export const HEALTH_RULES = {
  overdueDangerDays: 30,
  overdueDangerCount: 2,
  silentWarningDays: 60,
  silentDangerDays: 120,
  renewalWarningDays: 30,
  seoWarning: -0.2,
  seoDanger: -0.4,
  mrrWarning: -0.1,
} as const;

const RANK: Record<HealthLevel, number> = { good: 0, warning: 1, danger: 2 };

export function clientHealth(input: HealthInput, today: CivilDate, rules = HEALTH_RULES): ClientHealth {
  if (input.status === "lead") return { level: "good", signals: [] };
  const current = input.status === "active" || input.status === "paused";
  const signals: HealthSignal[] = [];

  if (input.overdue && input.overdue.count > 0) {
    const days = Math.max(0, daysBetween(input.overdue.oldestDueOn, today));
    const danger = days > rules.overdueDangerDays || input.overdue.count >= rules.overdueDangerCount;
    signals.push({
      key: "overdue",
      level: danger ? "danger" : "warning",
      values: { count: input.overdue.count, days, amount_cents: input.overdue.outstandingCents },
    });
  }

  // Un cliente en pausa puede estar callado sin que pase nada.
  if (input.status === "active") {
    const days = input.lastActivityOn === null ? null : daysBetween(input.lastActivityOn, today);
    if (days === null || days > rules.silentWarningDays) {
      signals.push({
        key: "silent",
        level: days === null || days > rules.silentDangerDays ? "danger" : "warning",
        values: { days: days ?? -1 },
      });
    }
  }

  if (current && input.renewal) {
    const days = daysBetween(today, input.renewal.on);
    if (days >= 0 && days <= rules.renewalWarningDays) {
      signals.push({ key: "renewal", level: "warning", values: { days, date: input.renewal.on, amount_cents: input.renewal.amountCents } });
    }
  }

  if (current && input.seoClicksChange !== null && input.seoClicksChange <= rules.seoWarning) {
    signals.push({
      key: "seoDrop",
      level: input.seoClicksChange <= rules.seoDanger ? "danger" : "warning",
      values: { percent: Math.round(input.seoClicksChange * 100) },
    });
  }

  if (current && input.mrr && input.mrr.beforeCents > 0) {
    const change = (input.mrr.nowCents - input.mrr.beforeCents) / input.mrr.beforeCents;
    if (change <= rules.mrrWarning) {
      signals.push({
        key: "mrrDrop",
        level: "warning",
        values: { percent: Math.round(change * 100), now_cents: input.mrr.nowCents, before_cents: input.mrr.beforeCents },
      });
    }
  }

  signals.sort((a, b) => RANK[b.level] - RANK[a.level]);
  const level = signals.reduce<HealthLevel>((worst, s) => (RANK[s.level] > RANK[worst] ? s.level : worst), "good");
  return { level, signals };
}
