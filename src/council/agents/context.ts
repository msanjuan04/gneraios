// Lo que lee el modelo: el contexto compartido (reglas del consejo, la agencia, sus socios, sus
// servicios y la política vigente), que es igual para todos los agentes de la org y se cachea, y el
// mensaje con la tarea de hoy, que va después y cambia en cada ejecución.
//
// El contexto compartido es determinista (orden estable, sin fechas de hoy ni cifras): así el
// prefijo cacheado solo cambia cuando cambian los socios, los servicios o la política.

import { compareCivil } from "@/domain/dates/civil-date";
import { dateInZone } from "@/domain/dates/zoned-time";
import { formatMetricValue, monthLabel } from "../tools/format";
import type { PastRecommendation } from "../tools/types";
import type { CouncilData } from "../data/types";
import type { ResolvedPolicy } from "../policy/schema";
import type { AgentName, EvidenceItem, Task } from "../types";

export const AGENT_TITLES: Record<AgentName, string> = {
  cfo: "CFO · Tesorería y reparto",
  commercial: "Director comercial",
  pricing: "Pricing y margen",
  retention: "Retención y upsell",
  operations: "Operaciones y capacidad",
  growth: "Crecimiento y SEO",
  fiscal: "Fiscal y cumplimiento",
  devils_advocate: "Abogado del diablo",
  chief_of_staff: "Chief of Staff",
};

const ROLE: Record<string, string> = { owner: "owner", partner: "socio", viewer: "solo lectura" };
const BILLING: Record<string, string> = { monthly: "mensual", yearly: "anual", one_off: "puntual", usage: "por uso" };

/** El contexto compartido de la org (se cachea): reglas, agencia, socios, emisores, servicios y política. */
export async function sharedContext(opts: { rules: string; data: CouncilData; policy: ResolvedPolicy; today: string }): Promise<string> {
  const [org, members, issuers, lines] = await Promise.all([opts.data.org(), opts.data.members(), opts.data.issuers(), opts.data.contractLines()]);
  const since = `${String(Number(opts.today.slice(0, 4)) - 1)}${opts.today.slice(4, 7)}-01`;
  const services = new Map<string, string>();
  for (const line of lines) {
    const live = line.endsOn === null || compareCivil(line.endsOn, opts.today) >= 0;
    const recent = compareCivil(line.signedOn, since) >= 0;
    if (!live && !recent) continue;
    const key = `${line.description.trim().toLowerCase()}|${line.billingType}`;
    if (!services.has(key)) services.set(key, `${line.description.trim()} (${BILLING[line.billingType] ?? line.billingType})`);
  }
  const policyLine = opts.policy.isExample
    ? "Política de EJEMPLO (CONSEJO.md §4): los socios aún no han fijado la suya. Todo lo que se base en ella tiene que decirlo."
    : `Política financiera v${opts.policy.version} fijada por los socios${opts.policy.note ? ` («${opts.policy.note}»)` : ""}.`;
  return [
    opts.rules.trim(),
    "",
    "## La agencia",
    `- Organización: ${org.name}. Zona horaria: ${org.timezone}. Moneda: ${org.currency}.`,
    `- Socios: ${[...members].sort((a, b) => a.fullName.localeCompare(b.fullName, "es")).map((m) => `${m.fullName} (${m.initials}, ${ROLE[m.role] ?? m.role})`).join("; ") || "—"}.`,
    `- Emisores: ${[...issuers].sort((a, b) => a.name.localeCompare(b.name, "es")).map((i) => `${i.name} (${i.kind === "company" ? "sociedad" : "autónomo"}, Verifactu desde ${i.verifactuFrom})`).join("; ") || "—"}.`,
    `- Servicios que se venden: ${[...services.values()].sort((a, b) => a.localeCompare(b, "es")).join("; ") || "todavía ninguno"}.`,
    "",
    "## Política financiera",
    `- ${policyLine}`,
    "- Sus valores y el estado de cada regla (subir retribución, contratar, colchón) los da get_policy: cítalos desde ahí.",
    "",
    "## Tools",
    "- Todas son de solo lectura y devuelven cifras ya escritas, cada una con su id (m…). Cita esos ids.",
    "- Solo puedes usar las de tu lista (te la da la tarea); el resto se te denegará.",
  ].join("\n");
}

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

