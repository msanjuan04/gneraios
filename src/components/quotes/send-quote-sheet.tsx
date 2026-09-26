"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCheck, Mail, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { markQuoteSent, sendQuote } from "@/app/[org]/quotes/actions";
import { type QuoteEmailFormInput, quoteEmailFormSchema } from "@/app/[org]/quotes/schema";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isLocale, localeNames } from "@/i18n/config";
import { useQuoteValidationMessage } from "./format";
import type { FinalizedQuote, QuoteEmailDraft } from "./types";

type Props = {
  slug: string;
  quoteId: string;
  title: string;
  /** Aún en borrador: se numera al enviarlo (o al marcarlo como enviado sin email). */
  isDraft: boolean;
  /** Propuesta de prepareQuoteEmail; null = panel cerrado. */
  draft: QuoteEmailDraft | null;
  onClose: () => void;
  onSent: (result: FinalizedQuote) => void;
};

/** Panel para enviar el presupuesto por email: la propuesta en el idioma del cliente, editable antes de enviar. */
export function SendQuoteSheet({ slug, quoteId, title, isDraft, draft, onClose, onSent }: Props) {
  const t = useTranslations("quotes.send");
  const language = draft && isLocale(draft.language) ? localeNames[draft.language] : (draft?.language ?? "");
  return (
    <SettingsSheet
      open={draft !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("title", { title })}
      description={t("description", { language })}
    >
      {draft && <SendForm slug={slug} quoteId={quoteId} isDraft={isDraft} draft={draft} onDone={onClose} onSent={onSent} />}
    </SettingsSheet>
  );
}

function SendForm({
  slug,
  quoteId,
  isDraft,
  draft,
  onDone,
  onSent,
}: {
  slug: string;
  quoteId: string;
  isDraft: boolean;
  draft: QuoteEmailDraft;
  onDone: () => void;
  onSent: (result: FinalizedQuote) => void;
}) {
  const t = useTranslations("quotes.send");
  const tCommon = useTranslations("common");
  const message = useQuoteValidationMessage();
  const [marking, setMarking] = useState(false);
  const form = useForm<QuoteEmailFormInput>({
    resolver: zodResolver(quoteEmailFormSchema),
    defaultValues: { to: draft.to, subject: draft.subject, body: draft.body },
    mode: "onTouched",
  });
  const { register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const busy = isSubmitting || marking;

  const submit = form.handleSubmit(async () => {
    const values = getValues();
    const result = await sendQuote(slug, quoteId, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("sentToast", { number: result.number, to: values.to }));
    onSent(result);
    onDone();
  });

  const markSent = async () => {
    setMarking(true);
    const result = await markQuoteSent(slug, quoteId);
    setMarking(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("markedToast", { number: result.number }));
    onSent(result);
    onDone();
  };

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={busy} className="mr-auto">
            {tCommon("cancel")}
          </Button>
          {isDraft && (
            <Button type="button" variant="outline" onClick={markSent} disabled={busy} title={t("markSentHint")}>
              <CheckCheck data-icon="inline-start" />
              {marking ? t("marking") : t("markSent")}
            </Button>
          )}
          <Button type="submit" disabled={busy}>
            <Mail data-icon="inline-start" />
            {isSubmitting ? t("sending") : t("send")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField
          id="quote-email-to"
          label={t("to")}
          description={draft.to ? t("toHint") : <span className="text-warning">{t("noRecipients")}</span>}
          error={message(errors.to?.message)}
        >
          <Input id="quote-email-to" {...register("to")} type="text" inputMode="email" autoComplete="off" aria-invalid={Boolean(errors.to)} />
        </FormField>
        <FormField id="quote-email-subject" label={t("subject")} error={message(errors.subject?.message)}>
          <Input id="quote-email-subject" {...register("subject")} aria-invalid={Boolean(errors.subject)} />
        </FormField>
        <FormField id="quote-email-body" label={t("body")} error={message(errors.body?.message)}>
          <Textarea
            id="quote-email-body"
            {...register("body")}
            rows={14}
            aria-invalid={Boolean(errors.body)}
            className="font-mono text-[13px]"
          />
        </FormField>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3.5" />
          {draft.attachment ? t("attachment", { file: draft.attachment }) : t("attachmentDraft")}
        </p>
        {isDraft && <p className="text-xs text-muted-foreground">{t("numberHint")}</p>}
      </div>
    </SheetForm>
  );
}
