import "server-only";
import type { MemberRef } from "@/components/clients/types";
import type { createClient } from "@/lib/supabase/server";
import type { CrmConfig } from "@/server/crm/config";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Instante de la petición (ms). Se pasa a los componentes para que los tiempos
 * relativos ("hace 3 días") salgan iguales en el servidor y al hidratar.
 */
export function requestTime(): number {
  return Date.now();
}

const unique = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))];

export type NameResolver = {
  member(id: string | null | undefined, fallbackInitials?: string | null): MemberRef | null;
  source(id: string | null | undefined): string | null;
};

/**
 * Nombres de socios y fuentes de adquisición. Salen de la configuración del CRM
 * (solo activos); los que falten (un socio sin acceso, una fuente archivada) se
 * piden aparte, y solo si hace falta.
 */
export async function resolveNames(
  supabase: Supabase,
  orgId: string,
  config: CrmConfig,
  ids: { memberIds: (string | null | undefined)[]; sourceIds: (string | null | undefined)[] },
): Promise<NameResolver> {
  const members = new Map(config.members.map((m) => [m.id, { fullName: m.fullName, initials: m.initials }]));
  const sources = new Map(config.sources.map((s) => [s.id, s.name]));
  const missingMembers = unique(ids.memberIds).filter((id) => !members.has(id));
  const missingSources = unique(ids.sourceIds).filter((id) => !sources.has(id));

  const [memberRows, sourceRows] = await Promise.all([
    missingMembers.length > 0
      ? supabase.from("members").select("id, full_name, initials").eq("org_id", orgId).in("id", missingMembers)
      : null,
    missingSources.length > 0
      ? supabase.from("acquisition_sources").select("id, name").eq("org_id", orgId).in("id", missingSources)
      : null,
  ]);
  if (memberRows?.error) throw memberRows.error;
  if (sourceRows?.error) throw sourceRows.error;
  for (const m of memberRows?.data ?? []) members.set(m.id, { fullName: m.full_name, initials: m.initials });
  for (const s of sourceRows?.data ?? []) sources.set(s.id, s.name);

  return {
    member(id, fallbackInitials) {
      if (!id) return null;
      const known = members.get(id);
      return { id, fullName: known?.fullName ?? null, initials: known?.initials ?? fallbackInitials ?? "?" };
    },
    source(id) {
      return id ? (sources.get(id) ?? null) : null;
    },
  };
}
