"use client";

import { Building2, Mail, Percent, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormContext, useWatch } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import type { OnboardingInput } from "@/lib/validation/onboarding";
import { StepHeading } from "../form-fields";

export function ReviewStep({ appHost }: { appHost: string }) {
  const t = useTranslations("onboarding.review");
  const tIssuers = useTranslations("onboarding.issuers");
  const tKind = useTranslations("issuerKind");
  const tRoles = useTranslations("roles");
  const { control } = useFormContext<OnboardingInput>();
  const values = useWatch({ control });
  const issuers = values.issuers ?? [];
  const taxes = (values.tax_rates ?? []).filter((r) => r?.include);
  const invitations = values.invitations ?? [];

  return (
    <div>
      <StepHeading title={t("title")} description={t("description")} />
      <div className="space-y-4">
        <div className="rounded-2xl border bg-card/70 p-5 backdrop-blur">
          <p className="text-2xl font-extrabold heading-tight">{values.org?.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {appHost}/{values.org?.slug}
          </p>
          <p className="mt-3 text-sm">
            <span className="font-semibold">{values.owner?.full_name}</span>{" "}
            <Badge variant="secondary" className="ml-1">
              {values.owner?.initials}
            </Badge>{" "}
            <Badge variant="outline">{tRoles("owner")}</Badge>
          </p>
        </div>

        <div className="rounded-2xl border bg-card/70 p-5 backdrop-blur">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold">
            <Building2 className="size-4 text-primary" />
            {t("issuersCount", { count: issuers.length })}
          </p>
          <ul className="space-y-2 text-sm">
            {issuers.map((issuer, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                {issuer?.kind === "company" ? (
                  <Building2 className="size-3.5 text-muted-foreground" />
                ) : (
                  <UserRound className="size-3.5 text-muted-foreground" />
                )}
                <span className="font-semibold">{issuer?.legal_name || "—"}</span>
                <span className="text-muted-foreground">{issuer?.kind ? tKind(issuer.kind) : ""}</span>
                {issuer?.kind === "company" && issuer.pending_constitution && (
                  <Badge variant="outline">{tIssuers("notConstituted")}</Badge>
                )}
                {issuer?.tax_id && <span className="text-muted-foreground tabular">{issuer.tax_id.toUpperCase()}</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border bg-card/70 p-5 backdrop-blur">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Percent className="size-4 text-primary" />
              {t("taxesCount", { count: taxes.length })}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{taxes.map((r) => r?.name).join(" · ")}</p>
          </div>
          <div className="rounded-2xl border bg-card/70 p-5 backdrop-blur">
            <p className="flex items-center gap-2 text-sm font-bold">
              <Mail className="size-4 text-primary" />
              {t("invitesCount", { count: invitations.length })}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{invitations.map((i) => i?.email).join(" · ")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
