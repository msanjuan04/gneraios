import "server-only";
import { parseCivilDate } from "@/domain/dates/civil-date";
import { nowInZone } from "@/lib/clock";
import type { Json } from "@/lib/supabase/database.types";
import type { Db } from "@/server/billing/context";
import { getEmailProvider } from "@/server/email/provider";
import { recordOutcomes, type SendOutcome, sendPush } from "@/server/push/dispatch";
import { type DigestOrg, loadDigestOrgData, loadDigestWeek } from "./data";
import { mondayOf } from "./monday";
import { type DigestLocale, type RenderedDigest, renderWeeklyDigest } from "./render";

// Reparto del resumen semanal (POST /api/cron/weekly, los lunes). Una vez por org y semana:
// job_runs ('weekly_digest', run_on = el lunes) lo registra y un segundo intento no repite nada.

export const DIGEST_JOB = "weekly_digest";
const MAX_PUSH_FAILURES = 5;

export type DigestRunResult = { orgId: string; skipped?: "not_monday" | "already_sent" | "busy"; emails?: number; pushes?: number; error?: string };

const asLocale = (value: string | null | undefined): DigestLocale => (value === "ca" || value === "en" ? value : "es");

function isMonday(date: string): boolean {
  const { year, month, day } = parseCivilDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 1;
}

type DigestMember = { id: string; user_id: string; full_name: string; locale: string | null };

/** Lo que recibe un socio: el texto ya en su idioma. */
async function renderFor(db: Db, org: DigestOrg, member: DigestMember, data: Awaited<ReturnType<typeof loadDigestOrgData>>): Promise<RenderedDigest> {
  const week = await loadDigestWeek(db, org, member.id);
  return renderWeeklyDigest({
    locale: asLocale(member.locale),
    orgName: org.name,
    firstName: member.full_name.split(" ")[0] || member.full_name,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100",
    slug: org.slug,
    data,
    week,
  });
}

/** Envía un resumen ya montado: email (si hay proveedor y dirección) y push a sus dispositivos. */
export async function deliverDigest(
  admin: Db,
  org: Pick<DigestOrg, "slug">,
  member: Pick<DigestMember, "id" | "user_id">,
  rendered: RenderedDigest,
): Promise<{ email: boolean; pushes: number }> {
  let email = false;
  const provider = getEmailProvider();
  const { data: user } = await admin.auth.admin.getUserById(member.user_id);
  const address = user.user?.email;
  if (provider && address) {
    await provider.send({
      from: process.env.EMAIL_FROM || "GNERAI <facturacion@gnerai.com>",
      to: [address],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    email = true;
  }

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_secret, failure_count")
    .eq("member_id", member.id)
    .lt("failure_count", MAX_PUSH_FAILURES);
  const outcomes = new Map<string, SendOutcome>();
  for (const sub of subs ?? []) {
    outcomes.set(sub.id, await sendPush(sub, { title: rendered.pushTitle, body: rendered.pushBody, url: `/${org.slug}`, tag: `digest-${org.slug}` }));
  }
  await recordOutcomes(admin, outcomes, new Map((subs ?? []).map((s) => [s.id, s.failure_count])));
  return { email, pushes: [...outcomes.values()].filter((o) => o === "sent").length };
}

/** El resumen de esta semana para un socio concreto (vista previa o "envíamelo ahora"). */
export async function renderDigestForMember(db: Db, org: DigestOrg, member: DigestMember): Promise<RenderedDigest> {
  const today = nowInZone(org.timezone).date;
  const data = await loadDigestOrgData(db, org, today);
  return renderFor(db, org, member, data);
}

export async function runWeeklyDigest(admin: Db, opts: { force?: boolean } = {}): Promise<DigestRunResult[]> {
  const { data: orgs, error } = await admin.from("orgs").select("id, slug, name, timezone, settings, locale, currency");
  if (error) throw new Error(`[digest] orgs: ${error.message}`);
  const results: DigestRunResult[] = [];

  for (const org of orgs ?? []) {
    const today = nowInZone(org.timezone).date;
    if (!opts.force && !isMonday(today)) {
      results.push({ orgId: org.id, skipped: "not_monday" });
      continue;
    }
    const weekStart = mondayOf(today);
    const { data: done } = await admin
      .from("job_runs")
      .select("id")
      .eq("org_id", org.id)
      .eq("job", DIGEST_JOB)
      .eq("run_on", weekStart)
      .eq("status", "succeeded")
      .limit(1);
    if (done && done.length > 0) {
      results.push({ orgId: org.id, skipped: "already_sent" });
      continue;
    }
    // Una ejecución colgada más de 30 minutos no bloquea la siguiente.
    await admin
      .from("job_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: "timeout" })
      .eq("org_id", org.id)
      .eq("job", DIGEST_JOB)
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 30 * 60_000).toISOString());
    const started = await admin.from("job_runs").insert({ org_id: org.id, job: DIGEST_JOB, run_on: weekStart }).select("id").single();
    if (started.error) {
      results.push(started.error.code === "23505" ? { orgId: org.id, skipped: "busy" } : { orgId: org.id, error: started.error.message });
      continue;
    }

    try {
      const data = await loadDigestOrgData(admin, org, today);
      const { data: members, error: membersError } = await admin
        .from("members")
        .select("id, user_id, full_name, locale, role")
        .eq("org_id", org.id)
        .eq("is_active", true)
        .eq("weekly_digest", true)
        .in("role", ["partner", "owner"]);
      if (membersError) throw new Error(membersError.message);
      let emails = 0;
      let pushes = 0;
      for (const member of members ?? []) {
        try {
          const delivered = await deliverDigest(admin, org, member, await renderFor(admin, org, member, data));
          if (delivered.email) emails += 1;
          pushes += delivered.pushes;
        } catch (memberError) {
          console.error("[digest] miembro", member.id, memberError);
        }
      }
      await admin
        .from("job_runs")
        .update({ status: "succeeded", finished_at: new Date().toISOString(), summary: { members: members?.length ?? 0, emails, pushes } as Json })
        .eq("id", started.data.id);
      results.push({ orgId: org.id, emails, pushes });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      await admin.from("job_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message }).eq("id", started.data.id);
      results.push({ orgId: org.id, error: message });
    }
  }
  return results;
}
