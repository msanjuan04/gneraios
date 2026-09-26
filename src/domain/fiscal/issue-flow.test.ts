import { describe, expect, it } from "vitest";
import { FakeCertifiedProvider } from "./fake-certified";
import { internalDraftProvider } from "./internal";
import { runIssueFlow, type IssueFlowDeps } from "./issue-flow";
import type { FiscalDocument, FiscalProvider, FiscalProviderId } from "./provider";
import { aeatQrUrl, verifactuCountdown } from "./verifactu";

type Row = {
  lifecycle: "draft" | "issuing" | "issued";
  number: string | null;
  pdfPath: string | null;
  providerRef: string | null;
  payload: Record<string, unknown> | null;
};

/** Una "base de datos" mínima que imita a issue_invoice_begin / issue_invoice_complete. */
function fakeDb(providerId: FiscalProviderId, provider: FiscalProvider, opts: { failStoreTimes?: number } = {}) {
  const row: Row = { lifecycle: "draft", number: null, pdfPath: null, providerRef: null, payload: null };
  let counter = 37;
  let failStore = opts.failStoreTimes ?? 0;
  const stored: string[] = [];
  const doc = (): FiscalDocument => ({
    invoiceId: "inv-1",
    kind: "ordinary",
    number: row.number,
    seriesRef: null,
    issuedOn: "2026-09-26",
    issuer: { taxId: "B00000000", legalName: "GNERAI SL" },
    client: { taxId: "B12345674", legalName: "Port Mataró SL", countryCode: "ES" },
    lines: [],
    totals: { subtotalCents: 90_000, vatCents: 18_900, irpfCents: 13_500, totalCents: 95_400 },
    rectifies: null,
  });
  const deps: IssueFlowDeps = {
    async begin() {
      if (row.lifecycle === "draft") {
        row.lifecycle = "issuing";
        if (providerId === "internal") row.number = `2026-${String(++counter).padStart(4, "0")}`;
      }
      return { lifecycle: row.lifecycle, number: row.number, issuedOn: "2026-09-26", fiscalProvider: providerId };
    },
    async loadDocument() {
      return doc();
    },
    provider: () => provider,
    async renderPdf(_id, issued) {
      return new TextEncoder().encode(`%PDF ${issued.number} ${issued.legal?.qrUrl ?? ""}`);
    },
    async storePdf(id, pdf) {
      if (failStore > 0) {
        failStore -= 1;
        throw new Error("storage caído");
      }
      stored.push(new TextDecoder().decode(pdf));
      return `org/${id}.pdf`;
    },
    async complete(_id, result) {
      if (row.lifecycle !== "issuing") throw new Error("no está en emisión");
      row.number = row.number ?? result.number ?? null;
      row.pdfPath = result.pdfPath;
      row.providerRef = result.providerRef ?? null;
      row.payload = result.providerPayload ?? null;
      row.lifecycle = "issued";
    },
  };
  return { row, deps, stored };
}

describe("emisión con el proveedor interno", () => {
  it("usa el número del contador, guarda el PDF y queda emitida; repetir no hace nada", async () => {
    const { row, deps, stored } = fakeDb("internal", internalDraftProvider);
    expect(await runIssueFlow(deps, "inv-1")).toEqual({ number: "2026-0038", alreadyIssued: false });
    expect(row).toMatchObject({ lifecycle: "issued", number: "2026-0038", pdfPath: "org/inv-1.pdf" });
    expect(await runIssueFlow(deps, "inv-1")).toEqual({ number: "2026-0038", alreadyIssued: true });
    expect(stored).toHaveLength(1);
  });

  it("si falla el guardado del PDF, se queda en emisión con su número y el reintento lo completa", async () => {
    const { row, deps } = fakeDb("internal", internalDraftProvider, { failStoreTimes: 1 });
    await expect(runIssueFlow(deps, "inv-1")).rejects.toThrow("storage caído");
    expect(row).toMatchObject({ lifecycle: "issuing", number: "2026-0038" });
    expect(await runIssueFlow(deps, "inv-1")).toEqual({ number: "2026-0038", alreadyIssued: false });
    expect(row.lifecycle).toBe("issued");
  });
});

describe("camino externo con un proveedor certificado simulado", () => {
  it("un fallo a mitad no pierde ni duplica: el reintento registra una sola vez", async () => {
    const provider = new FakeCertifiedProvider();
    provider.failNextCalls = 1;
    const { row, deps } = fakeDb("fake_certified", provider, { failStoreTimes: 1 });

    // 1.º intento: el proveedor no responde. Sin número todavía.
    await expect(runIssueFlow(deps, "inv-1")).rejects.toThrow(/no disponible/);
    expect(row).toMatchObject({ lifecycle: "issuing", number: null });
    // 2.º: el proveedor registra, pero falla el guardado del PDF.
    await expect(runIssueFlow(deps, "inv-1")).rejects.toThrow("storage caído");
    // 3.º: completa con el MISMO número; el proveedor solo lo registró una vez.
    const done = await runIssueFlow(deps, "inv-1");
    expect(done.number).toBe("F2026-00001");
    expect(provider.registeredCount).toBe(1);
    expect(row).toMatchObject({ lifecycle: "issued", number: "F2026-00001", providerRef: "fake_inv-1" });
    expect(row.payload).toMatchObject({ aeatStatus: "Correcto" });
    expect(String(row.payload?.qrUrl)).toContain("numserie=F2026-00001");
  });

  it("si los totales del proveedor no cuadran con los nuestros, no se da por emitida", async () => {
    const provider = new FakeCertifiedProvider();
    provider.vatSkewCents = 1;
    const { row, deps } = fakeDb("fake_certified", provider);
    await expect(runIssueFlow(deps, "inv-1")).rejects.toMatchObject({ code: "totals_mismatch" });
    expect(row.lifecycle).toBe("issuing");
  });
});

describe("Verifactu", () => {
  it("cuenta atrás desde 90 días y obligado desde la fecha", () => {
    expect(verifactuCountdown("2027-01-01", "2026-09-26")).toEqual({ state: "far", daysLeft: 97 });
    expect(verifactuCountdown("2027-01-01", "2026-10-03")).toEqual({ state: "soon", daysLeft: 90 });
    expect(verifactuCountdown("2027-01-01", "2027-01-01")).toEqual({ state: "required", daysLeft: 0 });
  });

  it("la URL de cotejo lleva nif, número, fecha DD-MM-AAAA e importe con punto", () => {
    const url = new URL(aeatQrUrl({ nif: "B00000000", number: "2027-0001", issuedOn: "2027-01-04", totalCents: 95_400 }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      nif: "B00000000",
      numserie: "2027-0001",
      fecha: "04-01-2027",
      importe: "954.00",
    });
  });
});
