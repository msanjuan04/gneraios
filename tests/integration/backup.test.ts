import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// La copia nocturna contra el Supabase local (se salta si no está en marcha): escribe una carpeta
// con un NDJSON comprimido por tabla y un manifest, y borra las copias viejas.

vi.mock("server-only", () => ({}));

function localEnv(): Record<string, string> {
  if (!existsSync(".env.local")) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }
  return out;
}

const env = localEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
let reachable = false;
let dir = "";

beforeAll(async () => {
  if (!/127\.0\.0\.1|localhost/.test(url) || !env.SUPABASE_SECRET_KEY) return;
  reachable = await fetch(`${url}/auth/v1/health`).then((r) => r.ok, () => false);
  if (!reachable) return;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY);
  dir = await mkdtemp(path.join(tmpdir(), "gos-backup-"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("copia nocturna", () => {
  it("copia todas las tablas y se queda con las recientes", async (ctx) => {
    if (!reachable) ctx.skip();
    const { runBackup } = await import("@/server/backup/run");
    // Una copia vieja que debe desaparecer (ya hay 3 más recientes)… y algo que no es una copia.
    for (const old of ["2020-01-01T000000Z", "2026-01-01T000000Z", "2026-01-02T000000Z", "2026-01-03T000000Z"]) {
      await import("node:fs/promises").then((fs) => fs.mkdir(path.join(dir, old)));
    }
    const summary = await runBackup({ dir, keepDays: 14, now: new Date("2026-09-26T03:45:00Z") });
    expect(summary.errors).toEqual({});
    expect(summary.tables).toBeGreaterThan(20);
    expect(summary.pruned).toContain("2020-01-01T000000Z");

    const manifest = JSON.parse(await readFile(path.join(summary.dir, "manifest.json"), "utf8"));
    expect(manifest.tables.orgs).toBeGreaterThan(0);
    const orgs = gunzipSync(await readFile(path.join(summary.dir, "orgs.ndjson.gz"))).toString("utf8").trim().split("\n");
    expect(orgs).toHaveLength(manifest.tables.orgs);
    expect(JSON.parse(orgs[0]!)).toHaveProperty("slug");
    expect(await readdir(dir)).not.toContain("2020-01-01T000000Z");
  }, 120_000);
});
