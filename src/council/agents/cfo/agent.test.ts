import { describe, expect, it } from "vitest";
import { runJob } from "../../runner";
import type { FakeScript } from "../../runtime/fake";
import { agencyScenario, claimedJob, financeFixture, runnerDeps } from "../../testing";
import { cfo } from "./agent";

// El CFO de principio a fin con FakeRuntime: cierre de agosto de 2026 con y sin datos de Finanzas.

const withFinance: FakeScript = async (s) => {
  await s.call("get_monthly_close", { month: "2026-08" });
  await s.call("get_policy");
  await s.call("get_tax_provisions");
  return {
    close: {
      headline: "Agosto: 3.340 € recurrentes y propuesta de reparto con la política de ejemplo",
      summary: "En agosto se facturaron 3.340 € recurrentes y se cobraron 3.133,90 €. Quedan 1.452 € pendientes de cobro, de los que 544,50 € ya están vencidos.",
      highlights: [
        { text: "Beneficio de 1.940 € antes de Sociedades.", evidence: ["close.profit"] },
        { text: "Hay 1.180,20 € de IVA pendiente de ingresar.", evidence: ["close.taxes_due"] },
      ],
      distribution_comment:
        "Con la política de ejemplo: 485 € para impuestos, nada para el colchón porque la caja libre lo cubre, 436,50 € de reinversión y 1.018,50 € para los socios. Validar con la gestoría antes de repartir.",
      evidence: [
        "close.revenue.recurring",
        "close.collected",
        "close.outstanding",
        "close.overdue",
        "close.distribution.taxes",
        "close.distribution.cushion",
        "close.distribution.reinvestment",
        "close.distribution.partners",
      ],
    },
    recommendations: [
      {
        kind: "decision",
        title: "Reservar el IVA del tercer trimestre antes del 20 de octubre",
        summary: "El IVA a ingresar del trimestre es de 1.180,20 € y el plazo acaba en 24 días.",
        reasoning: "Repercutido de 1.600,20 € menos soportado de 420 €, según get_tax_provisions.",
        evidence: ["tax.2026-Q3.issuer-sl.vat_payable", "tax.2026-Q3.days_left", "tax.2026-Q3.issuer-sl.vat_output", "tax.2026-Q3.issuer-sl.vat_input"],
        impact_ref: "tax.2026-Q3.issuer-sl.vat_payable",
        proposed_actions: [{ title: "Pasar a la gestoría las cifras del trimestre", due_in_days: 7 }],
        confidence: "alta",
        urgency: "esta_semana",
        risks: "El soportado puede cambiar si faltan gastos por registrar.",
        requires_professional_review: true,
        subject: "tax:2026-Q3:issuer-sl",
        policy_rule: null,
        missing_data: [],
      },
    ],
  };
};

const withoutFinance: FakeScript = async (s) => {
  const close = (await s.call("get_monthly_close", { month: "2026-08" })).json as { call: string };
  await s.call("get_policy");
  return {
    close: {
      headline: "Agosto sin propuesta de reparto: faltan gastos y caja (política de ejemplo)",
      summary: "En agosto se facturaron 3.340 € recurrentes y se cobraron 3.133,90 €. Sin gastos ni saldo de caja no se puede proponer el reparto.",
      highlights: [],
      distribution_comment: "No hay propuesta: faltan los gastos de agosto y el saldo de caja.",
      evidence: ["close.revenue.recurring", "close.collected", close.call],
    },
    recommendations: [
      {
        kind: "data_gap",
        title: "Registrar los gastos y el saldo de caja para poder cerrar el mes",
        summary: "Sin gastos ni caja el consejo no puede proponer cuánto guardar ni cuánto repartir.",
        reasoning: "get_monthly_close devuelve missing_data para el reparto.",
        evidence: [close.call],
        impact_ref: null,
        proposed_actions: [{ title: "Registrar los gastos de agosto en Finanzas", due_in_days: 7 }],
        confidence: "alta",
        urgency: "esta_semana",
        risks: "Ninguno.",
        requires_professional_review: false,
        subject: "close:2026-08",
        policy_rule: null,
        missing_data: ["Gastos de agosto", "Saldo de caja"],
      },
    ],
  };
};

