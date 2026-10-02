import "server-only";
import { cookies, headers } from "next/headers";
import { deviceConfirmationByEmail } from "@/lib/auth-policy";
import { publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getEmailProvider } from "@/server/email/provider";
import { chosenCodeProblem, generateAccessCode, hashAccessCode, maskEmail, newToken, normalizeAccessCode, sha256Hex, verifyAccessCode } from "./code-crypto";
import { type RenderedSecurityEmail, renderCodeChangedEmail, renderDeviceEmail, securityLocale } from "./security-email";

// Entrada de los socios con su código personal de 8 cifras (tablas en
// supabase/migrations/20260926370000_codigos_acceso.sql). Tres defensas:
// 1. El código solo se guarda como hash scrypt con sal.
// 2. Los intentos fallidos están limitados por IP (5 cada 15 min) y en total (50 cada 10 min).
// 3. El código solo abre sesión en un dispositivo de confianza; en uno nuevo, además, llega un
//    enlace al email del socio que hay que confirmar a mano ("¿eres tú?").
// La sesión se abre con Supabase Auth (enlace mágico generado y verificado en el servidor), así que
// todo lo demás (RLS, cookies, cierre de sesión) funciona igual que con contraseña.

export const DEVICE_COOKIE = "gos_device";
const DEVICE_MAX_AGE = 400 * 24 * 60 * 60;
const IP_WINDOW_MIN = 15;
const IP_MAX_FAILS = 5;
const GLOBAL_WINDOW_MIN = 10;
const GLOBAL_MAX_FAILS = 50;
const CONFIRM_TTL_MIN = 20;

export type CodeSignInResult =
  | { status: "ok"; name: string }
  | { status: "invalid" }
  | { status: "rate_limited" }
  | { status: "device_pending"; email: string }
  | { status: "error" };

const since = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const secureCookies = () => (publicEnv.NEXT_PUBLIC_APP_URL ?? "").startsWith("https://");

async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** "iPhone · Safari", "Mac · Chrome"… para reconocer el dispositivo en el email y en Ajustes. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  const os = /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) ? "iPad" : /android/i.test(ua) ? "Android" : /mac os/i.test(ua) ? "Mac" : /windows/i.test(ua) ? "Windows" : /linux/i.test(ua) ? "Linux" : "Dispositivo";
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "Navegador";
  return `${os} · ${browser}`;
}

/** El token de este navegador (cookie httpOnly); si no hay y se pide, uno nuevo. */
async function deviceToken(create: boolean): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE)?.value;
  if (existing && /^[A-Za-z0-9_-]{40,}$/.test(existing)) return existing;
  if (!create) return null;
  const token = newToken();
  store.set(DEVICE_COOKIE, token, { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", maxAge: DEVICE_MAX_AGE });
  return token;
}

/** Abre la sesión de Supabase de ese usuario en este navegador (cookies), sin contraseña. */
async function startSession(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) {
    console.error("[auth] code session link", error?.code);
    return false;
  }
  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "email", token_hash: data.properties.hashed_token });
  if (verifyError) console.error("[auth] code session verify", verifyError.code);
  return !verifyError;
}

const EMAIL_FROM = () => process.env.EMAIL_FROM || "GNERAI <facturacion@gnerai.com>";

async function sendSecurityEmail(to: string, email: RenderedSecurityEmail): Promise<boolean> {
  const provider = getEmailProvider();
  if (!provider) return false;
  try {
    await provider.send({ from: EMAIL_FROM(), to: [to], subject: email.subject, text: email.text, html: email.html });
    return true;
  } catch (error) {
    console.error("[auth] security email", error);
    return false;
  }
}

/**
 * Quien aún no es socio de ninguna org también puede entrar con su código si nunca lo ha sido (el
 * primer socio, que crea la org en el onboarding) o si tiene una invitación pendiente (la acepta al
 * entrar). A quien se le quitó el acceso no le vale: tiene su fila de socio, inactiva.
 */
