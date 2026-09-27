import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * ¿La petición trae `Authorization: Bearer <CRON_SECRET>`? Comparación en tiempo constante. Sin
 * CRON_SECRET configurado, nunca: un cron sin secreto no se puede llamar.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
