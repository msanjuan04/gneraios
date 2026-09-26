"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Mail, Paperclip } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { sendInvoiceByEmail } from "@/app/[org]/invoices/actions";
import { type EmailFormInput, emailFormSchema } from "@/app/[org]/invoices/schema";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { localeNames, isLocale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { useInvoiceFormat, useInvoiceValidationMessage } from "./format";
import type { EmailItem, EmailStatus } from "./types";

export type EmailDraft = EmailFormInput & { language: string };

/** Panel para enviar la factura por email: la propuesta en el idioma del cliente, editable antes de enviar. */
export function EmailSheet({
  slug,
  invoiceId,
  number,
  draft,
  onClose,
}: {
  slug: string;
  invoiceId: string;
  number: string;
  /** Propuesta de composeInvoiceEmail; null = panel cerrado. */
  draft: EmailDraft | null;
  onClose: () => void;
}) {
  const t = useTranslations("invoices.email");
  const language = draft && isLocale(draft.language) ? localeNames[draft.language] : (draft?.language ?? "");
  return (
    <SettingsSheet
      open={draft !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("title", { number })}
      description={t("description", { language })}
    >
      {draft && <EmailForm slug={slug} invoiceId={invoiceId} number={number} draft={draft} onDone={onClose} />}
    </SettingsSheet>
  );
}

function EmailForm({
  slug,
  invoiceId,
  number,
  draft,
  onDone,
}: {
  slug: string;
  invoiceId: string;
  number: string;
  draft: EmailDraft;
  onDone: () => void;
}) {
  const t = useTranslations("invoices.email");
  const tCommon = useTranslations("common");
  const message = useInvoiceValidationMessage();
  const form = useForm<EmailFormInput>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { to: draft.to, subject: draft.subject, body: draft.body },
    mode: "onTouched",
  });
  const { register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async () => {
    const values = getValues();
    const result = await sendInvoiceByEmail(slug, invoiceId, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("sentToast", { to: values.to }));
    onDone();
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            <Mail data-icon="inline-start" />
            {isSubmitting ? t("sending") : t("send")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField
          id="email-to"
          label={t("to")}
          description={draft.to ? t("toHint") : <span className="text-warning">{t("noRecipients")}</span>}
          error={message(errors.to?.message)}
        >
          <Input id="email-to" {...register("to")} type="text" inputMode="email" autoComplete="off" aria-invalid={Boolean(errors.to)} />
        </FormField>
        <FormField id="email-subject" label={t("subject")} error={message(errors.subject?.message)}>
          <Input id="email-subject" {...register("subject")} aria-invalid={Boolean(errors.subject)} />
        </FormField>
        <FormField id="email-body" label={t("body")} error={message(errors.body?.message)}>
          <Textarea id="email-body" {...register("body")} rows={14} aria-invalid={Boolean(errors.body)} className="font-mono text-[13px]" />
        </FormField>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3.5" />
          {t("attachment", { file: `${number}.pdf` })}
        </p>
      </div>
    </SheetForm>
  );
}

const STATUS_STYLES: Record<EmailStatus, string> = {
  pending_approval: "bg-warning/15 text-warning",
  sent: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function EmailStatusBadge({ status, className }: { status: EmailStatus; className?: string }) {
  const t = useTranslations("billing.emailStatus");
  return <Badge className={cn(STATUS_STYLES[status], className)}>{t(status)}</Badge>;
}

/** Emails de la factura: enviados, fallidos y recordatorios por aprobar (estos se revisan en «Por enviar»). */
export function EmailsCard({ basePath, emails, timeZone }: { basePath: string; emails: EmailItem[]; timeZone: string }) {
  const t = useTranslations("invoices.email");
  const { instant } = useInvoiceFormat();
  return (
    <SettingsCard title={t("historyTitle")} bodyClassName={emails.length > 0 ? "p-0" : undefined}>
      {emails.length === 0 ? (
        <p className="text-center text-muted-foreground">{t("historyEmpty")}</p>
      ) : (
        <ul className="divide-y">
          {emails.map((email) => (
            <li key={email.id} className="flex items-start gap-3 px-5 py-2.5">
              <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-semibold">{t(`template.${email.template}`)}</p>
                  <EmailStatusBadge status={email.status} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{email.subject}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {email.to.length > 0 ? email.to.join(", ") : t("noTo")} ·{" "}
                  <span className="tabular">{instant(email.sentAt ?? email.createdAt, timeZone)}</span>
                </p>
                {email.status === "failed" && email.error && <p className="mt-0.5 text-xs text-destructive">{email.error}</p>}
              </div>
              {email.status === "pending_approval" && (
                <Button asChild variant="outline" size="xs">
                  <Link href={`${basePath}/invoices/outbox`}>{t("review")}</Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