async function newcomerProfile(userId: string, email: string): Promise<{ name: string; locale: string; timeZone: string } | null> {
  const admin = createAdminClient();
  const [{ count: memberships }, { data: invitation }, { data: user }] = await Promise.all([
    admin.from("members").select("id", { count: "exact", head: true }).eq("user_id", userId),
    admin
      .from("member_invitations")
      .select("full_name")
      .eq("email", email.toLowerCase())
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1)
      .maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  if ((memberships ?? 0) > 0 && !invitation) return null;
  const metaName = user.user?.user_metadata?.full_name;
  const name = invitation?.full_name || (typeof metaName === "string" && metaName) || email.split("@")[0]!;
  return { name, locale: "es", timeZone: "Europe/Madrid" };
}

/** Nombre, idioma y zona horaria del socio (de su primera org activa) para escribirle. */
async function memberProfile(userId: string): Promise<{ name: string; locale: string; timeZone: string } | null> {
  const { data } = await createAdminClient()
    .from("members")
    .select("full_name, locale, orgs(timezone)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { name: data.full_name, locale: data.locale, timeZone: data.orgs?.timezone ?? "Europe/Madrid" };
}

/** Entrar con el código: sesión en un dispositivo de confianza o, en uno nuevo, el email para confirmarlo. */
export async function signInWithCode(input: string, userAgent: string | null): Promise<CodeSignInResult> {
  const admin = createAdminClient();
  const ipHash = sha256Hex(`ip:${await requestIp()}`);
  const known = await deviceToken(false);
  // El intento se apunta ANTES de comprobar nada (auditoría A12): así N peticiones a la vez cuentan
  // N y no una, y si no se puede apuntar o contar, no se entra (cerrado por defecto). Si el código
  // acierta, el apunte pasa a ok más abajo.
  const { data: attempt, error: attemptError } = await admin.from("access_code_attempts").insert({ ip_hash: ipHash, ok: false }).select("id").single();
  if (attemptError || !attempt) {
    console.error("[auth] attempt reserve", attemptError?.code);
    return { status: "error" };
  }
  const [ipFails, globalFails, trusted] = await Promise.all([
    admin.from("access_code_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).eq("ok", false).gte("at", since(IP_WINDOW_MIN)),
    admin.from("access_code_attempts").select("id", { count: "exact", head: true }).eq("ok", false).gte("at", since(GLOBAL_WINDOW_MIN)),
    known
      ? admin.from("trusted_devices").select("id", { count: "exact", head: true }).eq("device_hash", sha256Hex(known)).not("confirmed_at", "is", null).is("revoked_at", null)
      : null,
  ]);
  if (ipFails.error || globalFails.error || trusted?.error) {
    console.error("[auth] attempt count", ipFails.error?.code ?? globalFails.error?.code ?? trusted?.error?.code);
    return { status: "error" };
  }
  // El límite global frena a quien prueba desde muchas IPs; un dispositivo de confianza no lo
  // cuenta, para que nadie pueda dejar fuera a los socios a base de intentos fallidos. El recuento
  // incluye el intento recién apuntado.
  const fromTrustedDevice = (trusted?.count ?? 0) > 0;
  if ((ipFails.count ?? 0) > IP_MAX_FAILS || (!fromTrustedDevice && (globalFails.count ?? 0) > GLOBAL_MAX_FAILS)) {
    return { status: "rate_limited" };
  }

  const code = normalizeAccessCode(input);
  const { data: rows, error: rowsError } = await admin.from("access_codes").select("user_id, code_hash");
  if (rowsError) {
    console.error("[auth] access codes", rowsError.code);
    return { status: "error" };
  }
  // Se comprueban todos siempre: tarda lo mismo acierte o no (nada que medir desde fuera).
  const matches = await Promise.all((rows ?? []).map(async (row) => ((code && (await verifyAccessCode(code, row.code_hash))) ? row.user_id : null)));
  const userId = matches.find((m): m is string => m !== null) ?? null;
  if (!userId) return { status: "invalid" };
  await admin.from("access_code_attempts").update({ ok: true, user_id: userId }).eq("id", attempt.id);

  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const email = userData.user?.email;
  if (!email) return { status: "error" };
  const member = (await memberProfile(userId)) ?? (await newcomerProfile(userId, email));
  if (!member) return { status: "invalid" }; // quien ya no es socio de ninguna org no entra, tenga el código que tenga

  const token = (await deviceToken(true))!;
  const deviceHash = sha256Hex(token);
  const now = new Date().toISOString();
  const { data: device } = await admin
    .from("trusted_devices")
    .select("id, confirmed_at, revoked_at, confirm_expires_at")
    .eq("user_id", userId)
    .eq("device_hash", deviceHash)
    .maybeSingle();

  if (device?.confirmed_at && !device.revoked_at) {
    await Promise.all([
      admin.from("trusted_devices").update({ last_used_at: now }).eq("id", device.id),
      admin.from("access_codes").update({ last_used_at: now }).eq("user_id", userId),
    ]);
    return (await startSession(email)) ? { status: "ok", name: member.name } : { status: "error" };
  }

  const label = deviceLabel(userAgent);
  if (!deviceConfirmationByEmail()) {
    // Sin confirmación por email: el código basta. El dispositivo queda como de confianza (se ve en
    // Ajustes y se puede quitar) y los socios reciben el aviso en la app.
    const { data: saved, error: saveError } = await admin
      .from("trusted_devices")
      .upsert(
        {
          user_id: userId,
          device_hash: deviceHash,
          label,
          confirmed_at: now,
          revoked_at: null,
          confirm_token_hash: null,
          confirm_expires_at: null,
          last_used_at: now,
        },
        { onConflict: "user_id,device_hash" },
      )
      .select("id")
      .single();
    if (saveError || !saved) {
      console.error("[auth] trusted device", saveError?.code);
      return { status: "error" };
    }
    await admin.from("access_codes").update({ last_used_at: now }).eq("user_id", userId);
    await notifyNewDevice(userId, saved.id, label);
    return (await startSession(email)) ? { status: "ok", name: member.name } : { status: "error" };
  }

  // Dispositivo nuevo (o revocado): pendiente hasta que el socio lo confirme desde su email.
  // Sin inundar su correo: un email por dispositivo y minuto, y 5 dispositivos nuevos por hora.
  const maskedEmail = maskEmail(email);
  const sentAt = device?.confirm_expires_at ? Date.parse(device.confirm_expires_at) - CONFIRM_TTL_MIN * 60_000 : 0;
  if (!device?.confirmed_at && Date.now() - sentAt < 60_000) return { status: "device_pending", email: maskedEmail };
  if (!device) {
    const { count: recent } = await admin
      .from("trusted_devices")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("confirmed_at", null)
      .gte("created_at", since(60));
    if ((recent ?? 0) >= 5) return { status: "rate_limited" };
  }
  const confirm = newToken();
  const { error: upsertError } = await admin.from("trusted_devices").upsert(
    {
      user_id: userId,
      device_hash: deviceHash,
      label,
      confirmed_at: null,
      revoked_at: null,
      confirm_token_hash: sha256Hex(confirm),
      confirm_expires_at: new Date(Date.now() + CONFIRM_TTL_MIN * 60_000).toISOString(),
    },
    { onConflict: "user_id,device_hash" },
  );
  if (upsertError) {
    console.error("[auth] pending device", upsertError.code);
    return { status: "error" };
  }
  const sent = await sendSecurityEmail(
    email,
    renderDeviceEmail(securityLocale(member.locale), {
      name: member.name,
      device: label,
      at: new Date(),
      timeZone: member.timeZone,
      url: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/device?token=${confirm}`,
      minutes: CONFIRM_TTL_MIN,
    }),
  );
  if (!sent) return { status: "error" };
  return { status: "device_pending", email: maskedEmail };
}

export type DeviceConfirmation =
  | { status: "invalid" }
  | { status: "ready"; label: string; name: string }
  | { status: "confirmed" }
  | { status: "signed_in" };

async function pendingDevice(token: string) {
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  const { data } = await createAdminClient()
    .from("trusted_devices")
    .select("id, user_id, device_hash, label, confirm_expires_at, revoked_at")
    .eq("confirm_token_hash", sha256Hex(token))
    .maybeSingle();
  if (!data || data.revoked_at || !data.confirm_expires_at || Date.parse(data.confirm_expires_at) < Date.now()) return null;
  return data;
}

/** Lo que enseña la página del enlace antes de confirmar (el dispositivo, para decidir "¿soy yo?"). */
export async function describeDeviceConfirmation(token: string): Promise<DeviceConfirmation> {
  const device = await pendingDevice(token);
  if (!device) return { status: "invalid" };
  let member = await memberProfile(device.user_id);
  if (!member) {
    const { data } = await createAdminClient().auth.admin.getUserById(device.user_id);
    member = data.user?.email ? await newcomerProfile(device.user_id, data.user.email) : null;
  }
  return { status: "ready", label: device.label ?? "", name: member?.name ?? "" };
}

/**
 * Confirma el dispositivo (a mano: un botón, no la simple visita, que los antivirus del correo
 * abren los enlaces solos). Avisa a los socios y, si se confirma desde ese mismo navegador, entra.
 */
export async function confirmDevice(token: string): Promise<DeviceConfirmation> {
  const device = await pendingDevice(token);
  if (!device) return { status: "invalid" };
  const admin = createAdminClient();
  await admin
    .from("trusted_devices")
    .update({ confirmed_at: new Date().toISOString(), confirm_token_hash: null, confirm_expires_at: null })
    .eq("id", device.id);

  await notifyNewDevice(device.user_id, device.id, device.label ?? "");

  const current = await deviceToken(false);
  if (current && sha256Hex(current) === device.device_hash) {
    const { data: userData } = await admin.auth.admin.getUserById(device.user_id);
    if (userData.user?.email && (await startSession(userData.user.email))) return { status: "signed_in" };
  }
  return { status: "confirmed" };
}

/** Aviso en la bandeja (y push) de cada org del socio: sabéis siempre desde dónde se entra. */
async function notifyNewDevice(userId: string, deviceId: string, label: string): Promise<void> {
  const admin = createAdminClient();
  const { data: memberships } = await admin.from("members").select("org_id, full_name").eq("user_id", userId).eq("is_active", true);
  for (const m of memberships ?? []) {
    await admin.from("notifications").insert({
      org_id: m.org_id,
      kind: "new_device",
      params: { member: m.full_name, device: label },
      href: "/settings/team",
      dedupe_key: `new_device:${deviceId}:${Date.now()}`,
    });
  }
}

/** Código nuevo para un usuario (el anterior deja de valer): se guarda su hash y se devuelve una sola vez. */
export async function issueAccessCode(userId: string, createdBy: string): Promise<string> {
  const admin = createAdminClient();
  const { data: existing, error: othersError } = await admin.from("access_codes").select("user_id, code_hash");
  if (othersError) throw new Error(`[auth] issue code: ${othersError.message}`);
  const hadCode = (existing ?? []).some((row) => row.user_id === userId);
  const others = (existing ?? []).filter((row) => row.user_id !== userId);
  // Cada código abre una sola cuenta: si coincidiera con el de otro socio, se saca otro.
  let code = generateAccessCode();
  while ((await Promise.all(others.map((o) => verifyAccessCode(code, o.code_hash)))).some(Boolean)) code = generateAccessCode();
  const { error } = await admin
    .from("access_codes")
    .upsert({ user_id: userId, code_hash: await hashAccessCode(code), created_at: new Date().toISOString(), created_by: createdBy, last_used_at: null });
  if (error) throw new Error(`[auth] issue code: ${error.message}`);
  await notifyCodeChanged(userId, createdBy, hadCode);
  return code;
}

export type SetCodeResult = { ok: true } | { ok: false; reason: "format" | "weak" | "mismatch" | "taken" | "rate_limited" };

/**
 * El socio elige su propio código (en vez de uno al azar). Mismas garantías que uno generado: solo
 * se guarda su hash, nunca uno de los obvios y nunca el mismo que el de otro socio.
 */
export async function setChosenAccessCode(userId: string, code: string, repeat: string): Promise<SetCodeResult> {
  const problem = chosenCodeProblem(code, repeat);
  if (problem) return { ok: false, reason: problem };
  const normalized = normalizeAccessCode(code)!;
  const admin = createAdminClient();
  // «Ya lo tiene otro socio» daría pistas del código de otro: cada vez cuenta como un intento
  // fallido de entrada y tiene el mismo límite (5 cada 15 min desde la misma IP).
  const ipHash = sha256Hex(`ip:${await requestIp()}`);
  const { count: fails } = await admin
    .from("access_code_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("ok", false)
    .gte("at", since(IP_WINDOW_MIN));
  if ((fails ?? 0) >= IP_MAX_FAILS) return { ok: false, reason: "rate_limited" };
  const { data: existing, error } = await admin.from("access_codes").select("user_id, code_hash");
  if (error) throw new Error(`[auth] set code: ${error.message}`);
  const hadCode = (existing ?? []).some((row) => row.user_id === userId);
  const others = (existing ?? []).filter((row) => row.user_id !== userId);
  if ((await Promise.all(others.map((o) => verifyAccessCode(normalized, o.code_hash)))).some(Boolean)) {
    await admin.from("access_code_attempts").insert({ ip_hash: ipHash, user_id: userId, ok: false });
    return { ok: false, reason: "taken" };
  }
  const { error: upsertError } = await admin
    .from("access_codes")
    .upsert({ user_id: userId, code_hash: await hashAccessCode(normalized), created_at: new Date().toISOString(), created_by: userId, last_used_at: null });
  if (upsertError) throw new Error(`[auth] set code: ${upsertError.message}`);
  await notifyCodeChanged(userId, userId, hadCode);
  return { ok: true };
}

/** Aviso por email al dueño del código de que ha cambiado (solo con la confirmación por email activada). */
async function notifyCodeChanged(userId: string, createdBy: string, hadCode: boolean): Promise<void> {
  if (!deviceConfirmationByEmail()) return;
  const [{ data: target }, member, by] = await Promise.all([
    createAdminClient().auth.admin.getUserById(userId),
    memberProfile(userId),
    createdBy === userId ? null : memberProfile(createdBy),
  ]);
  const email = target.user?.email;
  if (!email || !member) return;
  await sendSecurityEmail(email, renderCodeChangedEmail(securityLocale(member.locale), { name: member.name, by: by?.name ?? null, hadCode }));
}

export type AccessStatus = { hasCode: boolean; codeCreatedAt: string | null; lastUsedAt: string | null; devices: TrustedDeviceView[] };
export type TrustedDeviceView = { id: string; label: string; confirmedAt: string | null; lastUsedAt: string | null; current: boolean };

/** Si tiene código y en qué dispositivos entra (para Ajustes). `current` marca este navegador. */
export async function accessStatus(userId: string): Promise<AccessStatus> {
  const admin = createAdminClient();
  const token = await deviceToken(false);
  const currentHash = token ? sha256Hex(token) : null;
  const [code, devices] = await Promise.all([
    admin.from("access_codes").select("created_at, last_used_at").eq("user_id", userId).maybeSingle(),
    admin
      .from("trusted_devices")
      .select("id, label, device_hash, confirmed_at, last_used_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .not("confirmed_at", "is", null)
      .order("last_used_at", { ascending: false, nullsFirst: false }),
  ]);
  return {
    hasCode: Boolean(code.data),
    codeCreatedAt: code.data?.created_at ?? null,
    lastUsedAt: code.data?.last_used_at ?? null,
    devices: (devices.data ?? []).map((d) => ({
      id: d.id,
      label: d.label ?? "",
      confirmedAt: d.confirmed_at,
      lastUsedAt: d.last_used_at,
      current: d.device_hash === currentHash,
    })),
  };
}

/** Deja de confiar en un dispositivo: la próxima vez que se use el código ahí, vuelve a pedir el email. */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("trusted_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", deviceId)
    .eq("user_id", userId)
    .select("id");
  return (data?.length ?? 0) > 0;
}

/** Limpieza del cron diario: intentos de hace más de 30 días y dispositivos que nadie confirmó a tiempo. */
export async function pruneAccessLog(admin = createAdminClient()): Promise<void> {
  await Promise.all([
    admin.from("access_code_attempts").delete().lt("at", since(30 * 24 * 60)),
    admin.from("trusted_devices").delete().is("confirmed_at", null).lt("confirm_expires_at", new Date().toISOString()),
  ]);
}
