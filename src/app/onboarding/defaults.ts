import { brand } from "@/brand";
import { slugify } from "@/domain/org";
import { SPAIN_TAX_DEFAULTS } from "@/domain/tax/spain-defaults";
import type { OnboardingInput } from "@/lib/validation/onboarding";

export type IssuerInput = OnboardingInput["issuers"][number];
export type SeriesInput = IssuerInput["series"][number];

// Mismo formato que la app de facturas actual: 2026-0001.
const ordinarySeries = (): SeriesInput => ({
  code: "F",
  name: "Facturas",
  kind: "ordinary",
  format: "{yyyy}-{n:4}",
  reset_yearly: true,
  is_default: true,
  last_number: 0,
});

const rectifyingSeries = (): SeriesInput => ({
  code: "R",
  name: "Rectificativas",
  kind: "rectifying",
  format: "R{yyyy}-{n:4}",
  reset_yearly: true,
  is_default: true,
  last_number: 0,
});

const emptyIssuerFields = {
  tax_id: "",
  address_line: "",
  postal_code: "",
  city: "",
  province: "",
  email: "",
  iban: "",
  active_from: "",
  registry_info: "",
} as const;

export function companyIssuerDefaults(): IssuerInput {
  return {
    ...emptyIssuerFields,
    kind: "company",
    legal_name: `${brand.name} SL`,
    trade_name: brand.name,
    default_irpf_bps: 0,
    is_primary: true,
    is_me: false,
    pending_constitution: true,
    series: [ordinarySeries(), rectifyingSeries()],
  };
}

export function selfEmployedIssuerDefaults(isMe: boolean): IssuerInput {
  return {
    ...emptyIssuerFields,
    kind: "self_employed",
    legal_name: "",
    trade_name: brand.name,
    default_irpf_bps: 1500,
    is_primary: false,
    is_me: isMe,
    pending_constitution: false,
    series: [ordinarySeries(), rectifyingSeries()],
  };
}

export function onboardingDefaults(): OnboardingInput {
  return {
    org: { name: brand.name, slug: slugify(brand.name) },
    owner: { full_name: "", initials: "", locale: "es" },
    issuers: [companyIssuerDefaults(), selfEmployedIssuerDefaults(true)],
    tax_rates: SPAIN_TAX_DEFAULTS.map((t) => ({ include: true, ...t })),
    invitations: [],
  };
}
