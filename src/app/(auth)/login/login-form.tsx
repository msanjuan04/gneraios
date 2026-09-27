"use client";

import { ArrowRight, Check, Eye, EyeOff, KeyRound, LoaderCircle, Lock, Mail, MailCheck, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useActionState, useEffect, useRef, useState } from "react";
import { WelcomeTransition } from "@/components/brand/welcome";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type LoginState, sendMagicLink, sendPasswordReset, signInWithAccessCode, signInWithPassword } from "./actions";
import { CodeSlots, type CodeSlotsStatus } from "@/components/ui/code-slots";

const CODE_LENGTH = 8;

type Props = { next?: string; linkError?: string; localMailUrl?: string; deviceConfirmation?: boolean };
type Mode = "code" | "password" | "link" | "reset";
type EmailMode = Exclude<Mode, "code">;

const EMAIL_ACTIONS = { password: signInWithPassword, link: sendMagicLink, reset: sendPasswordReset } as const;
const IDLE: LoginState = { status: "idle" };

/** Cambiar de vía (o "usar otro email") remonta el formulario para empezar con el estado limpio. */
export function LoginForm(props: Props) {
  const [mode, setMode] = useState<Mode>("code");
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const reset = () => setAttempt((n) => n + 1);
  if (mode === "code") {
    return <CodeLogin key={`code:${attempt}`} {...props} onUseEmail={() => setMode("password")} onReset={reset} />;
  }
  return (
    <EmailLogin
      key={`${mode}:${attempt}`}
      {...props}
      mode={mode}
      email={email}
      onEmail={setEmail}
      onMode={setMode}
      onReset={reset}
    />
  );
}

/** «Revisa tu correo»: enlace de acceso, restablecer contraseña o confirmar un dispositivo nuevo. */
function SentCard({ state, localMailUrl, onBack }: { state: Extract<LoginState, { status: "sent" }>; localMailUrl?: string; onBack: () => void }) {
  const t = useTranslations("auth");
  return (
    <div className="gos-rise mx-auto mt-10 w-full max-w-[27rem] rounded-3xl border bg-card/50 p-6 text-center backdrop-blur-xl sm:p-8">
      <MailCheck className="mx-auto size-8 text-primary" />
      <h2 className="mt-4 text-lg font-bold">{t("sentTitle")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t(state.kind === "reset" ? "resetSentBody" : state.kind === "device" ? "code.deviceSentBody" : "sentBody", { email: state.email })}
      </p>
      {localMailUrl && (
        <p className="mt-4 text-xs text-muted-foreground">
          {t("sentLocalHint")}{" "}
          <a className="font-semibold text-primary hover:underline" href={localMailUrl} target="_blank" rel="noreferrer">
            {localMailUrl}
          </a>
        </p>
      )}
      <Button variant="ghost" size="sm" className="mt-4" onClick={onBack}>
        {t("backToLogin")}
      </Button>
    </div>
  );
}

/**
 * La entrada de los socios: las 8 cifras en casillas. Al escribir la última se comprueba sola; si
 * es incorrecta, las casillas tiemblan y se vacían; si es la buena, se llenan de azul y la pantalla
 * se abre hacia la bienvenida.
 */
