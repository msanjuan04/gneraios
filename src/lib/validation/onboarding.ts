import { z } from "zod";
import { isValidSlug } from "@/domain/org";
import { initialsFrom } from "@/domain/people";
import { locales } from "@/i18n/config";
import { emptyToNull, issuerSchema, requiredText, seriesSchema, taxRateSchema } from "./fiscal";

export const invitationSchema = z.object({
  // Primero se limpia y luego se valida: un espacio pegado al copiar no es un email inválido.
  email: z.string().trim().toLowerCase().pipe(z.email("email")),
  full_name: z.string().trim().max(120, "tooLong"),
  role: z.enum(["owner", "partner", "viewer"]),
});

export const onboardingSchema = z.object({
  org: z.object({
    name: requiredText(120),
    slug: z.string().trim().toLowerCase().refine(isValidSlug, "slug"),
  }),
  owner: z
    .object({
      full_name: requiredText(120),
      initials: z.string().trim().toUpperCase().max(3, "initials"),
      locale: z.enum(locales),
    })
    // Si no las escribe, las iniciales salen del nombre (igual que las propone el formulario).
    .transform((o) => ({ ...o, initials: o.initials || initialsFrom(o.full_name) })),
  issuers: z
    .array(issuerSchema.extend({ series: z.array(seriesSchema).min(1) }))
    .min(1)
    .refine((list) => list.filter((i) => i.is_primary).length === 1, "onePrimary"),
  tax_rates: z.array(taxRateSchema),
  invitations: z.array(invitationSchema),
});

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingValues = z.output<typeof onboardingSchema>;

/** Payload de `create_organization()` a partir del formulario validado. */
export function toCreateOrganizationPayload(values: OnboardingValues, year: number) {
  return {
    org: values.org,
    owner: values.owner,
    issuers: values.issuers.map((issuer) => ({
      kind: issuer.kind,
      legal_name: issuer.legal_name,
      trade_name: emptyToNull(issuer.trade_name),
      tax_id: emptyToNull(issuer.tax_id),
      address_line: emptyToNull(issuer.address_line),
      postal_code: emptyToNull(issuer.postal_code),
      city: emptyToNull(issuer.city),
      province: emptyToNull(issuer.province),
      email: emptyToNull(issuer.email),
      iban: emptyToNull(issuer.iban),
      default_irpf_bps: issuer.kind === "company" ? 0 : issuer.default_irpf_bps,
      is_primary: issuer.is_primary,
      is_me: issuer.kind === "self_employed" && issuer.is_me,
      active_from: issuer.pending_constitution ? null : emptyToNull(issuer.active_from),
      registry_info: emptyToNull(issuer.registry_info),
      series: issuer.series.map((s) => ({ ...s, last_number_year: year })),
    })),
    tax_rates: values.tax_rates
      .filter((t) => t.include)
      .map((t, position) => ({
        kind: t.kind,
        name: t.name,
        rate_bps: t.rate_bps,
        regime: t.regime,
        legal_note: emptyToNull(t.legal_note),
        is_default: t.is_default,
        position,
      })),
    invitations: values.invitations.map((i) => ({ ...i, full_name: emptyToNull(i.full_name) })),
  };
}
