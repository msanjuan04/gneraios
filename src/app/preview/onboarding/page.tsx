import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { onboardingDefaults } from "@/app/onboarding/defaults";
import { OnboardingWizard } from "@/app/onboarding/onboarding-wizard";
import { Isotype } from "@/components/brand/logo";
import { SpaceBackdrop } from "@/components/brand/space-backdrop";
import { nowInZone } from "@/lib/clock";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Onboarding (vista previa)" };

/** El onboarding real sin sesión ni base de datos: al final no guarda nada. */
export default async function PreviewOnboardingPage() {
  const t = await getTranslations("onboarding");
  const tPreview = await getTranslations("preview");

  return (
    <SpaceBackdrop>
      <div className="mx-auto w-full max-w-3xl px-6 py-12 md:py-16">
        <p className="mb-8 inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {tPreview("banner")}
        </p>
        <header className="mb-10">
          <Isotype size={44} priority className="mb-6" />
          <h1 className="text-4xl font-extrabold heading-tight md:text-5xl">{t("title")}</h1>
          <p className="mt-3 text-muted-foreground">{t("subtitle")}</p>
        </header>
        <OnboardingWizard
          preview
          defaults={onboardingDefaults()}
          appHost={new URL(publicEnv.NEXT_PUBLIC_APP_URL).host}
          currentYear={Number(nowInZone("Europe/Madrid").date.slice(0, 4))}
        />
      </div>
    </SpaceBackdrop>
  );
}