describe("definición del CFO", () => {
  it("cierre mensual el día 5 con el modelo profundo, y sus tools incluyen el cierre y la caja", () => {
    expect(cfo.schedules).toEqual([{ task: "monthly_close", trigger: "monthly_close", schedule: { kind: "monthly", day: 5, hour: 8 } }]);
    expect(cfo.manualTask).toBe("monthly_close");
    expect(cfo.tools).toEqual(expect.arrayContaining(["get_monthly_close", "get_cash_position", "get_runway", "get_policy", "simulate"]));
  });
});

describe("cierre mensual del CFO", () => {
  it("con Finanzas: guarda el informe con el reparto de la tool y publica la recomendación de IVA", async () => {
    const deps = runnerDeps({ scenario: { ...agencyScenario(), finance: financeFixture() }, scripts: { "cfo:monthly_close": withFinance } });
    const job = await claimedJob(deps.store, { agent: "cfo", trigger: "monthly_close", payload: { task: "monthly_close", month: "2026-08-01" } });
    const outcome = await runJob(deps, job);
    expect(outcome).toMatchObject({ status: "done", error: null });
    expect(outcome.published).toHaveLength(1);

    const report = deps.store.reports[0]!;
    expect(report).toMatchObject({ kind: "monthly_close", agent: "cfo", periodStart: "2026-08-01", periodEnd: "2026-08-31", policyVersion: null });
    expect(report.content.distribution).toMatchObject({
      available_cents: 194_000,
      buckets: { taxes: 48_500, cushion: 0, reinvestment: 43_650, partners: 101_850 },
    });
    expect(report.content.requires_professional_review).toBe(true);
    expect((report.content.figures as { key: string }[]).map((f) => f.key)).toContain("close.distribution.partners");

    const rec = deps.store.recommendations[0]!;
    expect(rec).toMatchObject({ agent: "cfo", requiresProfessionalReview: true, impactCents: 118_020, dedupeKey: "cfo:tax:2026-Q3:issuer-sl", status: "nueva" });
    expect(rec.evidence.every((e) => e.tool === "get_tax_provisions")).toBe(true);

    const run = deps.store.runs[0]!;
    expect(run).toMatchObject({ agent: "cfo", runtime: "fake", model: "claude-opus-5-5", status: "succeeded" });
    expect(run.toolCalls.map((c) => c.name)).toEqual(["get_monthly_close", "get_policy", "get_tax_provisions"]);
    expect(run.costUsdMicros).toBeGreaterThan(0);
    expect(deps.store.jobs[0]!.status).toBe("done");
  });

  it("sin Finanzas: el cierre dice qué falta y propone conseguirlo, sin inventar el reparto", async () => {
    const deps = runnerDeps({ scripts: { "cfo:monthly_close": withoutFinance } });
    const job = await claimedJob(deps.store, { agent: "cfo", trigger: "manual", payload: {} });
    const outcome = await runJob(deps, job);
    expect(outcome.status).toBe("done");
    const report = deps.store.reports[0]!;
    expect(report.content.distribution).toBeNull();
    expect(report.content.missing).toMatchObject({ href: "/finance" });
    expect(report.evidence.find((e) => e.unit === "missing")).toMatchObject({ tool: "get_monthly_close", display: "sin datos" });
    expect(deps.store.recommendations[0]).toMatchObject({ kind: "data_gap", impactCents: null, subject: "close:2026-08" });
  });

  it("si el comentario rehace el reparto con cifras propias, se rechaza y no se guarda nada", async () => {
    const invented: FakeScript = async (s) => {
      const output = (await withFinance(s)) as { close: { distribution_comment: string } };
      output.close.distribution_comment = "Mejor repartir 2.000 € a los socios y dejar 60 € de colchón (política de ejemplo).";
      return output;
    };
    const deps = runnerDeps({ scenario: { ...agencyScenario(), finance: financeFixture() }, scripts: { "cfo:monthly_close": invented } });
    const outcome = await runJob(deps, await claimedJob(deps.store, { agent: "cfo", trigger: "monthly_close", payload: { task: "monthly_close", month: "2026-08-01" } }));
    expect(outcome.status).toBe("failed");
    expect(deps.store.reports).toHaveLength(0);
    expect(deps.store.runs[0]!.attempts).toBe(3);
    expect(deps.store.runs[0]!.error).toMatch(/2\.000/);
  });
});
