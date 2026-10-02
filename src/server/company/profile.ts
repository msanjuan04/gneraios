import "server-only";
import { createClient } from "@/lib/supabase/server";

/** La sociedad (el emisor de tipo empresa de la org), tal y como está dada de alta; null si aún no hay. */
export type CompanyProfile = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string;
  email: string | null;
  phone: string | null;
  iban: string | null;
  /** Fecha de alta/constitución efectiva; null = pendiente de constituir. */
  activeFrom: string | null;
  registryInfo: string | null;
  verifactuFrom: string;
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function loadCompanyProfile(supabase: Supabase, orgId: string): Promise<CompanyProfile | null> {
  const { data, error } = await supabase
    .from("issuers")
    .select("id, legal_name, trade_name, tax_id, address_line, postal_code, city, province, country_code, email, phone, iban, active_from, registry_info, verifactu_from")
    .eq("org_id", orgId)
    .eq("kind", "company")
    .is("archived_at", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    legalName: data.legal_name,
    tradeName: data.trade_name,
    taxId: data.tax_id,
    addressLine: data.address_line,
    postalCode: data.postal_code,
    city: data.city,
    province: data.province,
    countryCode: data.country_code,
    email: data.email,
    phone: data.phone,
    iban: data.iban,
    activeFrom: data.active_from,
    registryInfo: data.registry_info,
    verifactuFrom: data.verifactu_from,
  };
}
