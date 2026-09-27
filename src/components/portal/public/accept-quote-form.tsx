"use client";

import { CircleCheck, LoaderCircle, PenLine } from "lucide-react";
import { useActionState, useState } from "react";
import type { PortalLocale } from "@/domain/portal";
import { cn } from "@/lib/utils";
import {
  type AcceptFormState,
  acceptQuoteAction,
  type RejectFormState,
  rejectQuoteAction,
} from "@/server/portal/public-actions";
import { pillClass } from "./pill";

export type AcceptFormCopy = {
  title: string;
  intro: string;
  name: string;
  email: string;
  signature: string;
  signatureHint: string;
  consent: string;
  submit: string;
  submitting: string;
  evidence: string;
  firstPayment: string | null;
  reject: { open: string; title: string; reason: string; reasonPlaceholder: string; submit: string; submitting: string };
};

const inputClass =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-[15px] outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-sm font-medium text-destructive">
      {message}
    </p>
  );
}

/**
 * Aceptar (o rechazar) online. Es la única parte con JavaScript de la página, y funciona también
 * sin él: los formularios llevan acciones de servidor. El token, el presupuesto y la versión que
 * ve el cliente viajan en campos ocultos; el servidor lo vuelve a comprobar todo.
 */
export function AcceptQuoteForm({
  token,
  quoteId,
  version,
  locale,
  copy,
}: {
  token: string;
  quoteId: string;
  version: string;
  locale: PortalLocale;
  copy: AcceptFormCopy;
}) {
  const [state, acceptAction, accepting] = useActionState<AcceptFormState, FormData>(acceptQuoteAction, { status: "idle" });
  const [rejectState, rejectAction, rejecting] = useActionState<RejectFormState, FormData>(rejectQuoteAction, { status: "idle" });
  const failed = state.status === "error" ? state : null;
  const [signature, setSignature] = useState(failed?.values.signature ?? "");
  const hidden = (
    <>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );

  return (
    <section id="accept" aria-labelledby="accept-title" className="relative overflow-hidden rounded-3xl border bg-card p-5 sm:p-8">
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
      <h2 id="accept-title" className="flex items-center gap-2.5 text-2xl font-extrabold heading-tight">
        <PenLine className="size-6 text-primary" aria-hidden />
        {copy.title}
      </h2>
      <p className="mt-1 text-muted-foreground">{copy.intro}</p>
      {copy.firstPayment && <p className="mt-3 rounded-2xl bg-muted/70 px-4 py-3 text-sm">{copy.firstPayment}</p>}

      <form action={acceptAction} className="mt-6 space-y-5">
        {hidden}
        <input type="hidden" name="version" value={version} />
        {failed?.message && (
          <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {failed.message}
          </p>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="accept-name" className="mb-1.5 block text-sm font-semibold">
              {copy.name}
            </label>
            <input
              id="accept-name"
              name="name"
              required
              maxLength={120}
              autoComplete="name"
              defaultValue={failed?.values.name}
              aria-invalid={Boolean(failed?.fields.name)}
              aria-describedby={failed?.fields.name ? "accept-name-error" : undefined}
              className={inputClass}
            />
            <FieldError id="accept-name-error" message={failed?.fields.name} />
          </div>
          <div>
            <label htmlFor="accept-email" className="mb-1.5 block text-sm font-semibold">
              {copy.email}
            </label>
            <input
              id="accept-email"
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              defaultValue={failed?.values.email}
              aria-invalid={Boolean(failed?.fields.email)}
              aria-describedby={failed?.fields.email ? "accept-email-error" : undefined}
              className={inputClass}
            />
            <FieldError id="accept-email-error" message={failed?.fields.email} />
          </div>
        </div>

        <div>
          <label htmlFor="accept-signature" className="mb-1.5 block text-sm font-semibold">
            {copy.signature}
          </label>
          <input
            id="accept-signature"
            name="signature"
            maxLength={120}
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
            aria-describedby="accept-signature-hint"
            aria-invalid={Boolean(failed?.fields.signature)}
            className={inputClass}
          />
          <p id="accept-signature-hint" className="mt-1.5 text-xs text-muted-foreground">
            {copy.signatureHint}
          </p>
          <FieldError id="accept-signature-error" message={failed?.fields.signature} />
          {signature.trim() && (
            <p aria-hidden className="portal-signature mt-3 border-b border-dashed border-border pb-1 text-3xl text-foreground">
              {signature}
            </p>
          )}
        </div>

        <div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-muted/40 p-4">
            <input
              type="checkbox"
              name="consent"
              value="yes"
              required
              aria-invalid={Boolean(failed?.fields.consent)}
              aria-describedby={failed?.fields.consent ? "accept-consent-error" : undefined}
              className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
            />
            <span className="text-[15px] font-medium">{copy.consent}</span>
          </label>
          <FieldError id="accept-consent-error" message={failed?.fields.consent} />
        </div>

        <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-xs text-muted-foreground">{copy.evidence}</p>
          <button type="submit" disabled={accepting || rejecting} className={pillClass("primary", "lg")}>
            {accepting ? <LoaderCircle className="animate-spin" aria-hidden /> : <CircleCheck aria-hidden />}
            {accepting ? copy.submitting : copy.submit}
          </button>
        </div>
      </form>

      <details className="group mt-6 border-t pt-4" open={rejectState.status === "error"}>
        <summary className="cursor-pointer list-none text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          {copy.reject.open}
        </summary>
        <form action={rejectAction} className="mt-4 space-y-3">
          {hidden}
          <h3 className="font-bold">{copy.reject.title}</h3>
          {rejectState.status === "error" && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {rejectState.message}
            </p>
          )}
          <label htmlFor="reject-reason" className="block text-sm font-semibold">
            {copy.reject.reason}
          </label>
          <textarea
            id="reject-reason"
            name="reason"
            rows={3}
            maxLength={500}
            defaultValue={rejectState.status === "error" ? rejectState.reason : undefined}
            placeholder={copy.reject.reasonPlaceholder}
            className={cn(inputClass, "h-auto py-3")}
          />
          <button type="submit" disabled={accepting || rejecting} className={pillClass("secondary")}>
            {rejecting && <LoaderCircle className="animate-spin" aria-hidden />}
            {rejecting ? copy.reject.submitting : copy.reject.submit}
          </button>
        </form>
      </details>
    </section>
  );
}
