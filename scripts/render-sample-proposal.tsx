/**
 * Genera un PDF de muestra de la propuesta comercial (portada oscura):
 *
 *   node_modules/.bin/tsx scripts/render-sample-proposal.tsx <directorio>
 */
import { mkdir, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";

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
    console.error("Uso: node_modules/.bin/tsx scripts/render-sample-proposal.tsx <directorio>");
    process.exit(1);
  }
  const { renderProposalPdf } = await import("../src/pdf/proposal-render");
  const { sampleQuote } = await import("../src/pdf/quote-samples");
  await mkdir(outDir, { recursive: true });
  const file = path.resolve(outDir, "propuesta-muestra.pdf");
  await writeFile(file, await renderProposalPdf(sampleQuote));
  console.log(file);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
