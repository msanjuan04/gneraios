import { z } from "zod";
import { isCivilDate } from "@/app/[org]/contracts/schema";
import { SITE_THRESHOLD_LIMITS } from "@/app/[org]/settings/schema";
import { BULK_MAX_SITES, normalizeSiteUrl, parseSiteList, SITE_URL_MAX_LENGTH } from "@/domain/sites";
import { emptyToNull, text } from "@/lib/validation/fiscal";

/**
 * Formularios de Webs, compartidos por los paneles (cliente) y las acciones (servidor). La URL se
 * escribe como sea y se normaliza al guardar (src/domain/sites/url.ts). Los mensajes son claves de
 * `sites.validation.*` o de `validation.*`.
 */

const optionalId = z.union([z.literal(""), z.guid()]);
const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === "" || isCivilDate(v), "date");

export const siteFormSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "required")
    .max(SITE_URL_MAX_LENGTH, "tooLong")
    .refine((v) => normalizeSiteUrl(v) !== null, "url"),
  /** "" = se enseña la URL. */
  label: text(120),
  /** "" = sin cliente (una web propia). */
  client_id: optionalId,
  hosted_by_us: z.boolean(),
  domain_expires_on: optionalDate,
  notes: text(5000),
  is_active: z.boolean(),
});

export type SiteFormInput = z.input<typeof siteFormSchema>;
export type SiteFormValues = z.output<typeof siteFormSchema>;

export const EMPTY_SITE_FORM: SiteFormInput = {
  url: "",
  label: "",
  client_id: "",
  hosted_by_us: true,
  domain_expires_on: "",
  notes: "",
  is_active: true,
};

/** Valores ya validados → columnas de `sites` (sin org_id). */
export function siteRow(v: SiteFormValues) {
  return {
    url: normalizeSiteUrl(v.url)!,
    label: emptyToNull(v.label),
    client_id: emptyToNull(v.client_id),
    hosted_by_us: v.hosted_by_us,
    domain_expires_on: emptyToNull(v.domain_expires_on),
    notes: emptyToNull(v.notes),
    is_active: v.is_active,
  };
}

/** Alta en bloque: varias webs pegadas, una por línea. */
export const bulkSitesSchema = z.object({
  text: z
    .string()
    .max(50_000, "tooLong")
    .refine((v) => parseSiteList(v).urls.length > 0, "bulkEmpty")
    .refine((v) => parseSiteList(v).urls.length <= BULK_MAX_SITES, "bulkTooMany"),
  hosted_by_us: z.boolean(),
  /** Vincular cada web al cliente que la tiene en su ficha (si solo hay uno). */
  match_clients: z.boolean(),
  /** Un cliente para todas ("" = ninguno, o el que coincida). */
  client_id: optionalId,
});

export type BulkSitesInput = z.input<typeof bulkSitesSchema>;

const threshold = (key: keyof typeof SITE_THRESHOLD_LIMITS) =>
  z
    .number("thresholdRange")
    .int("thresholdRange")
    .min(SITE_THRESHOLD_LIMITS[key].min, "thresholdRange")
    .max(SITE_THRESHOLD_LIMITS[key].max, "thresholdRange");

/** Umbrales de la org (orgs.settings.sites). Solo los cambia un owner. */
export const siteThresholdsSchema = z.object({
  ssl_warn_days: threshold("ssl_warn_days"),
  domain_warn_days: threshold("domain_warn_days"),
  slow_ms: threshold("slow_ms"),
  down_after_failures: threshold("down_after_failures"),
});

export type SiteThresholdsInput = z.input<typeof siteThresholdsSchema>;
