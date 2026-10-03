import { describe, expect, it } from "vitest";
import { renderProposalPdf } from "./proposal-render";
import { sampleQuote } from "./quote-samples";

describe("render de la propuesta", () => {
  it("genera un PDF real con portada y varias páginas", async () => {
    const pdf = await renderProposalPdf(sampleQuote);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Portada + resumen + una página por tipo de cobro, como mínimo.
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
  }, 30_000);
});
