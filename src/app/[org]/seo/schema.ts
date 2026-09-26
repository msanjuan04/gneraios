import { z } from "zod";
import { requiredText } from "@/lib/validation/fiscal";

/**
 * Formulario de una propiedad de SEO, compartido por el panel (cliente) y la acción (servidor).
 * Los mensajes son claves de `seo.validation.*` o, si no están ahí, de `validation.*`.
 */

/** Lo que admite `seo_properties.gsc_site_url`: prefijo de URL o propiedad de dominio. */
const GSC_SITE = /^(sc-domain:[^\s/]+|https?:\/\/\S+)$/;
const GA4_ID = /^\d{1,20}$/;
const optionalId = z.union([z.literal(""), z.guid()]);

/** "properties/123456789" o "123456789" → "123456789". */
export function normalizeGa4Id(value: string): string {
  return value.trim().replace(/^properties\//, "");
}

export const propertyFormSchema = z
  .object({
    label: requiredText(120),
    owner: z.enum(["own", "client"]),
    client_id: optionalId,
    gsc_site_url: z.string().trim().max(2048, "tooLong"),
    ga4_property_id: z.string().trim().max(40, "tooLong"),
    is_primary: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if (values.owner === "client" && values.client_id === "") {
      ctx.addIssue({ code: "custom", path: ["client_id"], message: "clientRequired" });
    }
    if (values.gsc_site_url !== "" && !GSC_SITE.test(values.gsc_site_url)) {
      ctx.addIssue({ code: "custom", path: ["gsc_site_url"], message: "gscSite" });
    }
    if (values.ga4_property_id !== "" && !GA4_ID.test(normalizeGa4Id(values.ga4_property_id))) {
      ctx.addIssue({ code: "custom", path: ["ga4_property_id"], message: "ga4Property" });
    }
    if (values.gsc_site_url === "" && values.ga4_property_id === "") {
      ctx.addIssue({ code: "custom", path: ["gsc_site_url"], message: "sourceRequired" });
    }
  });

export type PropertyFormInput = z.input<typeof propertyFormSchema>;
export type PropertyFormValues = z.output<typeof propertyFormSchema>;

export const EMPTY_PROPERTY_FORM: PropertyFormInput = {
  label: "",
  owner: "own",
  client_id: "",
  gsc_site_url: "",
  ga4_property_id: "",
  is_primary: false,
};

/** Las fuentes de adquisición que cuentan como SEO (null vuelve a la sugerencia por nombre). */
export const seoSourcesSchema = z.array(z.guid()).max(50).nullable();
