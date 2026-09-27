"use client";

import { KeyRound, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChooseCodeButton, CodeStatusLine, GenerateCodeButton, TrustedDeviceList } from "@/components/settings/access-code";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { generateMyAccessCode, revokeMyDevice, setMyAccessCode } from "@/server/auth/actions";
import type { AccessStatus } from "@/server/auth/access-code";

/**
 * Cómo entra el usuario: su código de acceso y sus dispositivos de confianza, la verificación en
 * dos pasos (opcional), la contraseña (la vía por email) y las sesiones abiertas.
 */
export function SecurityCard({ slug, name, access, backTo }: { slug: string; name: string; access: AccessStatus; backTo: string }) {
  const t = useTranslations("settings.preferences.security");
  const tCode = useTranslations("settings.accessCode");
  const [factors, setFactors] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // Los factores del usuario solo se leen con su sesión, en el navegador.
    void createClient()
      .auth.mfa.listFactors()
      .then(({ data }) => setFactors(data ? data.totp.filter((f) => f.status === "verified").length : 0));
  }, []);

  const signOutOthers = () =>
    startTransition(async () => {
      const { error } = await createClient().auth.signOut({ scope: "others" });
      if (error) toast.error(t("othersFailed"));
      else toast.success(t("othersDone"));
    });

  // Quitar otro dispositivo cierra también la sesión que tenga abierta (y la de los demás, que
  // vuelven a entrar solo con el código); quitar este no te saca.
  const revoke = async (deviceId: string) => {
    const result = await revokeMyDevice(slug, deviceId);
    if (result.ok && !access.devices.find((d) => d.id === deviceId)?.current) {
      await createClient().auth.signOut({ scope: "others" });
    }
    return result;
  };

  const next = encodeURIComponent(backTo);
  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          {t("title")}
        </span>
      }
      description={t("description")}
    >
      <ul className="divide-y">
        <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{tCode("selfTitle")}</span>
            <span className="block text-xs text-muted-foreground">
              <CodeStatusLine hasCode={access.hasCode} createdAt={access.codeCreatedAt} lastUsedAt={access.lastUsedAt} />
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <ChooseCodeButton save={(code, repeat) => setMyAccessCode(slug, code, repeat)} />
            <GenerateCodeButton hasCode={access.hasCode} self name={name} generate={() => generateMyAccessCode(slug)} />
          </span>
        </li>
        <li className="space-y-3 py-3">
          <span className="block">
            <span className="block font-medium">{tCode("devicesTitle")}</span>
            <span className="text-xs text-muted-foreground">{tCode("devicesHint")}</span>
          </span>
          <TrustedDeviceList
            devices={access.devices}
            revoke={revoke}
            revokeBody={(device) => (device.current ? tCode("revokeCurrentBody") : tCode("revokeSelfOthersBody"))}
          />
        </li>
        <li className="flex flex-wrap items-center gap-3 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("mfa")}</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {factors === null ? (
                "…"
              ) : factors > 0 ? (
                <>
                  <ShieldCheck className="size-3.5 text-success" />
                  {t("mfaOn")}
                </>
              ) : (
                <>
                  <ShieldOff className="size-3.5 text-warning" />
                  {t("mfaOff")}
                </>
              )}
            </span>
          </span>
          {factors === 0 && (
            <Button asChild size="sm">
              <Link href={`/auth/mfa?setup=1&next=${next}`}>{t("mfaEnable")}</Link>
            </Button>
          )}
        </li>
        <li className="flex flex-wrap items-center gap-3 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("password")}</span>
            <span className="text-xs text-muted-foreground">{t("passwordHint")}</span>
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href={`/auth/password?mode=change&next=${next}`}>
              <KeyRound data-icon="inline-start" />
              {t("passwordChange")}
            </Link>
          </Button>
        </li>
        <li className="flex flex-wrap items-center gap-3 py-3 last:pb-0">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("sessions")}</span>
            <span className="text-xs text-muted-foreground">{t("sessionsHint")}</span>
          </span>
          <Button variant="outline" size="sm" onClick={signOutOthers} disabled={pending}>
            <LogOut data-icon="inline-start" />
            {t("signOutOthers")}
          </Button>
        </li>
      </ul>
    </SettingsCard>
  );
}
