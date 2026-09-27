"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { memberContext } from "@/server/action-utils";

export type InboxItem = {
  id: string;
  kind:
    | "renewal"
    | "reminder_ready"
    | "job_failed"
    | "verifactu_deadline"
    | "quote_accepted"
    | "quote_rejected"
    | "portal_request"
    | "new_device"
    // Webs (src/server/sites): caída, vuelta, certificado y dominio a punto de caducar.
    | "site_down"
    | "site_up"
    | "ssl_expiring"
    | "domain_expiring"
    // Una suscripción (dominio, servidor anual…) se renueva pronto (Finanzas → Infraestructura).
    | "subscription_renewal";
  params: Record<string, string | number>;
  href: string | null;
  createdAt: string;
  read: boolean;
};

/** Avisos in-app del usuario (los de todos y los suyos; la RLS filtra). */
export async function getInbox(slug: string): Promise<{ items: InboxItem[]; unread: number }> {
  const ctx = await memberContext(slug);
  if (!ctx) return { items: [], unread: 0 };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, params, href, created_at, read_at")
    .eq("org_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    console.error("[inbox]", error);
    return { items: [], unread: 0 };
  }
  const items = (data ?? []).map((n) => ({
    id: n.id,
    kind: n.kind,
    params: (n.params ?? {}) as Record<string, string | number>,
    href: n.href,
    createdAt: n.created_at,
    read: n.read_at !== null,
  }));
  return { items, unread: items.filter((i) => !i.read).length };
}

const idsSchema = z.array(z.guid()).max(100);

/** Marca avisos como leídos (todos los visibles si no se indican). */
export async function markInboxRead(slug: string, ids?: string[]): Promise<void> {
  const ctx = await memberContext(slug);
  const parsed = ids === undefined ? null : idsSchema.safeParse(ids);
  if (!ctx || (parsed && !parsed.success)) return;
  const supabase = await createClient();
  let query = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("org_id", ctx.org.id).is("read_at", null);
  if (parsed?.success) query = query.in("id", parsed.data);
  const { error } = await query;
  if (error) console.error("[inbox] mark read", error);
}
