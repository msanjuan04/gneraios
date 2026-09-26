"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { type FieldPath, FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type OnboardingInput, onboardingSchema, type OnboardingValues } from "@/lib/validation/onboarding";
import { completeOnboarding } from "./actions";
import { IssuersStep } from "./steps/issuers-step";
import { OrgStep } from "./steps/org-step";
import { ReviewStep } from "./steps/review-step";
import { TaxesStep } from "./steps/taxes-step";
import { TeamStep } from "./steps/team-step";

const STEPS = ["org", "issuers", "taxes", "team", "review"] as const;
type Step = (typeof STEPS)[number];

// Qué se valida al pulsar "Continuar" en cada paso.
const STEP_FIELDS: Record<Step, FieldPath<OnboardingInput>[]> = {
  org: ["org", "owner"],
  issuers: ["issuers"],
  taxes: ["tax_rates"],
  team: ["invitations"],
  review: [],
};

export function OnboardingWizard({
  defaults,
  appHost,
  currentYear,
  preview = false,
}: {
  defaults: OnboardingInput;
  appHost: string;
  currentYear: number;
  /** Vista previa sin base de datos: valida todo pero no guarda. */
  preview?: boolean;
}) {
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");
  const tPreview = useTranslations("preview");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const form = useForm<OnboardingInput, unknown, OnboardingValues>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: defaults,
    mode: "onTouched",
  });
  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  async function goNext() {
    if (await form.trigger(STEP_FIELDS[current], { shouldFocus: true })) setStep((s) => s + 1);
  }

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      if (preview) {
        toast.success(tPreview("onboardingDone"));
        router.push("/preview");
        return;
      }
      const result = await completeOnboarding(values);
      if (!result.ok) {
        if (result.field) {
          form.setError(result.field, { message: "slug" });
          setStep(0);
        }
        toast.error(result.error);
        return;
      }
      if (result.invites === "failed") toast.warning(t("errors.invitesNotSent"));
      router.push(`/${result.slug}`);
      router.refresh();
    }),
  );

  return (
    <FormProvider {...form}>
      <nav aria-label={t("title")} className="mb-8 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            disabled={i > step}
            onClick={() => i < step && setStep(i)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              i === step && "border-transparent bg-brand-gradient text-white",
              i < step && "text-foreground hover:bg-accent",
              i > step && "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full text-[10px]",
                i === step ? "bg-white/20" : "bg-muted",
              )}
            >
              {i < step ? <Check className="size-3" /> : i + 1}
            </span>
            {t(`steps.${s}`)}
          </button>
        ))}
      </nav>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isLast) void submit();
          else void goNext();
        }}
        noValidate
      >
        {current === "org" && <OrgStep appHost={appHost} />}
        {current === "issuers" && <IssuersStep currentYear={currentYear} />}
        {current === "taxes" && <TaxesStep />}
        {current === "team" && <TeamStep />}
        {current === "review" && <ReviewStep appHost={appHost} />}

        <footer className="mt-10 flex items-center justify-between border-t pt-6">
          <Button type="button" variant="ghost" disabled={step === 0 || pending} onClick={() => setStep((s) => s - 1)}>
            <ArrowLeft data-icon="inline-start" />
            {tCommon("back")}
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {isLast ? (pending ? t("review.submitting") : t("review.submit")) : tCommon("continue")}
            {!pending && <ArrowRight data-icon="inline-end" />}
          </Button>
        </footer>
      </form>
    </FormProvider>
  );
}
