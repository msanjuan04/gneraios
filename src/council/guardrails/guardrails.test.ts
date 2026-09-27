import { describe, expect, it } from "vitest";
import type { RecommendationDraft } from "../agents/schemas";
import { resolvePolicy } from "../policy/schema";
import { RunLedger } from "../runtime/ledger";
import type { Scenario } from "../data/scenario";
import { agencyScenario, toolContext } from "../testing";
import { executeTool } from "../tools/registry";
import { checkDraft, tidyText } from "./index";
import { extractFigures, figureMatches, ungroundedFigures } from "./numbers";
import { adviceClaims, needsProfessionalReview } from "./professional";

const eur = (cents: number, label = "Importe") => ({ value: cents, unit: "eur_cents", label, period: "2026-09" });

describe("cifras en el texto", () => {
  it("lee números a la española y deja fuera fechas, años, periodos, modelos e ids", () => {
    const text =
      "El 26/09/2026 (2026-09-26) quedan 1.452 € vencidos, un 12,5 % del total y 57 días de retraso; en el T3 de 2026 y el 5 de octubre toca el modelo 303. Ver m12 y t3, ago 2026.";
    expect(extractFigures(text).map((f) => f.value)).toEqual([1452, 12.5, 57]);
  });

  it("entiende miles, decimales y sufijos", () => {
    expect(extractFigures("1.234,56 € · 2.000.000 € · 3,5 meses · 12 mil € · 1,2 k€").map((f) => f.value)).toEqual([1234.56, 2_000_000, 3.5, 12_000, 1200]);
  });

  it("los textos que devuelven las tools se pueden copiar tal cual (números de factura, etiquetas)", () => {
    expect(extractFigures("Las facturas F2026-0012 y F2026-0019 de Studio 54", ["F2026-0012", "F2026-0019", "Studio 54"])).toEqual([]);
  });

  it("vale redondear para leer mejor, nunca a una sola cifra ni inventar", () => {
    const f = (raw: string) => extractFigures(raw)[0]!;
    expect(figureMatches(f("1.234,56 €"), 1234.56)).toBe(true);
    expect(figureMatches(f("1.235 €"), 1234.56)).toBe(true);
    expect(figureMatches(f("unos 1.230 €"), 1234.56)).toBe(true);
    expect(figureMatches(f("12,5 %"), 12.53)).toBe(true);
    expect(figureMatches(f("13 %"), 12.53)).toBe(true);
    expect(figureMatches(f("unos 1.200 €"), 1234.56)).toBe(false);
    expect(figureMatches(f("unos 1.000 €"), 1234.56)).toBe(false);
    expect(figureMatches(f("1.500 €"), 1452)).toBe(false);
    expect(figureMatches(f("2.000 €"), 1500)).toBe(false);
    expect(figureMatches(f("1.300 €"), 1234.56)).toBe(false);
  });

  it("una suma o un porcentaje que no está en la evidencia se señala", () => {
    const evidence = [eur(145_200, "Vencido"), eur(75_000, "MRR del cliente"), { value: 57, unit: "days", label: "Días", period: "2026-09-26" }, { value: 1250, unit: "bps", label: "Parte", period: "2026" }];
    expect(ungroundedFigures("Vencen 1.452 € (57 días), el 12,5 % y un MRR de 750 €/mes.", evidence)).toEqual([]);
    expect(ungroundedFigures("Entre las dos suman 2.202 € y es el 19 % del MRR.", evidence)).toEqual(["2.202", "19"]);
  });

  it("las horas se comprueban en horas, como las escriben las tools (2.970 min → 49,5 h)", () => {
    const evidence = [{ value: 2970, unit: "minutes", label: "Horas registradas", period: "2026-06-01/2026-08-31" }];
    expect(ungroundedFigures("Se registraron 49,5 h, unas 50 horas.", evidence)).toEqual([]);
    expect(ungroundedFigures("Son 2.970 minutos, casi 60 horas.", evidence)).toEqual(["2.970", "60"]);
  });

  it("las cifras de la definición de una métrica citada también valen", () => {
    expect(ungroundedFigures("El gasto medio de 3 meses", [eur(130_000, "Gasto medio al mes (3 meses)")])).toEqual([]);
  });
});

