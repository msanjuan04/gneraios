"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BellRing, ChevronDown, ChevronUp, Inbox, Mail, RotateCcw, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { discardOutboxEmail, sendOutboxEmail } from "@/app/[org]/invoices/actions";
import { type EmailFormInput, emailFormSchema } from "@/app/[org]/invoices/schema";
import { PageHeader } from "@/components/page-header";
import { FormField } from "@/components/settings/form-field";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { localeNames, isLocale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { EmailStatusBadge } from "./email-sheet";
import { useInvoiceFormat, useInvoiceValidationMessage } from "./format";
import { InlineConfirm } from "./inline-confirm";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { InvoicesNav } from "./invoices-nav";
import type { OutboxItem } from "./types";

type Props = {
  basePath: string;
  slug: string;
  tab: "pending" | "sent";
  items: OutboxItem[];
  pendingCount: number;
  /** Días de vencida a los que el cron prepara un recordatorio (orgs.settings), ya formateados. */
  dunningDays: string;
  timeZone: string;
  canEdit: boolean;
};

/**
 * «Por enviar»: los recordatorios de cobro que prepara el cron, a la espera de que un socio los
 * revise y los envíe (o los descarte). Nada sale solo. En «Enviados», el historial.
 */
export function OutboxList({ basePath, slug, tab, items, pendingCount, dunningDays, timeZone, canEdit }: Props) {
  const t = useTranslations("invoices.outbox");
  const tabs = [
    { key: "pending" as const, href: `${basePath}/invoices/outbox`, label: t("tabs.pending"), count: pendingCount },
    { key: "sent" as const, href: `${basePath}/invoices/outbox?tab=sent`, label: t("tabs.sent"), count: 0 },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("description", { days: dunningDays })} />
      <InvoicesNav basePath={basePath} outboxCount={pendingCount} />
      {!canEdit && <ReadOnlyNotice className="-mt-2 mb-6">{t("readOnly")}</ReadOnlyNotice>}

      <nav aria-label={t("tabs.label")} className="mb-4 flex w-fit gap-1 rounded-full border bg-card/60 p-1">
        {tabs.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            scroll={false}
            aria-current={item.key === tab ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8rem] font-semibold transition-colors",
              item.key === tab ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.count > 0 && <span className="text-muted-foreground tabular">{item.count}</span>}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
          <Inbox className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 font-semibold">{tab === "pending" ? t("empty") : t("emptySent")}</p>
          {tab === "pending" && <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint", { days: dunningDays })}</p>}
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <OutboxCard key={item.id} basePath={basePath} slug={slug} item={item} timeZone={timeZone} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OutboxCard({
  basePath,
  slug,
  item,
  timeZone,
  canEdit,
}: {
  basePath: string;
  slug: string;
  item: OutboxItem;
  timeZone: string;
  canEdit: boolean;
}) {
  const t = useTranslations("invoices.outbox");
  const tTemplate = useTranslations("invoices.email.template");
  const { money, instant } = useInvoiceFormat();
  const pending = item.status === "pending_approval";
  const retryable = item.status === "failed";
  const [open, setOpen] = useState(false);
  const invoice = item.invoice;
  const language = isLocale(item.language) ? localeNames[item.language] : item.language;
  // Si mientras tanto se ha cobrado, lo más probable es que sobre el recordatorio.
  const settled = pending && invoice !== null && invoice.status !== "overdue";

  return (
    <li className={cn("rounded-2xl border bg-card text-sm", settled && "border-warning/40")}>
      <div className="flex flex-wrap items-start gap-3 px-5 py-4">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/50 text-muted-foreground">
          {item.template === "payment_reminder" ? <BellRing className="size-4" /> : <Mail className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {invoice ? (
              <Link href={`${basePath}/invoices/${invoice.id}`} className="font-mono font-semibold hover:text-primary">
                {invoice.number ?? "—"}
              </Link>
            ) : (
              <span className="text-muted-foreground">{t("noInvoice")}</span>
            )}
            {invoice && (
              <Link href={`${basePath}/clients/${invoice.clientId}`} className="font-medium text-muted-foreground hover:text-foreground">
                {invoice.clientName}
              </Link>
            )}
            <span className="text-xs text-muted-foreground">
              · {tTemplate(item.template)} · {language}
            </span>
            {!pending && <EmailStatusBadge status={item.status} />}
          </div>
          <p className="mt-1 truncate font-medium">{item.subject}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.to.length > 0 ? item.to.join(", ") : t("noRecipients")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {invoice && item.daysOverdue !== null && invoice.status === "overdue" && (
              <span className="font-semibold text-destructive">{t("daysOverdue", { count: item.daysOverdue })}</span>
            )}
            {invoice && invoice.status === "overdue" && <span className="tabular">{t("outstanding", { amount: money(invoice.outstandingCents) })}</span>}
            {invoice && invoice.status !== "overdue" && <InvoiceStatusBadge status={invoice.status} />}
            <span className="tabular">
              {item.sentAt ? t("sentAt", { date: instant(item.sentAt, timeZone) }) : t("createdAt", { date: instant(item.createdAt, timeZone) })}
            </span>
          </div>
          {settled && <p className="mt-2 text-xs text-warning">{t("settled")}</p>}
          {item.status === "failed" && item.error && <p className="mt-2 text-xs text-destructive">{t("failed", { error: item.error })}</p>}
        </div>
        {canEdit && (pending || retryable) && (
          <Button variant={open ? "ghost" : "outline"} size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
            {open ? t("collapse") : pending ? t("review") : t("reviewRetry")}
          </Button>
        )}
      </div>
      {open && canEdit && (pending || retryable) && (
        <OutboxEditor slug={slug} item={item} onDone={() => setOpen(false)} />
      )}
    </li>
  );
}

function OutboxEditor({ slug, item, onDone }: { slug: string; item: OutboxItem; onDone: () => void }) {
  const t = useTranslations("invoices.outbox");
  const tEmail = useTranslations("invoices.email");
  const message = useInvoiceValidationMessage();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const pending = item.status === "pending_approval";
  const form = useForm<EmailFormInput>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: { to: item.to.join(", "), subject: item.subject, body: item.body },
    mode: "onTouched",
  });
  const { register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async () => {
    const result = await sendOutboxEmail(slug, item.id, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(pending ? t("sentToast") : t("retriedToast"));
    onDone();
  });

  const discard = async () => {
    setDiscarding(true);
    const result = await discardOutboxEmail(slug, item.id);
    setDiscarding(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("discardedToast"));
    onDone();
  };

  const busy = isSubmitting || discarding;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 border-t bg-muted/20 px-5 py-4">
      <FormField id={`outbox-to-${item.id}`} label={tEmail("to")} description={tEmail("toHint")} error={message(errors.to?.message)}>
        <Input id={`outbox-to-${item.id}`} {...register("to")} inputMode="email" autoComplete="off" aria-invalid={Boolean(errors.to)} />
      </FormField>
      <FormField id={`outbox-subject-${item.id}`} label={tEmail("subject")} error={message(errors.subject?.message)}>
        <Input id={`outbox-subject-${item.id}`} {...register("subject")} aria-invalid={Boolean(errors.subject)} />
      </FormField>
      <FormField id={`outbox-body-${item.id}`} label={tEmail("body")} error={message(errors.body?.message)}>
        <Textarea
          id={`outbox-body-${item.id}`}
          {...register("body")}
          rows={10}
          aria-invalid={Boolean(errors.body)}
          className="font-mono text-[13px]"
        />
      </FormField>

      {confirmDiscard ? (
        <InlineConfirm
          tone="destructive"
          icon={<Trash2 className="text-destructive" />}
          confirmLabel={t("discardConfirmAction")}
          onConfirm={discard}
          onCancel={() => setConfirmDiscard(false)}
          pending={discarding}
        >
          {t("discardConfirm")}
        </InlineConfirm>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {pending && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDiscard(true)} disabled={busy} className="mr-auto hover:text-destructive">
              <Trash2 data-icon="inline-start" />
              {t("discard")}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={busy}>
            {t("collapse")}
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {pending ? <Send data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
            {isSubmitting ? t("sending") : pending ? t("send") : t("retry")}
          </Button>
        </div>
      )}
    </form>
  );
}
