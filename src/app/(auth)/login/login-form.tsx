"use client";

import { ArrowRight, MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type LoginState, sendMagicLink } from "./actions";

type Props = { next?: string; linkError?: string; localMailUrl?: string };

/** "Usar otro email" remonta el formulario para empezar con el estado limpio. */
export function LoginForm(props: Props) {
  const [attempt, setAttempt] = useState(0);
  return <LoginFormAttempt key={attempt} {...props} onReset={() => setAttempt((n) => n + 1)} />;
}

function LoginFormAttempt({ next, linkError, localMailUrl, onReset }: Props & { onReset: () => void }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <div className="mt-10 rounded-2xl border bg-card/60 p-6 text-center backdrop-blur">
        <MailCheck className="mx-auto size-8 text-primary" />
        <h2 className="mt-4 text-lg font-bold">{t("sentTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("sentBody", { email: state.email })}</p>
        {localMailUrl && (
          <p className="mt-4 text-xs text-muted-foreground">
            {t("sentLocalHint")}{" "}
            <a className="font-semibold text-primary hover:underline" href={localMailUrl} target="_blank" rel="noreferrer">
              {localMailUrl}
            </a>
          </p>
        )}
        <Button variant="ghost" size="sm" className="mt-4" onClick={onReset}>
          {t("useAnother")}
        </Button>
      </div>
    );
  }

  const error = state.status === "error" ? state.message : linkError;

  return (
    <form action={action} className="mt-10 space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="email">{t("emailLabel")}</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder={t("emailPlaceholder")}
          aria-invalid={Boolean(error)}
          className="h-11 rounded-xl px-4 text-base"
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t("sending") : t("submit")}
        {!pending && <ArrowRight data-icon="inline-end" />}
      </Button>
    </form>
  );
}
