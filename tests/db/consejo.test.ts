import { beforeEach, describe, expect, it } from "vitest";
import { as, createDb, createOrg, createUser, type Db, onboardingPayload } from "./harness";

// Consejo de agentes (supabase/migrations/20260926220000_consejo.sql): la política versionada e
// inmutable, las decisiones de los socios sobre las recomendaciones (tareas y revisiones), el
// cierre mensual, la cola solo para el servidor y quién ve qué.

let db: Db;
let owner: string;
let partner: string;
let viewer: string;
let outsider: string;
let orgId: string;
let otherOrgId: string;

async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await rows<T>(sql, params))[0]!;
}

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

const asUser = <T>(userId: string | null, sql: string, params: unknown[] = []) => as(db, userId, () => rows<T>(sql, params));

async function addMember(userId: string, role: "partner" | "viewer", name: string) {
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, $3, $4, $5)", [
    orgId,
    userId,
    role,
    name,
    name.slice(0, 2).toUpperCase(),
  ]);
}

let recCount = 0;

/** Inserta una recomendación como lo hace el runner (service_role). */
async function insertRecommendation(overrides: Record<string, unknown> = {}): Promise<string> {
  recCount += 1;
  const row = {
    org_id: orgId,
    agent: "retention",
    kind: "decision",
    title: `Recomendación ${recCount}`,
    summary: "Resumen",
    reasoning: "Razonamiento",
    evidence: JSON.stringify([{ ref: "m1", tool: "get_receivables", label: "Vencido", value: 120000, unit: "eur_cents", display: "1.200 €" }]),
    proposed_actions: JSON.stringify([{ title: "Llamar al cliente", due_in_days: 2 }, { title: "Enviar el recordatorio" }]),
    impact_eur_cents: 120000,
    confidence: "alta",
    urgency: "esta_semana",
    subject: `client:${recCount}`,
    dedupe_key: `retention:client:${recCount}`,
    ...overrides,
  };
  const columns = Object.keys(row);
  return asService(async () =>
    (
      await one<{ id: string }>(
        `insert into public.recommendations (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
        Object.values(row),
      )
    ).id,
  );
}

const today = async () => (await one<{ d: string }>("select (now() at time zone 'Europe/Madrid')::date::text as d")).d;

beforeEach(async () => {
  db = await createDb();
  owner = await createUser(db, "owner@example.com");
  partner = await createUser(db, "partner@example.com");
  viewer = await createUser(db, "viewer@example.com");
  outsider = await createUser(db, "outsider@example.com");
  orgId = await createOrg(db, owner);
  otherOrgId = await createOrg(db, outsider, onboardingPayload({ org: { name: "Otra agencia", slug: "otra" }, invitations: [] }));
  await addMember(partner, "partner", "Socia Dos");
  await addMember(viewer, "viewer", "Lectora Tres");
});

describe("reglas de venta cruzada", () => {
  it("toda org nueva recibe las reglas por defecto, como datos editables por un owner", async () => {
    const mine = await asUser<{ label: string }>(viewer, "select label from public.upsell_rules where org_id = $1 order by position", [orgId]);
    expect(mine.map((r) => r.label)).toEqual([
      "Web sin mantenimiento",
      "Web sin SEO",
      "Ads sin landing",
      "SEO sin informe mensual",
      "Un solo servicio desde hace más de 6 meses",
    ]);
    const updated = await asUser(owner, "update public.upsell_rules set reference_mrr_cents = 9000 where org_id = $1 and position = 1 returning id", [orgId]);
    expect(updated).toHaveLength(1);
    const byPartner = await asUser(partner, "update public.upsell_rules set reference_mrr_cents = 1 where org_id = $1 returning id", [orgId]);
    expect(byPartner).toHaveLength(0);
    // La otra org no ve las reglas de esta.
    expect(await asUser(outsider, "select id from public.upsell_rules where org_id = $1", [orgId])).toHaveLength(0);
  });
});

describe("política financiera", () => {
  const policy = { cushion_months: 4, corporate_tax_provision_bps: 2500 };

  it("cada guardado es una versión nueva e inmutable; la guarda un owner", async () => {
    const [{ v: v1 }] = await asUser<{ v: number }>(owner, "select public.save_financial_policy($1, $2::jsonb, 'Primera') as v", [
      orgId,
      JSON.stringify(policy),
    ]);
    const [{ v: v2 }] = await asUser<{ v: number }>(owner, "select public.save_financial_policy($1, $2::jsonb) as v", [
      orgId,
      JSON.stringify({ ...policy, cushion_months: 6 }),
    ]);
    expect([v1, v2]).toEqual([1, 2]);

    const read = await asUser<{ version: number; note: string | null }>(
      viewer,
      "select version, note from public.financial_policies where org_id = $1 order by version",
      [orgId],
    );
    expect(read).toEqual([
      { version: 1, note: "Primera" },
      { version: 2, note: null },
    ]);

    await expect(asUser(partner, "select public.save_financial_policy($1, $2::jsonb)", [orgId, JSON.stringify(policy)])).rejects.toMatchObject({
      code: "42501",
    });
    await expect(asUser(owner, "select public.save_financial_policy($1, '[]'::jsonb)", [orgId])).rejects.toMatchObject({ hint: "policy_invalid" });
    await expect(asUser(owner, "insert into public.financial_policies (org_id, version, data) values ($1, 9, '{}')", [orgId])).rejects.toThrow();
    // Ni el servidor la reescribe.
    await expect(
      asService(() => db.query("update public.financial_policies set data = '{}' where org_id = $1", [orgId])),
    ).rejects.toMatchObject({ hint: "policy_immutable" });
    await expect(asService(() => db.query("delete from public.financial_policies where org_id = $1", [orgId]))).rejects.toMatchObject({
      hint: "policy_immutable",
    });
    expect(await asUser(outsider, "select id from public.financial_policies where org_id = $1", [orgId])).toHaveLength(0);
  });
});

describe("ajustes de los agentes", () => {
  it("los ve cualquier miembro y los cambia un owner", async () => {
    await asUser(owner, "insert into public.agent_settings (org_id, agent, enabled, model, monthly_budget_usd_cents) values ($1, 'cfo', false, 'claude-opus-5-5', 1500)", [
      orgId,
    ]);
    expect(await asUser(viewer, "select agent, enabled from public.agent_settings where org_id = $1", [orgId])).toEqual([{ agent: "cfo", enabled: false }]);
    expect(await asUser(partner, "update public.agent_settings set enabled = true where org_id = $1 returning id", [orgId])).toHaveLength(0);
    await expect(asUser(partner, "insert into public.agent_settings (org_id, agent) values ($1, 'growth')", [orgId])).rejects.toThrow();
    await expect(asUser(owner, "insert into public.agent_settings (org_id, agent, model) values ($1, 'growth', 'Claude Opus!')", [orgId])).rejects.toThrow();
  });
});

describe("cola y ejecuciones", () => {
  it("la cola es solo del servidor; un socio encola con «Ejecutar ahora» y no duplica", async () => {
    await expect(asUser(owner, "select * from public.agent_jobs")).rejects.toThrow();
    const [{ id }] = await asUser<{ id: string }>(partner, "select public.council_enqueue_run($1, 'cfo') as id", [orgId]);
    const [{ id: again }] = await asUser<{ id: string }>(owner, "select public.council_enqueue_run($1, 'cfo') as id", [orgId]);
    expect(again).toBe(id);
    await expect(asUser(viewer, "select public.council_enqueue_run($1, 'cfo')", [orgId])).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(outsider, "select public.council_enqueue_run($1, 'cfo')", [orgId])).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(partner, "select public.council_enqueue_run($1, 'devils_advocate')", [orgId])).rejects.toMatchObject({
      hint: "agent_not_runnable",
    });

    const job = await one<{ requested_by: string; status: string; trigger: string }>(
      "select requested_by, status, trigger from public.agent_jobs where id = $1",
      [id],
    );
    expect(job).toEqual({ requested_by: partner, status: "pending", trigger: "manual" });
  });

  it("el worker reclama trabajos una sola vez y recupera los colgados", async () => {
    await asService(() =>
      db.query(
        `insert into public.agent_jobs (org_id, agent, trigger, dedupe_key) values
           ($1, 'commercial', 'daily', 'commercial:daily:2026-09-26'),
           ($1, 'retention', 'weekly', 'retention:weekly:2026-W39'),
           ($1, 'growth', 'monthly', null)`,
        [orgId],
      ),
    );
    await expect(
      asService(() => db.query("insert into public.agent_jobs (org_id, agent, trigger, dedupe_key) values ($1, 'commercial', 'daily', 'commercial:daily:2026-09-26')", [orgId])),
    ).rejects.toMatchObject({ code: "23505" });

    const first = await asService(() => rows<{ agent: string; attempts: number; status: string }>("select agent, attempts, status from public.claim_agent_jobs(2)"));
    expect(first).toHaveLength(2);
    expect(first.every((j) => j.status === "running" && j.attempts === 1)).toBe(true);
    const second = await asService(() => rows<{ agent: string }>("select agent from public.claim_agent_jobs(5)"));
    expect(second).toHaveLength(1);
    expect(await asService(() => rows("select * from public.claim_agent_jobs(5)"))).toHaveLength(0);

    // Uno colgado hace una hora vuelve a la cola; otro que ya agotó los intentos se da por fallido.
    await db.query("update public.agent_jobs set locked_at = now() - interval '1 hour' where org_id = $1 and agent in ('commercial', 'growth')", [orgId]);
    await db.query("update public.agent_jobs set attempts = 2 where org_id = $1 and agent = 'growth'", [orgId]);
    const recovered = await asService(() => rows<{ agent: string }>("select agent from public.claim_agent_jobs(5)"));
    expect(recovered.map((j) => j.agent)).toEqual(["commercial"]);
    expect((await one<{ status: string }>("select status from public.agent_jobs where org_id = $1 and agent = 'growth'", [orgId])).status).toBe("failed");

    await expect(asUser(owner, "select * from public.claim_agent_jobs(5)")).rejects.toThrow();
  });

  it("las ejecuciones las lee un owner; el estado del consejo, cualquier miembro", async () => {
    await asService(() =>
      db.query(
        `insert into public.agent_runs (org_id, agent, trigger, runtime, model, status, input_tokens, output_tokens, cost_usd_micros)
         values ($1, 'cfo', 'monthly_close', 'claude', 'claude-opus-5-5', 'succeeded', 1000, 200, 8000),
                ($1, 'cfo', 'manual', 'claude', 'claude-opus-5-5', 'succeeded', 1000, 200, 2000),
                ($2, 'cfo', 'manual', 'claude', 'claude-opus-5-5', 'succeeded', 1000, 200, 99000)`,
        [orgId, otherOrgId],
      ),
    );
    expect(await asUser(owner, "select id from public.agent_runs where org_id = $1", [orgId])).toHaveLength(2);
    expect(await asUser(partner, "select id from public.agent_runs where org_id = $1", [orgId])).toHaveLength(0);
    await expect(
      asUser(owner, "insert into public.agent_runs (org_id, agent, trigger, runtime) values ($1, 'cfo', 'manual', 'claude')", [orgId]),
    ).rejects.toThrow();

    const status = await asUser<{ agent: string; month_cost_usd_micros: string; pending_jobs: number }>(
      viewer,
      "select agent, month_cost_usd_micros::text, pending_jobs from public.council_status($1)",
      [orgId],
    );
    expect(status).toHaveLength(9);
    expect(status.find((s) => s.agent === "cfo")!.month_cost_usd_micros).toBe("10000");
    expect(await asUser(outsider, "select * from public.council_status($1)", [orgId])).toHaveLength(0);
  });
});

describe("recomendaciones", () => {
  it("las ve cualquier miembro; decidir es cosa de un socio y solo toca estado, motivo y fecha", async () => {
    const id = await insertRecommendation();
    expect(await asUser(viewer, "select title from public.recommendations where id = $1", [id])).toHaveLength(1);
    expect(await asUser(outsider, "select title from public.recommendations where id = $1", [id])).toHaveLength(0);
    await expect(asUser(partner, "update public.recommendations set title = 'Otra cosa' where id = $1", [id])).rejects.toThrow();
    await expect(asUser(partner, "update public.recommendations set impact_eur_cents = 1 where id = $1", [id])).rejects.toThrow();
    expect(await asUser(viewer, "update public.recommendations set status = 'aceptada' where id = $1 returning id", [id])).toHaveLength(0);
    await expect(
      asUser(partner, "insert into public.recommendations (org_id, agent, title, summary, reasoning, confidence, urgency, subject, dedupe_key) values ($1, 'cfo', 't', 's', 'r', 'alta', 'hoy', 's', 'k')", [orgId]),
    ).rejects.toThrow();
  });

  it("aceptar crea las tareas y programa las revisiones a 30, 60 y 90 días", async () => {
    const id = await insertRecommendation();
    const day = await today();
    const [decided] = await asUser<{ status: string; decided_by: string; decided_at: string | null }>(
      partner,
      "update public.recommendations set status = 'aceptada' where id = $1 returning status, decided_by, decided_at",
      [id],
    );
    expect(decided).toMatchObject({ status: "aceptada", decided_by: partner });
    expect(decided!.decided_at).not.toBeNull();

    const tasks = await asUser<{ title: string; due_on: string | null; position: number }>(
      viewer,
      "select title, due_on::text, position from public.council_tasks where recommendation_id = $1 order by position",
      [id],
    );
    const inTwoDays = (await one<{ d: string }>("select ($1::date + 2)::text as d", [day])).d;
    expect(tasks).toEqual([
      { title: "Llamar al cliente", due_on: inTwoDays, position: 1 },
      { title: "Enviar el recordatorio", due_on: null, position: 2 },
    ]);
    const reviews = await asUser<{ horizon_days: number; estimated_impact_cents: string; state: string }>(
      viewer,
      "select horizon_days, estimated_impact_cents::text, state from public.recommendation_reviews where recommendation_id = $1 order by horizon_days",
      [id],
    );
    expect(reviews).toEqual([
      { horizon_days: 30, estimated_impact_cents: "120000", state: "pending" },
      { horizon_days: 60, estimated_impact_cents: "120000", state: "pending" },
      { horizon_days: 90, estimated_impact_cents: "120000", state: "pending" },
    ]);

    // Una tarea hecha deja quién la hizo; un lector no puede tocarlas.
    const [task] = await asUser<{ done_by: string }>(
      partner,
      "update public.council_tasks set done_at = now() where recommendation_id = $1 and position = 1 returning done_by",
      [id],
    );
    expect(task!.done_by).toBe(partner);
    expect(await asUser(viewer, "update public.council_tasks set done_at = now() where recommendation_id = $1 returning id", [id])).toHaveLength(0);

    // Hecha es el final del camino.
    await asUser(partner, "update public.recommendations set status = 'hecha' where id = $1", [id]);
    await expect(asUser(partner, "update public.recommendations set status = 'nueva' where id = $1", [id])).rejects.toMatchObject({
      hint: "recommendation_transition",
    });
  });

  it("descartar pide el motivo en una línea; posponer, una fecha futura", async () => {
    const id = await insertRecommendation();
    await expect(asUser(partner, "update public.recommendations set status = 'descartada' where id = $1", [id])).rejects.toMatchObject({
      hint: "discard_reason_required",
    });
    await expect(
      asUser(partner, "update public.recommendations set status = 'descartada', decision_note = E'Dos\\nlíneas' where id = $1", [id]),
    ).rejects.toThrow();
    await expect(asUser(partner, "update public.recommendations set status = 'pospuesta' where id = $1", [id])).rejects.toMatchObject({
      hint: "postpone_date_required",
    });

    const postponed = await asUser<{ postponed_until: string }>(
      partner,
      "update public.recommendations set status = 'pospuesta', postponed_until = (now() at time zone 'Europe/Madrid')::date + 7 where id = $1 returning postponed_until::text",
      [id],
    );
    expect(postponed).toHaveLength(1);
    const [discarded] = await asUser<{ status: string; decision_note: string; postponed_until: string | null }>(
      partner,
      "update public.recommendations set status = 'descartada', decision_note = '  Ya lo hablamos con el cliente  ' where id = $1 returning status, decision_note, postponed_until",
      [id],
    );
    expect(discarded).toEqual({ status: "descartada", decision_note: "Ya lo hablamos con el cliente", postponed_until: null });
    // Descartar no crea tareas.
    expect(await asUser(viewer, "select id from public.council_tasks where recommendation_id = $1", [id])).toHaveLength(0);
  });

  it("no hay dos abiertas con la misma clave; cerrada una, puede volver a salir", async () => {
    const id = await insertRecommendation({ dedupe_key: "retention:client:x", subject: "client:x" });
    await expect(insertRecommendation({ dedupe_key: "retention:client:x", subject: "client:x" })).rejects.toMatchObject({ code: "23505" });
    await asUser(partner, "update public.recommendations set status = 'descartada', decision_note = 'No toca' where id = $1", [id]);
    await expect(insertRecommendation({ dedupe_key: "retention:client:x", subject: "client:x" })).resolves.toBeTypeOf("string");
  });
});

describe("cierre mensual", () => {
  async function insertClose(distribution: unknown): Promise<string> {
    return asService(async () =>
      (
        await one<{ id: string }>(
          `insert into public.council_reports (org_id, kind, agent, period_start, period_end, content, policy_version)
           values ($1, 'monthly_close', 'cfo', '2026-08-01', '2026-08-31', $2::jsonb, null) returning id`,
          [orgId, JSON.stringify({ distribution })],
        )
      ).id,
    );
  }

  const buckets = { taxes: 250000, cushion: 300000, reinvestment: 135000, partners: 315000 };

  it("un socio acepta el reparto (editado o no) si suma lo disponible, y queda congelado", async () => {
    const id = await insertClose({ available_cents: 1_000_000, buckets });
    expect(await asUser(viewer, "select id from public.council_reports where id = $1", [id])).toHaveLength(1);
    await expect(asUser(viewer, "select public.accept_monthly_close($1, $2::jsonb)", [id, JSON.stringify(buckets)])).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      asUser(partner, "select public.accept_monthly_close($1, $2::jsonb)", [id, JSON.stringify({ ...buckets, partners: 1 })]),
    ).rejects.toMatchObject({ hint: "close_sum_mismatch" });
    await expect(
      asUser(partner, "select public.accept_monthly_close($1, $2::jsonb)", [id, JSON.stringify({ ...buckets, partners: -315000, cushion: 930000 })]),
    ).rejects.toMatchObject({ hint: "close_invalid" });

    const edited = { ...buckets, cushion: 400000, partners: 215000 };
    await asUser(partner, "select public.accept_monthly_close($1, $2::jsonb, 'Más colchón este mes')", [id, JSON.stringify(edited)]);
    const accepted = await one<{ status: string; decision: { buckets: unknown; edited: boolean }; decided_by: string; decision_note: string }>(
      "select status, decision, decided_by, decision_note from public.council_reports where id = $1",
      [id],
    );
    expect(accepted).toMatchObject({ status: "accepted", decided_by: partner, decision_note: "Más colchón este mes" });
    expect(accepted.decision).toMatchObject({ buckets: edited, edited: true });

    await expect(asUser(partner, "select public.accept_monthly_close($1, $2::jsonb)", [id, JSON.stringify(buckets)])).rejects.toMatchObject({
      hint: "close_already_accepted",
    });
    await expect(asService(() => db.query("update public.council_reports set content = '{}' where id = $1", [id]))).rejects.toMatchObject({
      hint: "report_immutable",
    });
    // Un segundo cierre del mismo mes se puede proponer, pero no aceptar.
    const second = await insertClose({ available_cents: 1_000_000, buckets });
    await expect(asUser(partner, "select public.accept_monthly_close($1, $2::jsonb)", [second, JSON.stringify(buckets)])).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("sin propuesta de reparto (faltan gastos o caja) no hay nada que aceptar", async () => {
    const id = await insertClose(null);
    await expect(asUser(partner, "select public.accept_monthly_close($1, $2::jsonb)", [id, JSON.stringify(buckets)])).rejects.toMatchObject({
      hint: "close_not_available",
    });
  });
});

describe("anon", () => {
  it("no ve nada del consejo", async () => {
    for (const table of ["recommendations", "council_reports", "financial_policies", "agent_settings", "upsell_rules", "council_tasks"]) {
      await expect(asUser(null, `select * from public.${table}`)).rejects.toThrow();
    }
    await expect(asUser(null, "select * from public.council_status($1)", [orgId])).rejects.toThrow();
  });
});
