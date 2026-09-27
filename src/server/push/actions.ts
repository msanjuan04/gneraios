"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, invalidInput, memberContext } from "@/server/action-utils";
import { isPushConfigured, recordOutcomes, sendPush } from "./dispatch";

// Activar y desactivar los avisos en este dispositivo (Ajustes → Preferencias).

const base64url = z.string().regex(/^[A-Za-z0-9_=-]+$/);
const subscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  keys: z.object({ p256dh: base64url.min(40).max(200), auth: base64url.min(8).max(100) }),
});
const endpointSchema = z.url({ protocol: /^https$/ }).max(2000);

export type PushDeviceStatus = { configured: boolean; registered: boolean; devices: number };

/** Si el servidor puede enviar y si este dispositivo (su endpoint) está dado de alta. */
export async function getPushDeviceStatus(slug: string, endpoint: string | null): Promise<PushDeviceStatus> {
  const ctx = await memberContext(slug);
  const configured = isPushConfigured();
  if (!ctx) return { configured, registered: false, devices: 0 };
  const supabase = await createClient();
  const { data } = await supabase.from("push_subscriptions").select("endpoint").eq("org_id", ctx.org.id).eq("member_id", ctx.member.id);
  const rows = data ?? [];
  return { configured, registered: endpoint !== null && rows.some((r) => r.endpoint === endpoint), devices: rows.length };
}

export async function registerPushDevice(slug: string, subscription: unknown, userAgent: string | null): Promise<ActionResult> {
  const ctx = await memberContext(slug);
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!ctx || !parsed.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("register_push_subscription", {
    p_org: ctx.org.id,
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: userAgent?.slice(0, 400) ?? undefined,
  });
  if (error) return dbFailure(error, "registerPushDevice");
  return { ok: true };
}

export async function unregisterPushDevice(slug: string, endpoint: string): Promise<ActionResult> {
  const ctx = await memberContext(slug);
  const parsed = endpointSchema.safeParse(endpoint);
  if (!ctx || !parsed.success) return invalidInput();
  const supabase = await createClient();
  const { error } = await supabase.rpc("unregister_push_subscription", { p_org: ctx.org.id, p_endpoint: parsed.data });
  if (error) return dbFailure(error, "unregisterPushDevice");
  return { ok: true };
}

/** Manda una notificación de prueba a este dispositivo. */
export async function sendTestPush(slug: string, endpoint: string): Promise<ActionResult> {
  const ctx = await memberContext(slug);
  const parsed = endpointSchema.safeParse(endpoint);
  if (!ctx || !parsed.success) return invalidInput();
  if (!isPushConfigured()) return failure("settings.preferences.push.notConfigured");

  // La RLS confirma que el dispositivo es del miembro; las claves se leen con service_role.
  const supabase = await createClient();
  const { data: own } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("org_id", ctx.org.id)
    .eq("endpoint", parsed.data)
    .maybeSingle();
  if (!own) return failure("settings.preferences.push.notRegistered");
  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_secret, failure_count")
    .eq("id", own.id)
    .single();
  if (!sub) return failure("settings.preferences.push.notRegistered");

  const t = await getTranslations("settings.preferences.push");
  const outcome = await sendPush(sub, { title: t("testTitle"), body: t("testBody"), url: `/${ctx.org.slug}`, tag: `test-${sub.id}` }, "high");
  await recordOutcomes(admin, new Map([[sub.id, outcome]]), new Map([[sub.id, sub.failure_count]]));
  if (outcome !== "sent") return failure(outcome === "gone" ? "settings.preferences.push.gone" : "settings.preferences.push.sendFailed");
  return { ok: true };
}
