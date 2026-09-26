"use server";

import { getTranslations } from "next-intl/server";
import { nowInZone } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { type OnboardingInput, onboardingSchema, toCreateOrganizationPayload } from "@/lib/validation/onboarding";
import { deliverInvitations, type InviteDelivery } from "@/server/invitations";
import { requireUser } from "@/server/session";

export type OnboardingResult =
  | { ok: true; slug: string; invites: InviteDelivery }
  | { ok: false; error: string; field?: "org.slug" };

export async function completeOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  const t = await getTranslations();
  await requireUser();

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("common.errorGeneric") };

  const year = Number(nowInZone("Europe/Madrid").date.slice(0, 4));
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p: toCreateOrganizationPayload(parsed.data, year),
  });

  if (error) {
    if (error.code === "23505" && error.message.includes("orgs_slug_key")) {
      return { ok: false, error: t("onboarding.errors.slugTaken"), field: "org.slug" };
    }
    console.error("create_organization", error);
    return { ok: false, error: t("common.errorGeneric") };
  }

  const invites = await deliverInvitations(parsed.data.invitations.map((i) => i.email));
  return { ok: true, slug: parsed.data.org.slug, invites };
}
