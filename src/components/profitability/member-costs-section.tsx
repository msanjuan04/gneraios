import type { MemberRole } from "@/server/session";
import { nowInZone } from "@/lib/clock";
import { getMemberCostsData } from "@/server/profitability/queries";
import { MemberCostsManager } from "./member-costs-manager";

type OrgRef = { id: string; slug: string; timezone: string; settings: unknown };

/**
 * «Coste interno por hora» en Ajustes → Equipo: lo que cuesta la hora de cada miembro desde cada
 * fecha, con su historial en un panel lateral. Lo ven los socios (partner u owner) y lo cambia un
 * owner; a un viewer no se le enseña (tampoco la RLS le deja leerlo). Carga sus propios datos, así
 * que montarlo es una línea: `<MemberCostsSection org={org} role={me.role} />`.
 */
export async function MemberCostsSection({ org, role }: { org: OrgRef; role: MemberRole }) {
  if (role === "viewer") return null;
  const data = await getMemberCostsData(org, nowInZone(org.timezone).date);
  return <MemberCostsManager slug={org.slug} data={data} canEdit={role === "owner"} />;
}
