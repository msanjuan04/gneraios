import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Avisos que genera el correo, para todos los socios activos. Cada aviso lleva una clave por
 * mensaje: sincronizar dos veces el mismo buzón no avisa dos veces (`unique (org_id, dedupe_key)`).
 */

type MailNotice =
  | { kind: "mail_new_lead"; params: { name: string; subject: string }; href: string; dedupe: string }
  | { kind: "mail_accepted"; params: { client: string; number: string; subject: string }; href: string; dedupe: string };

export async function notifyPartners(orgId: string, notice: MailNotice): Promise<void> {
  const admin = createAdminClient();
  const members = await admin.from("members").select("id").eq("org_id", orgId).eq("is_active", true).in("role", ["partner", "owner"]);
  if (members.error) throw members.error;
  if (!members.data?.length) return;
  const { error } = await admin.from("notifications").upsert(
    members.data.map((member) => ({
      org_id: orgId,
      member_id: member.id,
      kind: notice.kind,
      params: notice.params,
      href: notice.href,
      dedupe_key: `${notice.dedupe}:${member.id}`,
    })),
    { onConflict: "org_id,dedupe_key", ignoreDuplicates: true },
  );
  if (error) throw error;
}
