import "server-only";
import { createTranslator } from "next-intl";
import webpush, { WebPushError } from "web-push";
import { formatMoney } from "@/domain/money";
import { notificationMessageKey, notificationValues, type NotificationParams } from "@/domain/notifications/text";
import caCore from "@/i18n/messages/ca/core.json";
import enCore from "@/i18n/messages/en/core.json";
import esCore from "@/i18n/messages/es/core.json";
import { deepMerge, type Messages } from "@/i18n/messages/merge";
import type { Db } from "@/server/billing/context";

// Reparto de avisos a los dispositivos (Web Push). El texto es el mismo que el de la bandeja
// (inbox.kinds.*), en el idioma de cada miembro. Sin claves VAPID no se envía nada ni se marca
// nada: los avisos se reparten en cuanto se configuren (los de las últimas 24 h).

type PushLocale = "es" | "ca" | "en";

const CATALOGS: Record<PushLocale, Messages> = {
  es: esCore,
  ca: deepMerge(esCore, caCore as Messages),
  en: deepMerge(esCore, enCore as Messages),
};
const INTL_LOCALE: Record<PushLocale, string> = { es: "es-ES", ca: "ca-ES", en: "en-IE" };

/** Tras tantos fallos seguidos (que no sean "ya no existe"), se deja de intentar con ese dispositivo. */
const MAX_FAILURES = 5;
const BATCH = 200;

export type PushPayload = { title: string; body: string; url: string; tag: string };

type LooseTranslator = ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

type Vapid = { subject: string; publicKey: string; privateKey: string };

function vapid(): Vapid | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { subject: process.env.VAPID_SUBJECT || "mailto:hola@gnerai.com", publicKey, privateKey };
}

export function isPushConfigured(): boolean {
  return vapid() !== null;
}

function asLocale(value: string | null | undefined): PushLocale {
  return value === "ca" || value === "en" ? value : "es";
}

