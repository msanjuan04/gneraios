"use client";

import { Copy, KeyRound, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

// Segundo paso de la entrada (TOTP): la primera vez se da de alta la app de códigos (QR o clave) y,
// a partir de ahí, se pide su código de 6 cifras en cada sesión nueva. Todo pasa por Supabase Auth
// desde el navegador: la sesión sube a aal2 y las cookies se renuevan con ella.

type Enrollment = { factorId: string; qr: string; secret: string };
type Mode = { kind: "loading" } | { kind: "challenge"; factorId: string } | { kind: "enroll"; enrollment: Enrollment } | { kind: "error" };

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iphone|ipad/i.test(ua)) return "iPhone";
  if (/android/i.test(ua)) return "Android";
  if (/mac/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "Dispositivo";
}

export function MfaForm({ next, email }: { next: string; email: string }) {
  const t = useTranslations("auth.mfa");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setMode({ kind: "error" });
      return;
    }
    const verified = data.totp.find((f) => f.status === "verified");
    if (verified) {
      setMode({ kind: "challenge", factorId: verified.id });
      return;
    }
    // Altas a medias de otras veces: fuera, para no acumularlas (Supabase admite un número limitado).
    for (const factor of data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer: "GNERAI OS",
      // Único: Supabase no admite dos factores con el mismo nombre.
      friendlyName: `${deviceName()} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${crypto.randomUUID().slice(0, 4)}`,
    });
    if (enrollError || !enrolled) {
      setMode({ kind: "error" });
      return;
    }
    setMode({ kind: "enroll", enrollment: { factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret } });
  }, []);

  // Una sola vez por pantalla: en desarrollo React monta dos veces y dos altas a la vez chocan.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Lo que tiene configurado el usuario solo se sabe en el navegador, con su sesión.
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode.kind !== "challenge" && mode.kind !== "enroll") return;
    const factorId = mode.kind === "challenge" ? mode.factorId : mode.enrollment.factorId;
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) {
      setError(t("errorLength"));
      return;
    }
    setPending(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: clean });
    if (verifyError) {
      setPending(false);
      setCode("");
      setError(verifyError.status === 429 ? t("errorRateLimit") : t("errorCode"));
      return;
    }
    if (mode.kind === "enroll") toast.success(t("enrolled"));
    router.replace(next);
    router.refresh();
  };

  if (mode.kind === "loading") {
    return <p className="mt-10 text-center text-sm text-muted-foreground">{t("loading")}</p>;
  }
  if (mode.kind === "error") {
    return (
      <div className="mt-10 space-y-4 text-center">
        <p className="text-sm text-destructive">{t("errorLoad")}</p>
        <Button variant="secondary" onClick={() => void load()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-10 space-y-6">
      {mode.kind === "enroll" ? (
        <div className="space-y-4 rounded-2xl border bg-card/60 p-5 backdrop-blur">
          <p className="flex items-center gap-2 font-semibold">
            <Smartphone className="size-4 text-primary" />
            {t("enrollTitle")}
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("enrollStep1")}</li>
            <li>{t("enrollStep2")}</li>
            <li>{t("enrollStep3")}</li>
          </ol>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- el QR es un SVG en data URL que da Supabase */}
            <img src={mode.enrollment.qr} alt={t("qrAlt")} width={168} height={168} className="rounded-xl bg-white p-2" />
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <p className="text-muted-foreground">{t("secretHint")}</p>
              <code className="block break-all rounded-lg bg-muted px-2 py-1.5 font-mono text-xs">{mode.enrollment.secret}</code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(mode.enrollment.secret);
                  toast.success(t("secretCopied"));
                }}
              >
                <Copy data-icon="inline-start" />
                {t("copySecret")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-success" />
          {t("challengeHint", { email })}
        </p>
      )}

      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="mfa-code">{t("codeLabel")}</FieldLabel>
        <Input
          id="mfa-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          placeholder="123 456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          aria-invalid={Boolean(error)}
          className="h-12 rounded-xl text-center font-mono text-xl tracking-[0.4em]"
        />
        {error ? <FieldError>{error}</FieldError> : <FieldDescription>{t("codeHint")}</FieldDescription>}
      </Field>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        <KeyRound data-icon="inline-start" />
        {pending ? t("verifying") : mode.kind === "enroll" ? t("activate") : t("verify")}
      </Button>

      <div className="text-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const form = document.createElement("form");
            form.method = "post";
            form.action = "/auth/signout";
            document.body.appendChild(form);
            form.submit();
          }}
        >
          <LogOut data-icon="inline-start" />
          {t("signOut")}
        </Button>
      </div>
      {mode.kind === "challenge" && <p className="text-center text-xs text-muted-foreground">{t("lostDevice")}</p>}
    </form>
  );
}
