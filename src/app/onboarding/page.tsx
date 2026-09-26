import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Isotype } from "@/components/brand/logo";
import { SpaceBackdrop } from "@/components/brand/space-backdrop";
import { nowInZone } from "@/lib/clock";
import { publicEnv } from "@/lib/env";
import { getMyOrgs, requireUser } from "@/server/session";
import { onboardingDefaults } from "./defaults";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  await requireUser();
  if ((await getMyOrgs()).length > 0) redirect("/");
  const t = await getTranslations("onboarding");

  return (
    <SpaceBackdrop>
      <div className="mx-auto w-full max-w-3xl px-6 py-12 md:py-16">
        <header className="mb-10">
          <Isotype size={44} priority className="mb-6" />
          <h1 className="text-4xl font-extrabold heading-tight md:text-5xl">{t("title")}</h1>
          <p className="mt-3 text-muted-foreground">{t("subtitle")}</p>
        </header>
        <OnboardingWizard
          defaults={onboardingDefaults()}
          appHost={new URL(publicEnv.NEXT_PUBLIC_APP_URL).host}
          currentYear={Number(nowInZone("Europe/Madrid").date.slice(0, 4))}
        />
      </div>
    </SpaceBackdrop>
  );
}
