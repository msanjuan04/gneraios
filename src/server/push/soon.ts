import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchPendingPushes } from "./dispatch";

/**
 * Reparte a los móviles, en cuanto termine la respuesta, los avisos que se acaban de crear en esta
 * org (un presupuesto aceptado no espera al cron). Si falla, el cron de push lo reintenta en su
 * siguiente pasada: el aviso no se reclama hasta que se envía.
 */
export function pushSoon(orgId: string): void {
  try {
    after(async () => {
      try {
        await dispatchPendingPushes(createAdminClient(), { orgId, maxAgeHours: 1 });
      } catch (error) {
        console.error("[push] reparto inmediato", error);
      }
    });
  } catch (error) {
    // Fuera de una petición (scripts): no hay "después"; ya lo repartirá el cron.
    console.error("[push] reparto inmediato fuera de una petición", error);
  }
}
