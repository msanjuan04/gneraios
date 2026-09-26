/**
 * Genera tres facturas de ejemplo con datos ficticios para revisar la plantilla PDF:
 *
 *   pnpm exec tsx scripts/render-sample-invoice.tsx <directorio>
 *
 * - `factura-es-irpf.pdf`: ordinaria de autónomo con IRPF y una cuota mensual prorrateada.
 * - `invoice-en-reverse-charge.pdf`: cliente de la UE con inversión del sujeto pasivo.
 * - `factura-ca-rectificativa.pdf`: rectificativa con importes negativos y QR de Verifactu.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import type { InvoiceDocumentData } from "../src/pdf";

// tsx ejecuta este fichero como CommonJS (el package.json no declara "type": "module") y
// convierte a require() los import de react-pdf, que solo se publica como ESM. Uno de sus
// paquetes, @react-pdf/hyphenate, solo exporta sus subrutas con la condición "import", y
// require() no las encuentra. Si una subruta no está exportada para require, se vuelve a
// resolver con "import". En Next y en Vitest no hace falta: cargan react-pdf como ESM.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if ((error as { code?: string }).code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
      return nextResolve(specifier, { ...context, conditions: [...context.conditions, "import"] });
    }
  },
});

async function main() {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error("Uso: pnpm exec tsx scripts/render-sample-invoice.tsx <directorio>");
    process.exit(1);
  }
  // Import dinámico: el hook de arriba tiene que estar registrado antes de cargar react-pdf.
  const { renderInvoicePdf } = await import("../src/pdf");
  const samples = await import("../src/pdf/samples");
  const files: ReadonlyArray<readonly [string, InvoiceDocumentData]> = [
    ["factura-es-irpf.pdf", samples.sampleSpanishInvoice],
    ["invoice-en-reverse-charge.pdf", samples.sampleReverseChargeInvoice],
    ["factura-ca-rectificativa.pdf", samples.sampleRectifyingInvoice],
  ];

  await mkdir(outDir, { recursive: true });
  for (const [name, data] of files) {
    const file = path.resolve(outDir, name);
    await writeFile(file, await renderInvoicePdf(data));
    console.log(file);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
