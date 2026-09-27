"use client";

import { Eye, Mail, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ToggleField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { sendMyDigestNow, setWeeklyDigest } from "@/server/digest/actions";

/** El resumen de los lunes: activarlo, verlo y mandárselo a uno mismo ahora. */
export function DigestSettings({ slug, enabled }: { slug: string; enabled: boolean }) {
  const t = useTranslations("settings.preferences.digest");
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setOn(next);
      const result = await setWeeklyDigest(slug, next);
      if (!result.ok) {
        setOn(!next);
        toast.error(result.error);
        return;
      }
      toast.success(next ? t("enabled") : t("disabled"));
    });

  const sendNow = () =>
    startTransition(async () => {
      const result = await sendMyDigestNow(slug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.pushes > 0 ? t("sentWithPush", { count: result.pushes }) : t("sent"));
    });

  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          <Mail className="size-4 text-primary" />
          {t("title")}
        </span>
      }
      description={t("description")}
      footer={
        <>
          <Button variant="ghost" size="sm" asChild>
            <a href={`/api/digest/preview?org=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">
              <Eye data-icon="inline-start" />
              {t("preview")}
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={sendNow} disabled={pending}>
            <Send data-icon="inline-start" />
            {t("sendNow")}
          </Button>
        </>
      }
    >
      <ToggleField id="weekly-digest" label={t("toggle")} description={t("toggleHint")} checked={on} disabled={pending} onCheckedChange={toggle} />
    </SettingsCard>
  );
}