function weekday(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return WEEKDAYS[(day + 6) % 7]!;
}

function pastLines(past: readonly PastRecommendation[]): string {
  if (past.length === 0) return "- (ninguna)";
  return past
    .map((r) => {
      const note = r.decisionNote ? ` — motivo: «${r.decisionNote}»` : "";
      const until = r.postponedUntil ? ` hasta ${r.postponedUntil}` : "";
      return `- [${r.status}${until}] ${r.title} — sobre ${r.subject}${note}`;
    })
    .join("\n");
}

export type TaskPromptInput = {
  agent: AgentName;
  task: Task;
  trigger: string;
  today: string;
  timeZone: string;
  tools: readonly string[];
  maxRecommendations: number;
  /** Lo abierto o descartado hace poco del agente (para no repetir). */
  past: readonly PastRecommendation[];
  payload: Record<string, unknown>;
};

/** El primer mensaje de la ejecución: la tarea de hoy. */
export function taskPrompt(input: TaskPromptInput): string {
  const head = [
    `Hoy es ${weekday(input.today)}, ${input.today} (${input.timeZone}). Eres ${AGENT_TITLES[input.agent]}.`,
    `Disparador: ${input.trigger}.`,
    `Tus tools: ${input.tools.join(", ")}.`,
  ];
  const past = ["", "Lo abierto o descartado hace poco en tu área (no lo repitas; respeta los motivos):", pastLines(input.past)];
  switch (input.task) {
    case "scan":
      return [
        ...head,
        `Tarea: revisa tu área y propone lo que los socios deberían decidir. Como mucho ${input.maxRecommendations} recomendaciones; ninguna si no hay nada relevante.`,
        ...past,
      ].join("\n");
    case "monthly_close": {
      const month = String(input.payload.month ?? "");
      return [
        ...head,
        `Tarea: el cierre de ${month ? monthLabel(month) : "el mes anterior"}. Llama a get_monthly_close${month ? ` con month = "${month.slice(0, 7)}"` : ""} y a get_policy, y prepara el comentario del cierre y, como mucho, ${Math.min(3, input.maxRecommendations)} recomendaciones.`,
        "La propuesta de reparto es la de la tool: coméntala, no la rehagas.",
        ...past,
      ].join("\n");
    }
    case "weekly_briefing":
      return [
        ...head,
        `Tarea: el briefing del lunes para los socios: las ${input.maxRecommendations} acciones críticas como mucho (antes del martes), las alertas de riesgo de la semana, las oportunidades de optimización y los conflictos entre agentes ya resueltos, con la caja y el semáforo. Llama primero a get_past_recommendations con statuses ["nueva","pospuesta","aceptada"]: lo que han visto los otros agentes es la materia prima.`,
      ].join("\n");
    case "challenge":
      return [...head, "Tarea: revisar esta recomendación de impacto alto antes de publicarla.", "", String(input.payload.draft ?? "")].join("\n");
    case "review":
      return [...head, "Tarea: el seguimiento de una recomendación aceptada: ¿ha pasado lo que se estimó?", "", String(input.payload.recommendation ?? "")].join("\n");
  }
}

/** La recomendación que revisa el abogado del diablo, con su evidencia ya en el libro de esta ejecución. */
export function draftForChallenge(opts: {
  agent: AgentName;
  rec: { title: string; summary: string; reasoning: string; risks: string | null; confidence: string; urgency: string; impactCents: number | null };
  evidence: readonly (EvidenceItem & { newRef: string })[];
}): string {
  return JSON.stringify(
    {
      agente: AGENT_TITLES[opts.agent],
      titulo: opts.rec.title,
      resumen: opts.rec.summary,
      razonamiento: opts.rec.reasoning,
      riesgos: opts.rec.risks,
      confianza: opts.rec.confidence,
      urgencia: opts.rec.urgency,
      impacto: opts.rec.impactCents === null ? null : formatMetricValue(opts.rec.impactCents, "eur_cents"),
      evidencia: opts.evidence.map((e) => ({ id: e.newRef, label: e.label, value: e.display, period: e.period, tool: e.tool })),
    },
    null,
    2,
  );
}

/** Día civil de un instante en la zona de la org. */
export function localDate(instant: Date, timeZone: string): string {
  return dateInZone(instant, timeZone);
}
