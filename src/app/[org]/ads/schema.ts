import { z } from "zod";
import { ADS_PROVIDERS } from "@/domain/ads/types";
import { requiredText, text } from "@/lib/validation/fiscal";

// Alta de una cuenta publicitaria (supabase/migrations/20261002200000_ads_cuentas.sql). Sin React ni
// Supabase: lo usan la acción y el panel. La credencial viaja una vez al servidor y se guarda cifrada.

const optionalId = z.union([z.literal(""), z.guid()]);

export const addAdsAccountSchema = z
  .object({
    provider: z.enum(ADS_PROVIDERS),
    label: requiredText(80),
    /** "" = cuenta de la propia agencia. */
    owner_client_id: optionalId.default(""),
    external_account_id: text(120),
    credential: z.string().trim().max(4000).default(""),
    developer_token: z.string().trim().max(200).default(""),
    login_customer_id: z.string().trim().max(20).default(""),
  })
  .superRefine((values, ctx) => {
    const need = (path: string) => ctx.addIssue({ code: "custom", path: [path], message: "required" });
    if (values.provider === "google") {
      if (!values.developer_token) need("developer_token");
      if (!values.external_account_id) need("external_account_id");
      if (values.login_customer_id && values.login_customer_id.replace(/\D/g, "").length !== 10) ctx.addIssue({ code: "custom", path: ["login_customer_id"], message: "invalid" });
    } else {
      if (!values.credential) need("credential");
      if (values.provider !== "openai" && !values.external_account_id) need("external_account_id");
    }
  });

export type AddAdsAccountInput = z.input<typeof addAdsAccountSchema>;
export type AddAdsAccountValues = z.output<typeof addAdsAccountSchema>;

/** Vincular una campaña a un cliente (y, si se marca, publicarla en su portal). */
export const campaignLinkSchema = z.object({
  account_id: z.guid(),
  campaign_id: z.string().trim().min(1).max(120),
  client_id: optionalId.default(""),
  visible: z.boolean().default(false),
});
export type CampaignLinkInput = z.input<typeof campaignLinkSchema>;
