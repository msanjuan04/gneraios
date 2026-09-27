// Copias de seguridad nocturnas: el nombre de cada copia (su fecha) y cuáles se borran ya.

/** "2026-09-26T034500Z": ordena bien como texto y se lee de un vistazo. */
export function backupStamp(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace(/[-:]/g, "").replace(/^(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}Z`;
}

/** La fecha de una copia a partir de su nombre, o null si no es una copia. */
export function parseBackupStamp(name: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(name);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Las copias que ya se pueden borrar: más antiguas que `keepDays`, pero nunca las `minKeep` más
 * recientes (si el cron se para unos días, no se queda sin ninguna). Lo que no es una copia no se toca.
 */
export function backupsToPrune(names: string[], now: Date, keepDays: number, minKeep = 3): string[] {
  const backups = names
    .map((name) => ({ name, at: parseBackupStamp(name) }))
    .filter((b): b is { name: string; at: Date } => b.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const limit = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  return backups.slice(minKeep).filter((b) => b.at.getTime() < limit).map((b) => b.name);
}
