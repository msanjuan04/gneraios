import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Cliente con la clave secreta: salta RLS. Solo para lo que un usuario no puede
 * hacer por sí mismo (enviar invitaciones por email, cron). Nunca llega al navegador.
 */
export function createAdminClient() {
  const { url } = requireSupabaseEnv();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Falta SUPABASE_SECRET_KEY en el entorno del servidor.");
  return createClient<Database>(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
