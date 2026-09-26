export type Messages = { [key: string]: string | Messages };

/** Fusiona catálogos por claves: cada área de la app vive en su propio fichero. */
export function deepMerge(...parts: Messages[]): Messages {
  const out: Messages = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      const current = out[key];
      out[key] = typeof value === "object" && typeof current === "object" ? deepMerge(current, value) : value;
    }
  }
  return out;
}
