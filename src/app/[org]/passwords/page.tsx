import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { VaultView } from "@/components/vault/vault-view";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext, hasRole } from "@/server/session";
import { listVaultItems, loadVaultState } from "@/server/vault/queries";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("passwords"))("title") };
}

/**
 * Contraseñas del equipo, cifradas de extremo a extremo: esta página solo reparte texto cifrado y el
 * navegador lo abre con la contraseña maestra de quien mira. El servidor no puede leer nada.
 */
export default async function PasswordsPage({ params }: PageProps<"/[org]/passwords">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const t = await getTranslations("passwords");
  const supabase = await createClient();
  const [state, rows, clients] = await Promise.all([
    loadVaultState(org.id, member.id),
    // Sin sobre, la RLS no devuelve ninguno: la lista llega vacía y la pantalla pide acceso.
    listVaultItems(org.id),
    supabase.from("clients").select("id, display_name").eq("org_id", org.id).is("archived_at", null).order("display_name"),
  ]);
  if (clients.error) throw clients.error;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title={t("title")} description={t("description")} />
      <VaultView
        slug={org.slug}
        state={state}
        rows={rows}
        clients={(clients.data ?? []).map((client) => ({ id: client.id, name: client.display_name }))}
        canManageAccess={hasRole(member.role, "partner")}
      />
    </div>
  );
}
