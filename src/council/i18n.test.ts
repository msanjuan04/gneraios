import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { cadenceOf } from "@/components/council/cadence";
import messages from "@/i18n/messages/es";
import { THRESHOLD_LIMITS } from "./agents.config";
import { AGENTS } from "./agents";
import { BRIEFING_AREAS, TRAFFIC_LIGHTS } from "./agents/schemas";
import { POLICY_FIELD_KIND } from "./policy/form";
import { TOOL_NAMES } from "./tools/registry";
import { AGENT_NAMES, CONFIDENCES, RECOMMENDATION_KINDS, RECOMMENDATION_STATUSES, URGENCIES } from "./types";

// Los textos del consejo (council.json): cada valor que sale de un enum del código tiene su
// etiqueta y los mensajes con parámetros se formatean sin errores.

describe("textos del consejo (es)", () => {
  const errors: string[] = [];
  const t = createTranslator({ locale: "es", messages, namespace: "council", onError: (e) => errors.push(e.message) }) as unknown as ((
    key: string,
    params?: Record<string, string | number>,
  ) => string) & { has: (key: string) => boolean };

  it("cada agente, tool, estado, área y umbral tiene su texto", () => {
    const keys = [
      ...AGENT_NAMES.flatMap((a) => [`agents.${a}.name`, `agents.${a}.mission`]),
      ...TOOL_NAMES.map((tool) => `tools.${tool}`),
      ...RECOMMENDATION_STATUSES.map((s) => `status.${s}`),
      ...URGENCIES.map((u) => `urgency.${u}`),
      ...CONFIDENCES.map((c) => `confidence.${c}`),
      ...RECOMMENDATION_KINDS.map((k) => `kind.${k}`),
      ...BRIEFING_AREAS.map((a) => `briefing.area.${a}`),
      ...TRAFFIC_LIGHTS.map((l) => `briefing.light.${l}`),
      ...Object.keys(THRESHOLD_LIMITS).flatMap((k) => [`settings.thresholds.${k}.label`, `settings.thresholds.${k}.hint`, `settings.thresholds.${k}.unit`]),
      ...Object.keys(POLICY_FIELD_KIND).flatMap((f) => [`policy.fields.${f}.label`, `policy.fields.${f}.hint`]),
      ...["ok", "missing_data", "error", "denied"].map((s) => `runs.callStatus.${s}`),
      ...["running", "succeeded", "failed", "skipped"].map((s) => `runs.statuses.${s}`),
    ];
    expect(keys.filter((key) => !t.has(key))).toEqual([]);
  });

  it("los mensajes con parámetros se formatean", () => {
    expect(AGENT_NAMES.map((a) => t(`cadence.${cadenceOf(AGENTS[a]).key}`, cadenceOf(AGENTS[a]).values))).toEqual([
      "El día 5 de cada mes",
      "Cada día a las 8:00",
      "El día 10 de cada mes",
      "Los miércoles a las 8:00",
      "Los jueves a las 8:00",
      "El día 15 de cada mes",
      "El día 1 de cada mes",
      "Antes de publicar lo de impacto alto",
      "Los lunes a las 8:00",
    ]);
    expect(t("card.acceptTitle", { count: 2 })).toBe("Al aceptar se crean estas 2 tareas:");
    expect(t("card.dueIn", { days: 0 })).toBe("para hoy");
    expect(t("runs.resultLine", { published: 1, silenced: 2, attempts: 3 })).toBe("Una publicada · 2 silenciadas · 3 intentos");
    expect(t("briefing.decisions", { count: 3 })).toBe("Las 3 decisiones de la semana");
    expect(t("settings.thresholds.stalled_days.hint", { default: 21, min: 1, max: 365 })).toBe("Días sin cambiar de etapa ni actividad. Por defecto 21 (1-365).");
    expect(t("settings.rules.showArchived", { count: 1 })).toBe("Ver la archivada");
    expect(t("policy.changedCount", { count: 4 })).toBe("4 cambios sin guardar");
    expect(errors).toEqual([]);
  });
});
