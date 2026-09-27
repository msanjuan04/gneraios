import "server-only";
import type { MemberCostsData } from "@/components/profitability/types";
import type { CivilDate } from "@/domain/dates/civil-date";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/server/billing/context";
import { loadMemberCosts } from "./load";
import { profitabilitySettings } from "./settings";

/**
 * Miembros de la org con su historial de coste por hora (Ajustes → Equipo). Con la sesión del
 * usuario: los costes solo los devuelve la RLS a un socio (partner u owner).
 */
export async function getMemberCostsData(org: { id: string; settings: unknown }, today: CivilDate): Promise<MemberCostsData> {
  const supabase = await createClient();
  const [members, costs] = await Promise.all([
    fetchAll(
      (from, to) =>
        supabase
          .from("members")
          .select("id, full_name, initials, is_active")
          .eq("org_id", org.id)
          .order("is_active", { ascending: false })
          .order("full_name")
          .order("id")
          .range(from, to),
      "profitability.members",
    ),
    loadMemberCosts(supabase, org.id),
  ]);
  return {
    today,
    settings: profitabilitySettings(org.settings),
    members: members.map((m) => ({
      id: m.id,
      fullName: m.full_name,
      initials: m.initials,
      isActive: m.is_active,
      // De la más antigua a la más reciente (como la lee el dominio).
      history: costs
        .filter((c) => c.memberId === m.id)
        .map((c) => ({ id: c.id, memberId: c.memberId, validFrom: c.validFrom, hourlyCostCents: c.hourlyCostCents })),
    })),
  };
}
