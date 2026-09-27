"use client";

import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { ToggleField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resetMemberMfa, setRequireMfa } from "./actions";

/** Si el miembro tiene la verificación en dos pasos (lo ven los owners). */
export function MfaBadge({ enabled }: { enabled: boolean }) {
  const t = useTranslations("settings.team.security");
  return enabled ? (
    <Badge className="gap-1 bg-success/15 text-success">
      <ShieldCheck className="size-3" />
      {t("on")}
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1 text-muted-foreground">
      <ShieldOff className="size-3" />
      {t("off")}
    </Badge>
  );
}

/** Restablecer la verificación de un miembro (ha perdido el móvil): borra sus factores y cierra sus sesiones. */
export function MfaResetButton({ slug, memberId, name }: { slug: string; memberId: string; name: string }) {
  const t = useTranslations("settings.team.security");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const apply = () =>
    startTransition(async () => {
      const result = await resetMemberMfa(slug, memberId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("resetDone", { name }));
      setConfirming(false);
    });
  return (
    <>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirming(true)}>
        <KeyRound data-icon="inline-start" />
        {t("reset")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("resetTitle", { name })}
        description={t("resetBody")}
        confirmLabel={t("reset")}
        onConfirm={apply}
        pending={pending}
      />
    </>
  );
}

/** Exigir la verificación en dos pasos a todos, también en la base de datos. */
export function RequireMfaCard({
  slug,
  required,
  enrolled,
  total,
  canEdit,
}: {
  slug: string;
  required: boolean;
  enrolled: number;
  total: number;
  canEdit: boolean;
}) {
  const t = useTranslations("settings.team.security");
  const [on, setOn] = useState(required);
  const [pending, startTransition] = useTransition();
  const toggle = (next: boolean) =>
    startTransition(async () => {
      const result = await setRequireMfa(slug, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOn(next);
      toast.success(next ? t("requiredOn") : t("requiredOff"));
    });
  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          {t("title")}
        </span>
      }
      description={t("description", { enrolled, total })}
    >
      <ToggleField
        id="require-mfa"
        label={t("require")}
        description={t("requireHint")}
        checked={on}
        disabled={!canEdit || pending || (!on && enrolled < total)}
        onCheckedChange={toggle}
      />
      {!on && enrolled < total && <p className="mt-2 text-xs text-muted-foreground">{t("requireBlocked")}</p>}
    </SettingsCard>
  );
}
