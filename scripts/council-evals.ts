// Evals del Consejo de agentes (CONSEJO.md §9).
//
//   pnpm council:evals                 respuestas grabadas, sin red (lo mismo que corre en CI)
//   pnpm council:evals --live          contra Claude (necesita ANTHROPIC_API_KEY; cuesta dinero)
//   pnpm council:evals --only cfo      solo los escenarios cuyo id contiene "cfo"
//   pnpm council:evals --verbose       todas las comprobaciones, no solo las que fallan
//   pnpm council:evals --json          el resultado en JSON (para guardarlo o compararlo)
//
// Puntúa cuatro preguntas en cada escenario: ¿usó tools en vez de inventar cifras?, ¿respetó la
// política?, ¿marcó revisión profesional cuando tocaba?, ¿se calló cuando no había nada? Y lo
// propio de cada escenario. Sale con código 1 si algo falla.

import { loadScenarios, runEval, summarize, type EvalMode } from "../src/council/evals/run";
import type { EvalResult } from "../src/council/evals/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const LABELS = {
  tools: "Usa tools en vez de inventar cifras",
  policy: "Respeta la política",
  professional: "Marca la revisión profesional",
  silence: "Se calla cuando no hay nada",
  scenario: "Lo propio de cada escenario",
} as const;

const usd = (micros: number) => `${(micros / 1_000_000).toFixed(micros > 0 && micros < 10_000 ? 4 : 2)} US$`;

async function main() {
  const live = flag("live");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (live && !apiKey) {
    console.error("Falta ANTHROPIC_API_KEY: los evals en vivo llaman a la API de Claude (y cuestan dinero). Sin --live usan las respuestas grabadas.");
    process.exit(2);
  }
  const mode: EvalMode = live && apiKey ? { kind: "live", apiKey } : { kind: "replay" };
  const only = value("only");
  const scenarios = loadScenarios().filter((s) => !only || s.id.includes(only));
  if (scenarios.length === 0) {
    console.error(`Ningún escenario contiene «${only}».`);
    process.exit(2);
  }

  const results: EvalResult[] = [];
  for (const scenario of scenarios) {
    // Uno detrás de otro: en vivo, así el coste y los límites de uso son previsibles.
    const result = await runEval(scenario, mode);
    results.push(result);
    if (flag("json")) continue;
    const failed = result.checks.filter((c) => !c.passed);
    const head = `${result.passed ? "✓" : "✗"} ${result.id.padEnd(36)} ${result.agent.padEnd(15)} ${String(result.checks.length - failed.length).padStart(2)}/${String(result.checks.length).padEnd(2)}`;
    const tail = mode.kind === "live" ? ` · ${result.attempts} intento(s) · ${usd(result.costUsdMicros)} · ${(result.durationMs / 1000).toFixed(1)} s` : "";
    console.log(head + tail);
    for (const check of flag("verbose") ? result.checks : failed) {
      console.log(`    ${check.passed ? "·" : "✗"} [${check.dimension}] ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    }
    if (result.error && !result.passed) console.log(`    error: ${result.error}`);
  }

  const summary = summarize(results);
  if (flag("json")) {
    console.log(JSON.stringify({ mode: mode.kind, summary, results }, null, 2));
  } else {
    const passed = results.filter((r) => r.passed).length;
    console.log(`\n${mode.kind === "live" ? "En vivo (Claude)" : "Respuestas grabadas"} · ${passed}/${results.length} escenarios`);
    for (const [dimension, { passed: ok, total }] of Object.entries(summary)) {
      const pct = total === 0 ? "—" : `${Math.round((ok / total) * 100)} %`;
      console.log(`  ${LABELS[dimension as keyof typeof LABELS].padEnd(36)} ${String(ok).padStart(3)}/${String(total).padEnd(3)} ${pct}`);
    }
    if (mode.kind === "live") console.log(`  Coste estimado: ${usd(results.reduce((sum, r) => sum + r.costUsdMicros, 0))}`);
  }
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