/** Título y cuerpo de un aviso en el idioma del miembro, como en la bandeja. */
export function renderPush(
  kind: string,
  params: NotificationParams,
  locale: PushLocale,
  fallbackTitle: string,
): { title: string; body: string } {
  // Catálogo sin tipar (se fusiona en tiempo de ejecución): claves como texto.
  const t = createTranslator({ locale, messages: CATALOGS[locale] }) as unknown as LooseTranslator;
  const intl = INTL_LOCALE[locale];
  const values = notificationValues(params, {
    date: (civil) =>
      new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${civil}T12:00:00Z`)),
    money: (cents) => formatMoney(cents, { locale: intl }),
  });
  const key = notificationMessageKey(kind, params);
  const body = t.has(`inbox.kinds.${key}`) ? t(`inbox.kinds.${key}`, values) : fallbackTitle;
  const title = t.has(`push.titles.${kind}`) ? t(`push.titles.${kind}`) : fallbackTitle;
  return { title, body };
}

type Subscription = { id: string; endpoint: string; p256dh: string; auth_secret: string };

export type SendOutcome = "sent" | "gone" | "failed";

/** Envía un payload a un dispositivo. "gone" = el navegador ya no la reconoce (hay que borrarla). */
export async function sendPush(sub: Subscription, payload: PushPayload, urgency: "normal" | "high" = "normal"): Promise<SendOutcome> {
  const keys = vapid();
  if (!keys) return "failed";
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } }, JSON.stringify(payload), {
      vapidDetails: keys,
      TTL: 24 * 60 * 60,
      urgency,
      timeout: 10_000,
    });
    return "sent";
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return "gone";
    console.error("[push] send", error instanceof WebPushError ? `${error.statusCode} ${error.body}` : error);
    return "failed";
  }
}

/** Anota el resultado de los envíos: borra las suscripciones muertas y cuenta los fallos. */
export async function recordOutcomes(admin: Db, outcomes: Map<string, SendOutcome>, failures: Map<string, number>): Promise<void> {
  const sent = [...outcomes].filter(([, o]) => o === "sent").map(([id]) => id);
  const gone = [...outcomes].filter(([, o]) => o === "gone").map(([id]) => id);
  const failed = [...outcomes].filter(([, o]) => o === "failed").map(([id]) => id);
  if (sent.length > 0) {
    await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).in("id", sent);
  }
  if (gone.length > 0) await admin.from("push_subscriptions").delete().in("id", gone);
  for (const id of failed) {
    await admin.from("push_subscriptions").update({ failure_count: (failures.get(id) ?? 0) + 1 }).eq("id", id);
  }
}

export type PushDispatchResult = { configured: boolean; notifications: number; sent: number; failed: number; removed: number };

/**
 * Reparte los avisos recientes que aún no se han repartido. Primero los reclama (pushed_at), así
 * que dos repartos a la vez nunca mandan el mismo aviso dos veces; si un envío falla, no se
 * reintenta (el aviso sigue en la bandeja).
 */
export async function dispatchPendingPushes(admin: Db, opts: { orgId?: string; maxAgeHours?: number } = {}): Promise<PushDispatchResult> {
  const result: PushDispatchResult = { configured: isPushConfigured(), notifications: 0, sent: 0, failed: 0, removed: 0 };
  if (!result.configured) return result;

  const since = new Date(Date.now() - (opts.maxAgeHours ?? 24) * 60 * 60 * 1000).toISOString();
  let pendingQuery = admin
    .from("notifications")
    .select("id")
    .is("pushed_at", null)
    .gte("created_at", since)
    .order("created_at")
    .limit(BATCH);
  if (opts.orgId) pendingQuery = pendingQuery.eq("org_id", opts.orgId);
  const { data: pending, error: pendingError } = await pendingQuery;
  if (pendingError) throw new Error(`[push] pending: ${pendingError.message}`);
  if (!pending || pending.length === 0) return result;

  const { data: claimed, error: claimError } = await admin
    .from("notifications")
    .update({ pushed_at: new Date().toISOString() })
    .in(
      "id",
      pending.map((n) => n.id),
    )
    .is("pushed_at", null)
    .select("id, org_id, member_id, kind, params, href");
  if (claimError) throw new Error(`[push] claim: ${claimError.message}`);
  if (!claimed || claimed.length === 0) return result;
  result.notifications = claimed.length;

  const orgIds = [...new Set(claimed.map((n) => n.org_id))];
  const [{ data: orgs }, { data: members }, { data: subs }] = await Promise.all([
    admin.from("orgs").select("id, slug, name").in("id", orgIds),
    admin.from("members").select("id, org_id, locale, is_active").in("org_id", orgIds),
    admin
      .from("push_subscriptions")
      .select("id, org_id, member_id, endpoint, p256dh, auth_secret, failure_count")
      .in("org_id", orgIds)
      .lt("failure_count", MAX_FAILURES),
  ]);
  const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));
  const memberById = new Map((members ?? []).filter((m) => m.is_active).map((m) => [m.id, m]));
  const subsByMember = new Map<string, NonNullable<typeof subs>>();
  for (const sub of subs ?? []) {
    const list = subsByMember.get(sub.member_id) ?? [];
    list.push(sub);
    subsByMember.set(sub.member_id, list);
  }

  const outcomes = new Map<string, SendOutcome>();
  const failures = new Map((subs ?? []).map((s) => [s.id, s.failure_count]));
  for (const n of claimed) {
    const org = orgById.get(n.org_id);
    if (!org) continue;
    const recipients = n.member_id
      ? [n.member_id]
      : [...memberById.values()].filter((m) => m.org_id === n.org_id).map((m) => m.id);
    for (const memberId of recipients) {
      const member = memberById.get(memberId);
      if (!member) continue;
      const { title, body } = renderPush(n.kind, (n.params ?? {}) as NotificationParams, asLocale(member.locale), org.name);
      const payload: PushPayload = { title, body, url: `/${org.slug}${n.href ?? ""}`, tag: n.id };
      const urgency = n.kind === "quote_accepted" || n.kind === "job_failed" ? "high" : "normal";
      for (const sub of subsByMember.get(memberId) ?? []) {
        if (outcomes.get(sub.id) === "gone") continue;
        const outcome = await sendPush(sub, payload, urgency);
        // "Ya no existe" manda; si no, cuenta como enviado si al menos un aviso le llegó.
        const previous = outcomes.get(sub.id);
        if (outcome === "gone" || previous === undefined || (outcome === "sent" && previous === "failed")) {
          outcomes.set(sub.id, outcome);
        }
        if (outcome === "sent") result.sent += 1;
        else if (outcome === "gone") result.removed += 1;
        else result.failed += 1;
      }
    }
  }
  await recordOutcomes(admin, outcomes, failures);
  return result;
}
