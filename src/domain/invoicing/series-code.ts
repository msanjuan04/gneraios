// El código corto de una serie (la columna `invoice_series.code`: A-Z, 0-9 y guiones, hasta 12)
// a partir de su formato: lo que no es año ni número. «{yyyy}-BRK-{n:3}» → «BRK»,
// «MS-{yyyy}/{n:3}» → «MS», «F{yy}/{n}» → «F». Sin letras propias («{yyyy}-{n:4}»), «H»
// (histórico). Si el código ya lo usa otra serie del emisor, se le añade «-2», «-3»…

const TOKENS = /\{yyyy\}|\{yy\}|\{n(?::[1-9])?\}/g;
const MAX = 12;

export function seriesCodeFromFormat(format: string, taken: readonly string[] = []): string {
  const literal = format
    .replace(TOKENS, " ")
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("-");
  const base = (literal || "H").slice(0, MAX).replace(/-+$/, "");
  const used = new Set(taken.map((c) => c.toUpperCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Demasiadas series con el mismo código");
}
