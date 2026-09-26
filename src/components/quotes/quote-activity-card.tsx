"use client";

import { ArrowRight, CircleCheck, CircleX, FileSignature, Mail } from "lucide-react";
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
              <Button asChild variant="link" size="sm" className="h-auto px-0">
                <Link href={`${basePath}/contracts/${data.contract.id}`}>
                  <FileSignature data-icon="inline-start" />
                  {t("contract", { title: data.contract.title })}
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
                  <p className="truncate text-xs text-muted-foreground">
                    {email.subject} · <span className="tabular">{instant(email.sentAt ?? email.createdAt)}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsCard>
  );
}
