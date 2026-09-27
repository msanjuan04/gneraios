import "server-only";
import type { ClientMandatesData } from "@/components/collections/types";
import { nowInZone } from "@/lib/clock";
import type { Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { loadCreditors } from "./creditors";

/**
 * Mandatos SEPA de un cliente para su ficha (`ClientMandateCard`): los activos primero y, de cada
 * uno, su acreedor, su secuencia derivada y si ya se ha usado. Incluye los emisores que pueden
 * cobrar, con si tienen el ICS confirmado, y el titular propuesto para uno nuevo.
 */
export async function getClientMandates(
  org: Pick<Tables<"orgs">, "id" | "timezone">,
  clientId: string,
): Promise<ClientMandatesData> {
  const orgId = org.id;
  const supabase = await createClient();
  const [mandates, client, creditors] = await Promise.all([
    supabase
      .from("client_mandates_overview")
      .select(
        "id, issuer_id, issuer_name, reference, debtor_name, iban, bic, signed_on, revoked_at, revoke_reason, notes, is_active, next_sequence_type, collections_count, last_collection_on, in_use, created_at",
      )
      .eq("org_id", orgId)
      .eq("client_id", clientId)
      .order("is_active", { ascending: false })
      .order("signed_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("clients").select("display_name, legal_name").eq("org_id", orgId).eq("id", clientId).maybeSingle(),
    loadCreditors(supabase, orgId),
  ]);
  if (mandates.error) throw mandates.error;
  if (client.error) throw client.error;

  return {
    mandates: mandates.data.flatMap((m) =>
      m.id && m.issuer_id && m.reference && m.debtor_name && m.iban && m.signed_on
        ? [
            {
              id: m.id,
              issuerId: m.issuer_id,
              issuerName: m.issuer_name ?? "",
              reference: m.reference,
              debtorName: m.debtor_name,
              iban: m.iban,
              bic: m.bic,
              signedOn: m.signed_on,
              revokedAt: m.revoked_at,
              revokeReason: m.revoke_reason,
              notes: m.notes,
              isActive: m.is_active ?? false,
              nextSequence: m.next_sequence_type ?? "FRST",
              collectionsCount: m.collections_count ?? 0,
              lastCollectionOn: m.last_collection_on,
              inUse: m.in_use ?? false,
            },
          ]
        : [],
    ),
    issuers: creditors.map((c) => ({ id: c.issuerId, name: c.issuerName, creditorReady: c.source === "confirmed" })),
    defaultDebtorName: client.data?.legal_name ?? client.data?.display_name ?? "",
    clientName: client.data?.display_name ?? "",
    today: nowInZone(org.timezone).date,
  };
}
