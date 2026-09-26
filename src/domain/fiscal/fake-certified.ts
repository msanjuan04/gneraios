import { FiscalError, type FiscalDocument, type FiscalProvider, type IssueResult } from "./provider";
import { aeatQrUrl } from "./verifactu";

/**
 * Proveedor certificado simulado, SOLO para tests. Numera él (por serie y año), devuelve un
 * QR de cotejo y puede fallar a propósito para probar el camino externo: estado «emitiendo»,
 * reintento idempotente y reconciliación. Conectar uno real consiste en escribir su adaptador
 * con este mismo contrato.
 */
export class FakeCertifiedProvider implements FiscalProvider {
  readonly id = "fake_certified" as const;
  readonly capabilities = { assignsNumber: true, verifactu: true, providesPdf: false };

  /** Llamadas a `issue` que fallarán antes de registrar nada (red caída, timeout…). */
  failNextCalls = 0;
  /** Desvío de céntimos en el IVA que devuelve (para probar que se detecta el descuadre). */
  vatSkewCents = 0;

  private readonly registered = new Map<string, IssueResult>();
  private readonly counters = new Map<string, number>();
  calls = 0;

  get registeredCount(): number {
    return this.registered.size;
  }

  async issue(doc: FiscalDocument, opts: { idempotencyKey: string }): Promise<IssueResult> {
    this.calls += 1;
    if (this.failNextCalls > 0) {
      this.failNextCalls -= 1;
      throw new FiscalError("provider_unavailable", "Proveedor no disponible (simulado).");
    }
    const existing = this.registered.get(opts.idempotencyKey);
    if (existing) return existing;

    const year = doc.issuedOn.slice(0, 4);
    const series = doc.seriesRef ?? (doc.kind === "rectifying" ? "R" : "F");
    const key = `${series}-${year}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    const number = `${series}${year}-${String(next).padStart(5, "0")}`;

    const result: IssueResult = {
      number,
      issuedOn: doc.issuedOn,
      providerRef: { provider: this.id, id: `fake_${opts.idempotencyKey}` },
      totals: { ...doc.totals, vatCents: doc.totals.vatCents + this.vatSkewCents },
      legal: {
        qrUrl: aeatQrUrl({ nif: doc.issuer.taxId, number, issuedOn: doc.issuedOn, totalCents: doc.totals.totalCents }),
        aeatStatus: "Correcto",
      },
    };
    this.registered.set(opts.idempotencyKey, result);
    return result;
  }

  async getStatus() {
    return { state: "accepted" as const };
  }
}
