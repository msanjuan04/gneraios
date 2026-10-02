// Local-only evidence for the audit of 2026-09-29. No network or production database.
// Run: pnpm exec tsx docs/audit/reproduce.mts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { as, createDb, createOrg, createUser } from "../../tests/db/harness";
import { estimateCashToday } from "../../src/domain/finance/cash";
import { normalizeSiteUrl } from "../../src/domain/sites/url";
import { probeHttp } from "../../src/server/sites/check";

const db = await createDb();
try {
  const owner = await createUser(db, "audit-a@example.test");
  const other = await createUser(db, "audit-b@example.test");
  const orgA = await createOrg(db, owner);
  const orgB = await createOrg(db, other, { ...((await import("../../tests/db/harness")).onboardingPayload()), org: { name: "Other", slug: "other" } });
  const one = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
  await db.query("update public.issuers set address_line = 'Audit', postal_code = '08001', city = 'Barcelona' where org_id = $1", [orgA]);
  const issuer = await one<{ id: string }>("select id from public.issuers where org_id = $1 and kind = 'self_employed'", [orgA]);
  const rate = await one<{ id: string }>("select id from public.tax_rates where org_id = $1 and kind = 'vat' and rate_bps = 2100", [orgA]);
  const client = await as(db, owner, () => one<{ id: string }>("insert into public.clients (org_id, display_name, tax_id, address_line, postal_code, city) values ($1, 'Audit', 'B12345674', 'Audit', '08001', 'Barcelona') returning id", [orgA]));
  const draft = await as(db, owner, () => one<{ id: string }>("select public.save_invoice_draft($1::jsonb) as id", [JSON.stringify({
    header: { issuer_id: issuer.id, client_id: client.id, irpf_bps: 0 },
    lines: [{ id: randomUUID(), description: "Audit", quantity: "1", unit_price_cents: 10000, base_cents: 1, tax_rate_id: rate.id, vat_bps: 2100, vat_cents: 0, irpf_cents: 0, billing_type: "one_off" }],
  })]));
  await as(db, owner, async () => {
    await db.query("select public.issue_invoice_begin($1)", [draft.id]);
    await db.query("select public.issue_invoice_complete($1, $2::jsonb)", [draft.id, JSON.stringify({ pdf_path: `${orgB}/${randomUUID()}.pdf` })]);
    const invoice = await one<{ lifecycle: string; pdf_path: string; total_cents: number }>("select lifecycle, pdf_path, total_cents from public.invoices where id = $1", [draft.id]);
    assert.equal(invoice.lifecycle, "issued");
    assert.equal(Number(invoice.total_cents), 1);
    assert.ok(invoice.pdf_path.startsWith(`${orgB}/`));
    console.log("CONFIRMED: authenticated owner can issue inconsistent amounts and store another organization's PDF path.");
  });
  // An owner of A can reach a global Auth identity that is also owner of B.
  await db.query("insert into public.members (org_id, user_id, role, full_name, initials) values ($1, $2, 'viewer', 'Shared', 'SH')", [orgA, other]);
  const session = await one<{ id: string }>("insert into auth.sessions(user_id) values ($1) returning id", [other]);
  const shared = await as(db, owner, () => one<{ id: string }>("select id from public.members where org_id = $1 and user_id = $2", [orgA, other]));
  await as(db, owner, () => db.query("select public.revoke_member_sessions($1, $2)", [orgA, shared.id]));
  const remaining = await one<{ count: number }>("select count(*) as count from auth.sessions where id = $1", [session.id]);
  assert.equal(Number(remaining.count), 0);
  console.log("CONFIRMED: owner of A can revoke global sessions of a user who owns B.");
  const quote = await as(db, owner, () => one<{ id: string }>("select public.save_quote($1::jsonb) as id", [JSON.stringify({
    header: { client_id: client.id, issuer_id: issuer.id, title: "Audit quote", language: "es", valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), payment_plan: [{ label: "Audit", percent_bps: 10000, when: "on_accept" }] },
    lines: [{ id: randomUUID(), position: 0, description: "Audit", billing_type: "one_off", quantity: "1", unit_price_cents: 10000, discount_bps: 0, tax_rate_id: rate.id, irpf_applies: false, base_cents: 10000 }],
  })]));
  await as(db, owner, () => db.query("select public.finalize_quote($1)", [quote.id]));
  const hash = "a".repeat(64);
  await as(db, owner, () => db.query("select public.create_public_link('quote', $1, $2)", [quote.id, hash]));
  const version = await one<{ version: string }>("select updated_at::text as version from public.quotes where id=$1", [quote.id]);
  await db.query("update public.orgs set require_mfa = true where id = $1", [orgA]);
  await db.exec("set role service_role");
  try {
    await assert.rejects(db.query("select public.portal_accept_quote($1, $2, $3::timestamptz, $4::jsonb)", [hash, quote.id, version.version, JSON.stringify({ signer_name: "Audit", signer_email: "audit@example.test", consent_text: "Audit consent", pdf_sha256: "b".repeat(64), locale: "es" })]), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "42501");
    console.log("CONFIRMED: a valid public quote cannot be accepted through service_role after require_mfa is enabled.");
  } finally {
    await db.exec("reset role");
  }
  const issues = await db.query<{ name: string }>("select c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity");
  console.log("Public tables without RLS:", issues.rows);
} finally {
  await db.close();
}

const cash = estimateCashToday([
  { accountId: "a", issuerId: "issuer", isActive: true, balanceOn: "2026-09-01", balanceCents: 100000 },
  { accountId: "b", issuerId: "issuer", isActive: true, balanceOn: "2026-09-20", balanceCents: 100000 },
], [{ accountId: "a", issuerId: "issuer", on: "2026-09-10", cents: 50000 }], "2026-09-29");
assert.equal(cash.estimatedCents, 250000);
console.log("CONFIRMED: each account's movements are included after its own balance date (2500 EUR). ");
assert.ok(normalizeSiteUrl("https://audit.example.test:8443"));
console.log("CONFIRMED: URL validation accepts arbitrary domains and nonstandard ports without DNS checks.");
const internal = createServer((_req, res) => res.writeHead(200).end("local audit only"));
await new Promise<void>((resolve) => internal.listen(0, "127.0.0.1", resolve));
const address = internal.address();
assert.ok(address && typeof address === "object");
const redirector = createServer((_req, res) => res.writeHead(302, { location: `http://127.0.0.1:${address.port}/internal` }).end());
await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
try {
  const redirectAddress = redirector.address();
  assert.ok(redirectAddress && typeof redirectAddress === "object");
  const result = await probeHttp(`http://127.0.0.1:${redirectAddress.port}/redirect`);
  assert.equal(result.statusCode, 200);
  console.log("CONFIRMED: HTTP probe follows redirects into loopback without revalidating the destination.");
} finally {
  internal.closeAllConnections();
  redirector.closeAllConnections();
  await Promise.all([new Promise<void>((r) => internal.close(() => r())), new Promise<void>((r) => redirector.close(() => r()))]);
}