function CodeLogin({
  next,
  linkError,
  localMailUrl,
  deviceConfirmation,
  onUseEmail,
  onReset,
}: Props & { onUseEmail: () => void; onReset: () => void }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<LoginState, FormData>(signInWithAccessCode, IDLE);
  const [code, setCode] = useState("");
  // La respuesta que el socio ya ha «leído» al volver a escribir: deja de enseñarse.
  const [dismissed, setDismissed] = useState<LoginState | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxesRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  const visible = dismissed === state ? IDLE : state;
  const status: CodeSlotsStatus = pending
    ? "pending"
    : visible.status === "success"
      ? "success"
      : visible.status === "error"
        ? visible.reason === "rate_limited"
          ? "locked"
          : "error"
        : "idle";

  // Con cada respuesta se puede volver a enviar; un código incorrecto se borra al acabar la
  // sacudida, para volver a escribirlo.
  useEffect(() => {
    inFlight.current = false;
    if (state.status !== "error" || state.reason !== "invalid") return;
    const timer = window.setTimeout(() => {
      setDismissed(state);
      setCode("");
      inputRef.current?.focus();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [state]);

  const change = (value: string) => {
    if (visible.status === "error") setDismissed(state);
    setCode(value);
    // La última cifra envía el código sola (tras pintar la casilla).
    if (value.length === CODE_LENGTH && !pending) window.setTimeout(() => formRef.current?.requestSubmit(), 120);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (code.length !== CODE_LENGTH || pending || inFlight.current) {
      event.preventDefault();
      return;
    }
    inFlight.current = true;
    const box = boxesRef.current?.getBoundingClientRect();
    if (box) setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  };

  if (visible.status === "sent") {
    return <SentCard state={visible} localMailUrl={localMailUrl} onBack={onReset} />;
  }

  const message =
    status === "pending"
      ? t("code.checking")
      : status === "success"
        ? t("code.correct")
        : visible.status === "error"
          ? visible.message
          : linkError ?? t(deviceConfirmation ? "code.hint" : "code.hintDirect");
  const tone =
    status === "error" || (status === "idle" && linkError)
      ? "text-destructive"
      : status === "locked"
        ? "text-warning"
        : status === "success"
          ? "text-primary"
          : "text-muted-foreground";

  return (
    <>
      <form
        ref={formRef}
        action={action}
        onSubmit={submit}
        className="gos-rise relative mx-auto mt-10 w-full max-w-[30rem] rounded-3xl border bg-card/40 p-4 shadow-[0_40px_120px_-60px_rgb(46_128_255/0.55)] backdrop-blur-xl sm:p-6 dark:border-white/10"
        style={{ animationDelay: "180ms" }}
      >
        <input type="hidden" name="next" value={next ?? ""} />
        <label htmlFor="code" className="block text-center text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {t("code.label")}
        </label>
        <div ref={boxesRef} className="mt-5">
          {/* El diseño de CodeSlots que pidió Marc: casillas zinc, cifras y acento blancos, muelle
              (rebote 0,2 · 0,3 s), subida de 8 px y cascada de 20 ms; 8 cifras en 4 · 4. */}
          <CodeSlots
            id="code"
            name="code"
            length={CODE_LENGTH}
            groupSize={4}
            value={code}
            onChange={change}
            status={status}
            inputRef={inputRef}
            label={t("code.label")}
            describedBy="code-status"
            autoFocus
            accentColor="var(--code-accent)"
            inkColor="var(--code-ink)"
            slotColor="var(--code-slot)"
            digitColor="var(--code-digit)"
            dangerColor="var(--code-danger)"
            slotSize={44}
            gap={8}
            radius={12}
            bounce={0.2}
            settle={0.3}
            rise={8}
            cascade={20}
            mask={false}
            caret
            outcome="accept"
          />
        </div>
        <p id="code-status" aria-live="polite" className={cn("mt-4 flex min-h-5 items-center justify-center gap-1.5 text-center text-xs transition-colors", tone)}>
          {status === "locked" && <Lock className="size-3.5 shrink-0" />}
          {status === "success" && <Check className="size-3.5 shrink-0" />}
          <span key={message} className="gos-rise" style={{ animationDuration: "0.35s" }}>
            {message}
          </span>
        </p>
        <Button
          type="submit"
          size="lg"
          className="mt-6 w-full rounded-full bg-[var(--code-accent)] text-[var(--code-digit)] shadow-[0_12px_40px_-16px_color-mix(in_oklab,var(--code-accent)_60%,transparent)] transition-[transform,opacity,box-shadow] hover:bg-[var(--code-accent)] hover:opacity-90 active:scale-[0.98] disabled:opacity-35"
          disabled={pending || status === "success" || code.length < CODE_LENGTH}
        >
          {pending ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : status === "success" ? (
            <Check data-icon="inline-start" />
          ) : (
            <ShieldCheck data-icon="inline-start" />
          )}
          {pending ? t("code.checking") : status === "success" ? t("code.entering") : t("signIn")}
          {!pending && status !== "success" && <ArrowRight data-icon="inline-end" />}
        </Button>
      </form>
      <div className="gos-rise mt-6 text-center" style={{ animationDelay: "420ms" }}>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onUseEmail}>
          <Mail data-icon="inline-start" />
          {t("code.useEmail")}
        </Button>
      </div>
      {visible.status === "success" && <WelcomeTransition name={visible.name} next={visible.next} origin={origin} />}
    </>
  );
}

/** Entrada con email: contraseña, enlace de acceso o «he olvidado la contraseña». */
function EmailLogin({
  next,
  linkError,
  localMailUrl,
  mode,
  email,
  onEmail,
  onMode,
  onReset,
}: Props & { mode: EmailMode; email: string; onEmail: (email: string) => void; onMode: (mode: Mode) => void; onReset: () => void }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<LoginState, FormData>(EMAIL_ACTIONS[mode], IDLE);
  const [visible, setVisible] = useState(false);

  if (state.status === "sent") {
    return (
      <SentCard
        state={state}
        localMailUrl={localMailUrl}
        onBack={() => {
          onMode("password");
          onReset();
        }}
      />
    );
  }

  const error = state.status === "error" ? state.message : linkError;

  return (
    <form action={action} className="gos-rise mx-auto mt-10 w-full max-w-[27rem] space-y-4 rounded-3xl border bg-card/40 p-6 backdrop-blur-xl sm:p-8 dark:border-white/10">
      <input type="hidden" name="next" value={next ?? ""} />
      {mode !== "password" && <p className="text-center text-sm text-muted-foreground">{t(mode === "reset" ? "resetIntro" : "linkIntro")}</p>}
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="email">{t("emailLabel")}</FieldLabel>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          defaultValue={email}
          onChange={(e) => onEmail(e.target.value)}
          placeholder={t("emailPlaceholder")}
          aria-invalid={Boolean(error)}
          className="h-11 rounded-xl px-4 text-base"
        />
        {mode !== "password" && error && <FieldError>{error}</FieldError>}
      </Field>

      {mode === "password" && (
        <Field data-invalid={Boolean(error)}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">{t("passwordLabel")}</FieldLabel>
            <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onMode("reset")}>
              {t("forgot")}
            </button>
          </div>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-invalid={Boolean(error)}
              className="h-11 rounded-xl px-4 pr-11 text-base"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? t("hidePassword") : t("showPassword")}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </Field>
      )}

      <Button type="submit" size="lg" className="w-full rounded-full" disabled={pending}>
        {mode === "password" ? <KeyRound data-icon="inline-start" /> : <Mail data-icon="inline-start" />}
        {pending ? t("sending") : t(mode === "password" ? "signIn" : mode === "reset" ? "sendReset" : "submit")}
        {!pending && <ArrowRight data-icon="inline-end" />}
      </Button>

      <div className="flex flex-wrap justify-center gap-1">
        {mode === "password" ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onMode("link")}>
            {t("useLink")}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={() => onMode("password")}>
            {t("usePassword")}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => onMode("code")}>
          <ShieldCheck data-icon="inline-start" />
          {t("code.useCode")}
        </Button>
      </div>
    </form>
  );
}
