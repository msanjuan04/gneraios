/**
 * Tipos que se proponen en el onboarding para una agencia en España. Son solo
 * una propuesta: se guardan en `tax_rates` y desde ahí se editan. Las menciones
 * legales hay que revisarlas con la gestoría.
 */

export type TaxRateDefault = {
  kind: "vat" | "irpf";
  name: string;
  rate_bps: number;
  regime: "general" | "exempt" | "reverse_charge_eu" | "not_subject" | null;
  legal_note: string;
  is_default: boolean;
};

export const SPAIN_TAX_DEFAULTS: readonly TaxRateDefault[] = [
  { kind: "vat", name: "IVA 21 %", rate_bps: 2100, regime: "general", legal_note: "", is_default: true },
  {
    kind: "vat",
    name: "Exento",
    rate_bps: 0,
    regime: "exempt",
    legal_note: "Operación exenta de IVA (art. 20 LIVA)",
    is_default: false,
  },
  {
    kind: "vat",
    name: "Inversión del sujeto pasivo (UE)",
    rate_bps: 0,
    regime: "reverse_charge_eu",
    legal_note: "Inversión del sujeto pasivo (art. 196 de la Directiva 2006/112/CE)",
    is_default: false,
  },
  {
    kind: "vat",
    name: "No sujeto (fuera de la UE)",
    rate_bps: 0,
    regime: "not_subject",
    legal_note: "Operación no sujeta a IVA por reglas de localización (art. 69 LIVA)",
    is_default: false,
  },
  { kind: "irpf", name: "IRPF 15 %", rate_bps: 1500, regime: null, legal_note: "", is_default: true },
  { kind: "irpf", name: "IRPF 7 % (inicio de actividad)", rate_bps: 700, regime: null, legal_note: "", is_default: false },
];

/** Plazos Verifactu (RDL 15/2025). La base de datos aplica los mismos por defecto. */
export const VERIFACTU_FROM = { company: "2027-01-01", self_employed: "2027-07-01" } as const;
