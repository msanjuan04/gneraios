"use client";

import { Check, Copy, FileText, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { acceptQuote } from "@/app/[org]/quotes/actions";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { LeadMailSignal } from "@/server/crm/mail-signals";

/**
 * Qué toca hacer, leído del último correo: lo que piden en sus palabras, un borrador de respuesta
 * para editar y enviar, y el siguiente paso preparado (la plantilla que encaja o el presupuesto que
 * ya está enviado).
 *
 * Nada se aplica solo. Marcar aceptado crea contrato y borrador de factura: eso lo confirma una
 * persona, porque un correo mal leído no puede acabar en una factura.
 */
export function LeadNextStep({
  signal,
  slug,
  basePath,
  clientId,
  dealId,
  canEdit,
}: {
  signal: LeadMailSignal;
  slug: string;
  basePath: string;
  clientId: string;
  dealId: string | null;
  canEdit: boolean;
}) {
  const t = useTranslations("leads.nextStep");
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reply, setReply] = useState(() => t(`reply.${signal.intent}`, { name: firstName(signal.from) }));

  const quoteHref = `${basePath}/quotes/new?${new URLSearchParams({
    client: clientId,
    ...(dealId ? { deal: dealId } : {}),
    ...(signal.template ? { template: signal.template.id } : {}),
  }).toString()}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      // Se vuelve al estado normal solo: así se ve que ha ido bien sin dejar el botón raro.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const accept = () => {
    if (!signal.sentQuote) return;
    start(async () => {
      const result = await acceptQuote(slug, signal.sentQuote!.id);
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(t("accepted"));
        if (result.warning) toast.warning(result.warning);
      }
    });
  };

  return (
    <Card className="border-primary/30">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {t(`intent.${signal.intent}`)}
        </CardTitle>
        <CardDescription>{t("read", { from: signal.from, subject: signal.subject })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {signal.summary.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("asks")}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {signal.summary.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("draftReply")}</p>
          <Textarea className="mt-1" rows={6} value={reply} onChange={(event) => setReply(event.target.value)} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? t("copied") : t("copy")}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`${basePath}/leads/${clientId}/mail`}>{t("answerInMail")}</Link>
            </Button>
          </div>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            {/* Si dicen que aceptan y hay un presupuesto enviado, el paso es cerrarlo (con confirmación). */}
            {signal.intent === "accepted" && signal.sentQuote ? (
              confirming ? (
                <InlineConfirm
                  className="w-full"
                  confirmLabel={t("markAcceptedConfirm")}
                  onConfirm={accept}
                  onCancel={() => setConfirming(false)}
                  pending={pending}
                >
                  {t("markAcceptedHint")}
                </InlineConfirm>
              ) : (
                <Button size="sm" onClick={() => setConfirming(true)}>
                  <Check data-icon="inline-start" />
                  {t("markAccepted", { number: signal.sentQuote.number ?? "" })}
                </Button>
              )
            ) : null}
            {signal.intent === "rejected" && signal.sentQuote ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`${basePath}/quotes/${signal.sentQuote.id}`}>
                  <X data-icon="inline-start" />
                  {t("openToReject")}
                </Link>
              </Button>
            ) : null}
            {!signal.hasQuote && (
              <Button asChild size="sm">
                <Link href={quoteHref}>
                  <FileText data-icon="inline-start" />
                  {signal.template ? t("draftFromTemplate", { name: signal.template.name }) : t("draftQuote")}
                </Link>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** El nombre de pila para encabezar la respuesta: «Nadia Pérez <…>» → «Nadia». */
function firstName(from: string): string {
  const name = from.split("<")[0]!.trim();
  if (!name || name.includes("@")) return "";
  return name.split(/\s+/)[0]!;
}