describe("revisión profesional", () => {
  it("detecta lo fiscal, laboral y legal (y no confunde al abogado del diablo)", () => {
    expect(needsProfessionalReview("Reservar el IVA del trimestre antes del 20 de octubre")).toBe(true);
    expect(needsProfessionalReview("Subir la retribución de los socios")).toBe(true);
    expect(needsProfessionalReview("Contratar a una persona de diseño")).toBe(true);
    expect(needsProfessionalReview("Llamar al cliente por la factura vencida")).toBe(false);
    expect(needsProfessionalReview("Lo revisó el abogado del diablo")).toBe(false);
    expect(needsProfessionalReview("Proponer que contraten el mantenimiento")).toBe(false);
  });

  it("no se presenta como asesoramiento", () => {
    expect(adviceClaims("Es totalmente legal y no hace falta consultar a la gestoría")).toHaveLength(2);
    expect(adviceClaims("Validar con la gestoría antes de decidir")).toEqual([]);
  });
});

describe("checkDraft", () => {
  async function ledgerWith(tools: [string, unknown][], scenario?: Scenario) {
    const ctx = await toolContext({ scenario });
    const ledger = new RunLedger();
    const views: Record<string, { metrics: { id: string; label: string; value: string }[]; rows: { subject: string; metrics: { id: string; label: string }[] }[] }> = {};
    for (const [name, input] of tools) {
      const outcome = await executeTool(name, input, ctx);
      views[name] = JSON.parse(ledger.record(name, input, outcome, 1).content);
    }
    return { ledger, views, ctx };
  }

  const draft = (overrides: Partial<RecommendationDraft>): RecommendationDraft => ({
    kind: "decision",
    title: "Reclamar las facturas vencidas de la clínica",
    summary: "La clínica debe 1.452 € con 57 días de retraso.",
    reasoning: "Vencido del cliente: 1.452 €.",
    evidence: [],
    impact_ref: null,
    proposed_actions: [{ title: "Llamar a la clínica hoy", due_in_days: 0 }],
    confidence: "alta",
    urgency: "hoy",
    risks: "Que el cliente se enfade.",
    requires_professional_review: false,
    subject: "client:c2",
    policy_rule: null,
    missing_data: [],
    ...overrides,
  });

  it("con la evidencia de la tool: pasa, con el impacto en € y la clave de deduplicación", async () => {
    const { ledger, views, ctx } = await ledgerWith([["get_receivables", {}]]);
    const row = views.get_receivables!.rows[0]!;
    const refs = row.metrics.map((mm) => mm.id);
    const checked = checkDraft(draft({ evidence: refs, impact_ref: refs[0]! }), { ledger, policy: ctx.policy, agent: "retention" });
    expect(checked.issues).toEqual([]);
    expect(checked.rec).toMatchObject({ impactCents: 145_200, dedupeKey: "retention:client:c2", subject: "client:c2" });
    expect(checked.rec!.evidence[0]).toMatchObject({ tool: "get_receivables", unit: "eur_cents", display: "1.452\u00a0€", href: "/invoices?client=c2" });
  });

  it("rechaza una cifra inventada, una evidencia que no existe y un subject que no sale de las tools", async () => {
    const { ledger, views, ctx } = await ledgerWith([["get_receivables", {}]]);
    const refs = views.get_receivables!.rows[0]!.metrics.map((mm) => mm.id);
    const checked = checkDraft(
      draft({ evidence: [...refs, "m999"], summary: "Deben 1.452 € y además calculo que perderemos 9.000 € al año.", subject: "client:inventado" }),
      { ledger, policy: ctx.policy, agent: "retention" },
    );
    expect(checked.rec).toBeNull();
    expect(checked.issues.join("\n")).toMatch(/m999/);
    expect(checked.issues.join("\n")).toMatch(/«9\.000»/);
    expect(checked.issues.join("\n")).toMatch(/client:inventado/);
  });

  it("marca la revisión profesional aunque el agente se olvide", async () => {
    const { ledger, views, ctx } = await ledgerWith([["get_receivables", {}]]);
    const refs = views.get_receivables!.rows[0]!.metrics.map((mm) => mm.id);
    const checked = checkDraft(draft({ evidence: refs, reasoning: "Con el IVA incluido: 1.452 €." }), { ledger, policy: ctx.policy, agent: "retention" });
    expect(checked.rec).toMatchObject({ requiresProfessionalReview: true, flaggedByRunner: true });
  });

  it("no deja proponer subir la retribución si la regla de la política no se cumple", async () => {
    const { ledger, views, ctx } = await ledgerWith([["get_policy", {}]]);
    const rule = views.get_policy!.rows.find((r) => r.subject === "policy:rule:raise_partner_pay")!;
    const base = draft({
      title: "Subir la retribución de los socios",
      summary: "Proponemos subir la retribución de los socios este trimestre (política de ejemplo).",
      reasoning: "La política de ejemplo lo permite.",
      evidence: rule.metrics.map((mm) => mm.id),
      subject: "policy:rule:raise_partner_pay",
    });
    const unmarked = checkDraft(base, { ledger, policy: ctx.policy, agent: "cfo" });
    expect(unmarked.issues.join("\n")).toMatch(/policy_rule/);
    const marked = checkDraft({ ...base, policy_rule: "raise_partner_pay" }, { ledger, policy: ctx.policy, agent: "cfo" });
    expect(marked.issues.join("\n")).toMatch(/Contradice la política de ejemplo/);
  });

  it("no deja proponer contratar sin horas registradas: la regla queda sin datos aunque el pipeline cumpla", async () => {
    const base = agencyScenario();
    const scenario: Scenario = {
      ...base,
      clients: [...base.clients, { id: "c7", name: "Grup Hotels Maresme" }],
      deals: [...base.deals!, { id: "d4", title: "Marketing de cuatro hoteles", clientId: "c7", stageId: "stage-negotiation", estMrrCents: 400_000 }],
    };
    const { ledger, views, ctx } = await ledgerWith([["get_policy", {}]], scenario);
    const rule = views.get_policy!.rows.find((r) => r.subject === "policy:rule:hire")!;
    const checked = checkDraft(
      draft({
        title: "Contratar a una persona para producción",
        summary: "Proponemos contratar a una persona de producción (política de ejemplo).",
        reasoning: "El pipeline ponderado lo permite con la política de ejemplo.",
        evidence: rule.metrics.map((mm) => mm.id),
        subject: "policy:rule:hire",
        policy_rule: "hire",
        requires_professional_review: true,
      }),
      { ledger, policy: ctx.policy, agent: "operations" },
    );
    expect(checked.rec).toBeNull();
    expect(checked.issues.join("\n")).toMatch(/faltan datos para saber si se cumple la regla/);
  });

  it("si cita la política de ejemplo, tiene que decirlo", async () => {
    const { ledger, views } = await ledgerWith([["get_policy", {}]]);
    const threshold = views.get_policy!.metrics.find((mm) => mm.label.startsWith("Umbral de impacto para"))!;
    const checked = checkDraft(
      draft({ title: "Revisar el umbral de impacto", summary: "El umbral es de 300 €.", reasoning: "Umbral de 300 €.", evidence: [threshold.id], subject: "policy" }),
      { ledger, policy: resolvePolicy(null), agent: "chief_of_staff" },
    );
    expect(checked.issues.join("\n")).toMatch(/EJEMPLO/);
  });
});

describe("tidyText", () => {
  it("quita las referencias internas a la evidencia del texto", () => {
    expect(tidyText("Hay una factura vencida de 1.007 € (m33) con 26 días de retraso (m35).")).toBe("Hay una factura vencida de 1.007 € con 26 días de retraso.");
    expect(tidyText("Sin datos de horas de GNERAI (missing en t6) la regla no se cumple.")).toBe("Sin datos de horas de GNERAI la regla no se cumple.");
    expect(tidyText("Caja de 18.488,20 € (m10, m11) y 11 meses (m18 y m19).")).toBe("Caja de 18.488,20 € y 11 meses.");
    expect(tidyText("El MRR (mensual) sube.")).toBe("El MRR (mensual) sube.");
  });
});
