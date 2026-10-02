// Local mocks only; never connects to Supabase or Storage.
// Run: pnpm exec tsx docs/audit/import-race.mts
import assert from "node:assert/strict";
import type { Db } from "../../src/server/billing/context";
import { attachOriginal } from "../../src/server/invoice-import/storage";

let releaseReads!: () => void;
const readsReady = new Promise<void>((resolve) => { releaseReads = resolve; });
let reads = 0;
let stored: Uint8Array | null = null;
let linkedHash: string | null = null;
let releaseInsert!: () => void;
const inserted = new Promise<void>((resolve) => { releaseInsert = resolve; });
const db = {
  from() {
    const query = {
      select() { return query; },
      eq() { return query; },
      async maybeSingle() {
        reads += 1;
        if (reads === 2) releaseReads();
        await readsReady;
        return { data: null, error: null };
      },
      async insert(row: { sha256: string }) {
        if (linkedHash) return { error: { code: "23505" } };
        linkedHash = row.sha256;
        releaseInsert();
        return { error: null };
      },
    };
    return query;
  },
} as unknown as Db;
const admin = {
  storage: {
    from() {
      return {
        async upload(_path: string, bytes: Uint8Array) {
          // Let A commit the link before B overwrites the shared object.
          if (bytes[0] === 2) await inserted;
          stored = bytes;
          return { error: null };
        },
      };
    },
  },
} as unknown as Db;
const results = await Promise.all([1, 2].map((n) => attachOriginal(db, admin, {
  orgId: "audit-org", invoiceId: "audit-invoice",
  file: { bytes: Uint8Array.of(n), name: `${n}.pdf`, sha256: String(n).repeat(64) },
})));
assert.deepEqual(results, [{ ok: true, attached: true }, { ok: true, attached: false }]);
assert.equal(linkedHash, "1".repeat(64));
assert.deepEqual(stored, Uint8Array.of(2));
console.log("CONFIRMED: attachment metadata identifies A, but the shared Storage object contains B; both calls report success.");
