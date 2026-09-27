import { describe, expect, it } from "vitest";
import { backupStamp, backupsToPrune, parseBackupStamp } from "./retention";

describe("copias de seguridad", () => {
  it("se nombran por su fecha en UTC y se leen de vuelta", () => {
    const at = new Date("2026-09-26T03:45:07Z");
    expect(backupStamp(at)).toBe("2026-09-26T034507Z");
    expect(parseBackupStamp("2026-09-26T034507Z")?.toISOString()).toBe("2026-09-26T03:45:07.000Z");
    expect(parseBackupStamp("notas.txt")).toBeNull();
  });

  it("se borran las de hace más de N días, pero siempre quedan las más recientes", () => {
    const now = new Date("2026-10-20T04:00:00Z");
    const names = ["2026-10-19T034500Z", "2026-10-18T034500Z", "2026-10-17T034500Z", "2026-10-10T034500Z", "2026-10-01T034500Z", "2026-09-20T034500Z", "leeme.txt"];
    expect(backupsToPrune(names, now, 14)).toEqual(["2026-10-01T034500Z", "2026-09-20T034500Z"]);
    // Si el cron lleva semanas parado, no se queda sin copias.
    expect(backupsToPrune(["2026-08-01T034500Z", "2026-07-01T034500Z"], now, 14)).toEqual([]);
    expect(backupsToPrune(["2026-08-03T034500Z", "2026-08-02T034500Z", "2026-08-01T034500Z", "2026-07-01T034500Z"], now, 14)).toEqual([
      "2026-07-01T034500Z",
    ]);
  });
});
