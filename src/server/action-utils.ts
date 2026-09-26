import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { nowInZone } from "@/lib/clock";
import { getOrgContext, hasRole, type OrgContext } from "@/server/session";

export type Failure = { ok: false; error: string };

const slugSchema = z.string().min(1).max(40);

/** Identificador de fila que llega del cliente. */
export const idSchema = z.guid();

/** Contexto de la org para el usuario actual (cualquier rol activo), o null si el slug no es válido. */
export async function memberContext(slug: unknown): Promise<OrgContext | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return getOrgContext(parsed.data);
}

/** Contexto de la org solo si el usuario es owner. RLS lo vuelve a comprobar en cada escritura. */
export async function ownerContext(slug: unknown): Promise<OrgContext | null> {
  const ctx = await memberContext(slug);
  return ctx && hasRole(ctx.member.role, "owner") ? ctx : null;
}

/** Contexto de la org solo si el usuario lleva la operativa (partner u owner). RLS lo vuelve a comprobar. */
export async function partnerContext(slug: unknown): Promise<OrgContext | null> {
  const ctx = await memberContext(slug);
  return ctx && hasRole(ctx.member.role, "partner") ? ctx : null;
}

/** Error traducido para devolver al cliente. */
export async function failure(key: string, values?: Record<string, string | number>): Promise<Failure> {
  const t = await getTranslations();
  return { ok: false, error: t(key, values) };
}

export const forbidden = () => failure("common.errorPermission");
export const invalidInput = () => failure("common.errorGeneric");

/**
 * Traduce un error de PostgREST. `known` da la clave de i18n de los errores
 * esperados; el resto se registra y sale como genérico.
 */
export async function dbFailure(
  error: PostgrestError,
  where: string,
  known?: (error: PostgrestError) => string | undefined,
): Promise<Failure> {
  const key = known?.(error) ?? (error.code === "42501" ? "common.errorPermission" : undefined);
  if (key) return failure(key);
  console.error(`[action] ${where}`, error);
  return failure("common.errorGeneric");
}

/** Año en curso en la zona horaria de la org. */
export function currentYear(timeZone: string): number {
  return Number(nowInZone(timeZone).date.slice(0, 4));
}

/** Vuelve a pintar la pestaña de ajustes (y, con ella, el shell de la org). */
export function revalidateSettings(slug: string, tab?: "issuers" | "taxes" | "team" | "preferences" | "pipeline") {
  revalidatePath(tab ? `/${slug}/settings/${tab}` : `/${slug}/settings`);
}
