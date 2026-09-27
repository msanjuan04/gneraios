import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftEditorData } from "@/components/invoices/types";
import type { DraftLinePayload } from "@/domain/invoicing/draft-line";

// «Añadir a factura» en el servidor (src/server/finance/rebill.ts), sin base de datos: qué borrador
// se usa, qué JSON recibe rebill_expenses y cuándo se vuelve a intentar. La RPC y sus garantías se
// prueban en tests/db/gastos-clientes.test.ts y tests/integration/rebill-concurrency.test.ts.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
const editor = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/server/invoices/detail", () => ({ loadDraftEditor: editor.load }));

const { rebillClientExpenses, loadPendingRebills } = await import("./rebill");
const { BillingRuleError } = await import("@/server/billing/context");

type Row = Record<string, unknown>;
type Filter = ["eq" | "in", string, unknown];

/** Un cliente de supabase-js mínimo: filtra filas en memoria y apunta las llamadas a la RPC. */
function fakeDb(tables: Record<string, Row[]>, rpcResults: { data?: string; error?: { hint: string; message: string } }[]) {
  type Rpc = (fn: string, args: { p: unknown }) => Promise<{ data: string | null; error: { hint: string; message: string; code: string; details: string } | null }>;
  const rpc = vi.fn<Rpc>(async () => {
    const next = rpcResults.shift() ?? { data: "inv-new" };
    return { data: next.data ?? null, error: next.error ? { ...next.error, code: "P0001", details: "" } : null };
  });
  const queries: { table: string; filters: Filter[] }[] = [];
  const from = (table: string) => {
    const filters: Filter[] = [];
    let limit: number | undefined;
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push(["eq", column, value]), builder),
      in: (column: string, values: unknown) => (filters.push(["in", column, values]), builder),
      order: () => builder,
      limit: (n: number) => ((limit = n), builder),
      range: () => builder,
      then: (resolve: (value: { data: Row[]; error: null }) => void) => {
        queries.push({ table, filters: [...filters] });
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every(([op, column, value]) => (op === "eq" ? row[column] === value : (value as unknown[]).includes(row[column]))),
        );
        resolve({ data: limit === undefined ? rows : rows.slice(0, limit), error: null });
      },
    };
    return builder;
  };
  return { db: { from, rpc } as never, rpc, queries };
}

const ORG = { id: "org", settings: {} };
const TODAY = "2026-09-27";

function pendingRow(id: string, over: Row = {}): Row {
  return {
    id,
    org_id: "org",
    client_id: "acme",
    client_name: "Acme",
    description: "Servidor CX22",
    vendor_name: "Hetzner",
    issued_on: "2026-09-01",
    period_start: "2026-09-01",
    base_cents: 1_000,
    rebill_markup_bps: 1000,
    source: "subscription",
    rebill_state: "pending",
    ...over,
  };
}

function editorData(over: Partial<DraftEditorData["defaults"]> = {}, clients = ["acme"]): DraftEditorData {
  return {
    context: { mode: "create", invoiceId: null, kind: "ordinary", updatedAt: null, lockParties: false, lockReason: null, rectifies: null, lineOrigins: {} },
    defaults: {
      issuer_id: "sl",
      client_id: "acme",
      series_id: "",
      issued_on: "",
      operation_on: "",
      due_mode: "terms",
      due_on: "",
      payment_terms_days: "",
      language: "ca",
      irpf_bps: "0",
      payment_method: "transfer",
      notes: "",
      rectification_reason: "",
      lines: [
        {
          id: "x",
          description: "",
          quantity: "1",
          unit_price: "",
          discount: "",
          tax_rate_id: "iva21",
          irpf_applies: true,
          billing_type: "one_off",
          period_start: "",
          period_end: "",
        },
      ],
      ...over,
    },
    issuers: [],
    series: [],
    vatRates: [{ id: "iva21", name: "IVA 21 %", rateBps: 2100, regime: "general", legalNote: null, isDefault: true, archived: false }],
    irpfRates: [],
    clients: clients.map((id) => ({ id, name: id, isBusiness: true, taxIdKind: "es", countryCode: "ES", language: "ca", paymentTermsDays: null, missing: [] })),
    orgPaymentTermsDays: 30,
  } as DraftEditorData;
}

