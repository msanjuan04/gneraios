"use client";

import { CircleCheck, LoaderCircle, Send } from "lucide-react";
import { useActionState, useState } from "react";
import type { PortalLocale } from "@/domain/portal";
import { cn } from "@/lib/utils";
import { type RequestFormState, sendRequestAction } from "@/server/portal/public-actions";
import { pillClass } from "./pill";

export type RequestFormCopy = {
  subject: string;
  subjectPlaceholder: string;
  description: string;
  descriptionPlaceholder: string;
  urgent: string;
  submit: string;
  submitting: string;
  sentTitle: string;
  sentText: string;
  another: string;
};

const inputClass =
  "w-full rounded-xl border border-input bg-background px-3.5 text-[15px] outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20";

/** «Pedir algo»: asunto, detalles y si es urgente. Funciona también sin JavaScript. */
export function RequestForm({ token, locale, copy }: { token: string; locale: PortalLocale; copy: RequestFormCopy }) {
  const [state, action, pending] = useActionState<RequestFormState, FormData>(sendRequestAction, { status: "idle" });
  // Tras enviar se ve la confirmación; «Enviar otra» vuelve a un formulario limpio.
  const [dismissed, setDismissed] = useState<RequestFormState | null>(null);
  const showSent = state.status === "sent" && dismissed !== state;
  const failed = state.status === "error" ? state : null;

  if (showSent) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-success/30 bg-success/10 px-6 py-10 text-center">
        <CircleCheck className="size-9 text-success" aria-hidden />
        <p className="text-xl font-extrabold heading-tight">{copy.sentTitle}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{copy.sentText}</p>
        <button type="button" onClick={() => setDismissed(state)} className={cn(pillClass("secondary"), "mt-2")}>
          {copy.another}
        </button>
      </div>
    );
  }

  return (
    <form action={action} key={dismissed ? "again" : "first"} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      {failed?.message && (
        <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {failed.message}
        </p>
      )}
      <div>
        <label htmlFor="request-subject" className="mb-1.5 block text-sm font-semibold">
          {copy.subject}
        </label>
        <input
          id="request-subject"
          name="subject"
          required
          maxLength={200}
          placeholder={copy.subjectPlaceholder}
          defaultValue={failed?.values.subject}
          aria-invalid={Boolean(failed?.fields.subject)}
          aria-describedby={failed?.fields.subject ? "request-subject-error" : undefined}
          className={cn(inputClass, "h-11")}
        />
        {failed?.fields.subject && (
          <p id="request-subject-error" className="mt-1.5 text-sm font-medium text-destructive">
            {failed.fields.subject}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="request-description" className="mb-1.5 block text-sm font-semibold">
          {copy.description}
        </label>
        <textarea
          id="request-description"
          name="description"
          required
          rows={5}
          maxLength={5000}
          placeholder={copy.descriptionPlaceholder}
          defaultValue={failed?.values.description}
          aria-invalid={Boolean(failed?.fields.description)}
          aria-describedby={failed?.fields.description ? "request-description-error" : undefined}
          className={cn(inputClass, "py-3")}
        />
        {failed?.fields.description && (
          <p id="request-description-error" className="mt-1.5 text-sm font-medium text-destructive">
            {failed.fields.description}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold">
          <input type="checkbox" name="urgent" value="yes" defaultChecked={failed?.values.urgent} className="size-4 accent-[var(--primary)]" />
          {copy.urgent}
        </label>
        <button type="submit" disabled={pending} className={pillClass("primary")}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          {pending ? copy.submitting : copy.submit}
        </button>
      </div>
    </form>
  );
}
