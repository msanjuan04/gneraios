"use client";

import { ArrowDownToLine, ArrowRight, CircleCheck, CircleX, FileSignature, Mail } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useQuoteFormat } from "./format";
import type { EmailStatus, QuoteEditorData } from "./types";

const EMAIL_STYLES: Record<EmailStatus, string> = {
  pending_approval: "bg-warning/15 text-warning",
  sent: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

/** Lo que ha pasado con el presupuesto: aceptado (con su contrato), rechazado y los envíos. */
export function QuoteActivityCard({ basePath, data }: { basePath: string; data: QuoteEditorData }) {
  const t = useTranslations("quotes.activity");
  const tEmail = useTranslations("billing.emailStatus");
  const { instant } = useQuoteFormat();

  return (
    <SettingsCard title={t("title")} bodyClassName="space-y-4">
      {data.status === "accepted" && data.acceptedAt && (
        <div className="flex items-start gap-2.5">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t("accepted", { date: instant(data.acceptedAt) })}</p>
            {data.contract && (
              <Button asChild variant="link" size="sm" className="h-auto max-w-full shrink px-0">
                <Link href={`${basePath}/contracts/${data.contract.id}`}>
                  <FileSignature data-icon="inline-start" />
                  {/* Un título largo se corta: en el móvil no debe ensanchar la página. */}
                  <span className="min-w-0 truncate">{t("contract", { title: data.contract.title })}</span>
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
      {data.status === "rejected" && data.rejectedAt && (
        <div className="flex items-start gap-2.5">
          <CircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-semibold">{t("rejected", { date: instant(data.rejectedAt) })}</p>
            {data.rejectionReason && <p className="mt-0.5 text-muted-foreground">{data.rejectionReason}</p>}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("emails")}</p>
        {data.emails.length === 0 ? (
          <p className="text-muted-foreground">{t("noEmails")}</p>
        ) : (
          <ul className="space-y-2.5">
            {data.emails.map((email) => (
              <li key={email.id} className="flex items-start gap-2.5">
                <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="truncate font-medium">{email.to.join(", ")}</p>
                    <Badge className={cn(EMAIL_STYLES[email.status])}>{tEmail(email.status)}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <p className="truncate">{email.subject} · <span className="tabular">{instant(email.sentAt ?? email.createdAt)}</span></p>
                    {email.hasSnapshot && <a className="inline-flex items-center gap-1 font-medium text-primary hover:underline" href={`/api/quotes/${data.quoteId}/pdf?version=${email.id}&download=1`}><ArrowDownToLine className="size-3.5" />{t("downloadSentCopy")}</a>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {data.manualVersions.length > 0 && <div>
        <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("manualSends")}</p>
        <ul className="space-y-2">{data.manualVersions.map((version) => <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <div className="min-w-0"><p className="font-medium">{t(`methods.${version.method}`)}{version.recipient ? ` · ${version.recipient}` : ""}</p><p className="text-xs text-muted-foreground">{instant(version.sentAt)}{version.note ? ` · ${version.note}` : ""}</p></div>
          <a className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline" href={`/api/quotes/${data.quoteId}/pdf?version=${version.id}&download=1`}><ArrowDownToLine className="size-3.5" />{t("downloadSentCopy")}</a>
        </li>)}</ul>
      </div>}
    </SettingsCard>
  );
}
