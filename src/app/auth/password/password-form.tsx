"use client";

import { Check, Circle, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type PasswordProblem, passwordProblems } from "@/lib/auth-policy";
import { cn } from "@/lib/utils";
import { updatePassword } from "./actions";

const RULES: Exclude<PasswordProblem, "tooLong">[] = ["length", "lower", "upper", "digit"];

/** Contraseña nueva con sus reglas a la vista (se van marcando al escribir). */
export function PasswordForm({ next }: { next: string }) {
  const t = useTranslations("auth.password");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const problems = passwordProblems(password);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await updatePassword({ password, confirm });
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    toast.success(t("saved"));
    router.replace(next);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="mt-10 space-y-5">
      <Field>
        <FieldLabel htmlFor="new-password">{t("newLabel")}</FieldLabel>
        <div className="relative">
          <Input
            id="new-password"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-xl px-4 pr-11 text-base"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t("hide") : t("show")}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
          {RULES.map((rule) => {
            const ok = password.length > 0 && !problems.includes(rule);
            return (
              <li key={rule} className={cn("flex items-center gap-1.5", ok ? "text-success" : "text-muted-foreground")}>
                {ok ? <Check className="size-3.5" /> : <Circle className="size-3.5" />}
                {t(`rules.${rule}`)}
              </li>
            );
          })}
        </ul>
      </Field>
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="confirm-password">{t("confirmLabel")}</FieldLabel>
        <Input
          id="confirm-password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={Boolean(error)}
          className="h-11 rounded-xl px-4 text-base"
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending || problems.length > 0 || confirm.length === 0}>
        <LockKeyhole data-icon="inline-start" />
        {pending ? t("saving") : t("submit")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t("managerHint")}</p>
    </form>
  );
}