const savedLine = (id: string, position: number): Row => ({
  id,
  position,
  description: "Mantenimiento web",
  quantity: 1,
  unit_price_cents: 20_000,
  discount_bps: 0,
  base_cents: 20_000,
  tax_rate_id: "iva21",
  vat_bps: 2100,
  vat_regime: "general",
  vat_cents: 4_200,
  irpf_applies: true,
  irpf_cents: 3_000,
  legal_note: null,
  billing_type: "monthly",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  contract_line_id: "cl-1",
  rectifies_line_id: null,
});

type Payload = {
  draft: { invoice_id?: string; expected_updated_at?: string; header?: Row; lines: DraftLinePayload[] };
  links: { expense_id: string; line_id: string }[];
};
const sent = (rpc: ReturnType<typeof fakeDb>["rpc"], call = 0) => rpc.mock.calls[call]![1].p as Payload;

beforeEach(() => {
  editor.load.mockReset();
  editor.load.mockResolvedValue(editorData());
});

describe("rebillClientExpenses", () => {
  it("sin borrador abierto: uno nuevo con los valores de una factura manual nueva y una línea por gasto", async () => {
    const { db, rpc } = fakeDb({ expenses_overview: [pendingRow("e1"), pendingRow("e2", { description: "Dominio", vendor_name: null, period_start: null, issued_on: "2026-08-20", base_cents: 1_500, rebill_markup_bps: 0, source: "manual" })], invoices: [] }, []);
    const result = await rebillClientExpenses(db, ORG, "acme", { today: TODAY });
    expect(result).toEqual({ invoiceId: "inv-new", count: 2, appended: false });
    expect(editor.load).toHaveBeenCalledWith(ORG, null, { today: TODAY, orgPaymentTermsDays: 30, clientId: "acme" });

    const p = sent(rpc);
    expect(rpc.mock.calls[0]![0]).toBe("rebill_expenses");
    expect(p.draft.invoice_id).toBeUndefined();
    expect(p.draft.header).toEqual({ issuer_id: "sl", client_id: "acme", language: "ca", irpf_bps: 0, payment_method: "transfer" });
    // En orden de fecha, en el idioma del cliente, con el margen en el precio.
    expect(p.draft.lines.map((l) => [l.position, l.description, l.unit_price_cents, l.tax_rate_id, l.billing_type])).toEqual([
      [0, "Repercussió: Dominio · agost del 2026", 1_500, "iva21", "one_off"],
      [1, "Repercussió: Hetzner · Servidor CX22 · setembre del 2026", 1_100, "iva21", "one_off"],
    ]);
    expect(p.links).toEqual([
      { expense_id: "e2", line_id: p.draft.lines[0]!.id },
      { expense_id: "e1", line_id: p.draft.lines[1]!.id },
    ]);
  });

  it("con un borrador abierto: se añade detrás de sus líneas, que se reenvían tal cual, con su IRPF y su idioma", async () => {
    const draft = {
      id: "inv-open",
      org_id: "org",
      client_id: "acme",
      lifecycle: "draft",
      kind: "ordinary",
      updated_at: "2026-09-27T08:00:00.123456+00:00",
      irpf_bps: 1500,
      language: "en",
      invoice_lines: [savedLine("l2", 3), savedLine("l1", 1)],
    };
    const { db, rpc } = fakeDb({ expenses_overview: [pendingRow("e1")], invoices: [draft] }, [{ data: "inv-open" }]);
    expect(await rebillClientExpenses(db, ORG, "acme", { today: TODAY })).toEqual({ invoiceId: "inv-open", count: 1, appended: true });

    const p = sent(rpc);
    expect(p.draft.header).toBeUndefined();
    expect(p.draft.invoice_id).toBe("inv-open");
    expect(p.draft.expected_updated_at).toBe("2026-09-27T08:00:00.123456+00:00");
    expect(p.draft.lines.map((l) => l.id).slice(0, 2)).toEqual(["l1", "l2"]);
    expect(p.draft.lines[0]).toMatchObject({ quantity: "1", unit_price_cents: 20_000, irpf_cents: 3_000, contract_line_id: "cl-1", billable_item_id: null });
    const added = p.draft.lines[2]!;
    expect(added).toMatchObject({ position: 4, description: "Rebilled cost: Hetzner · Servidor CX22 · September 2026", unit_price_cents: 1_100 });
    // El IRPF del borrador (15 %) sobre la base de la línea nueva.
    expect(added).toMatchObject({ irpf_applies: true, irpf_cents: 165, vat_cents: 231 });
    expect(p.links).toEqual([{ expense_id: "e1", line_id: added.id }]);
  });

  it("si el borrador ha cambiado o alguien se ha adelantado, vuelve a leer y lo intenta otra vez", async () => {
    const { db, rpc, queries } = fakeDb({ expenses_overview: [pendingRow("e1")], invoices: [] }, [
      { error: { hint: "draft_changed", message: "cambió" } },
      { error: { hint: "rebill_taken", message: "tomado" } },
      { data: "inv-new" },
    ]);
    expect((await rebillClientExpenses(db, ORG, "acme", { today: TODAY })).invoiceId).toBe("inv-new");
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(queries.filter((q) => q.table === "expenses_overview")).toHaveLength(3);
    // Y a la tercera, si sigue fallando, se rinde con el error de la base de datos.
    const stuck = fakeDb({ expenses_overview: [pendingRow("e1")], invoices: [] }, [
      { error: { hint: "draft_changed", message: "x" } },
      { error: { hint: "draft_changed", message: "x" } },
      { error: { hint: "draft_changed", message: "x" } },
    ]);
    await expect(rebillClientExpenses(stuck.db, ORG, "acme", { today: TODAY })).rejects.toMatchObject({ error: { hint: "draft_changed" } });
  });

  it("otros errores de la base de datos no se reintentan", async () => {
    const { db, rpc } = fakeDb({ expenses_overview: [pendingRow("e1")], invoices: [] }, [{ error: { hint: "invoice_immutable", message: "x" } }]);
    await expect(rebillClientExpenses(db, ORG, "acme", { today: TODAY })).rejects.toMatchObject({ error: { hint: "invoice_immutable" } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("sin nada pendiente, o con el cliente archivado, no llama a la base de datos", async () => {
    const empty = fakeDb({ expenses_overview: [pendingRow("e1", { client_id: "otro" })], invoices: [] }, []);
    await expect(rebillClientExpenses(empty.db, ORG, "acme", { today: TODAY })).rejects.toEqual(new BillingRuleError("finance.rebill.errors.nothingPending"));
    expect(empty.rpc).not.toHaveBeenCalled();

    editor.load.mockResolvedValue(editorData({}, []));
    const archived = fakeDb({ expenses_overview: [pendingRow("e1")], invoices: [] }, []);
    await expect(rebillClientExpenses(archived.db, ORG, "acme", { today: TODAY })).rejects.toEqual(new BillingRuleError("finance.rebill.errors.clientUnavailable"));
    expect(archived.rpc).not.toHaveBeenCalled();
  });

  it("con gastos elegidos, solo esos (y solo si siguen pendientes)", async () => {
    const { db, rpc, queries } = fakeDb({ expenses_overview: [pendingRow("e1"), pendingRow("e2"), pendingRow("e3", { rebill_state: "drafted" })], invoices: [] }, []);
    expect((await rebillClientExpenses(db, ORG, "acme", { today: TODAY, expenseIds: ["e2", "e3"] })).count).toBe(1);
    expect(queries[0]!.filters).toContainEqual(["in", "id", ["e2", "e3"]]);
    expect(sent(rpc).links.map((l) => l.expense_id)).toEqual(["e2"]);
  });
});

describe("loadPendingRebills", () => {
  it("solo lo pendiente de la org, y de un cliente si se pide", async () => {
    const { db, queries } = fakeDb({ expenses_overview: [pendingRow("e1"), pendingRow("e2", { client_id: "bravo", client_name: "Bravo" })] }, []);
    const all = await loadPendingRebills(db, "org");
    expect(all.map((e) => [e.id, e.clientName, e.fromSubscription])).toEqual([
      ["e1", "Acme", true],
      ["e2", "Bravo", true],
    ]);
    expect(queries[0]!.filters).toEqual([
      ["eq", "org_id", "org"],
      ["eq", "rebill_state", "pending"],
    ]);
    expect((await loadPendingRebills(db, "org", { clientId: "bravo" })).map((e) => e.id)).toEqual(["e2"]);
  });
});
