import { ArrowDownLeft, ArrowUpRight, Paperclip } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { MailCompose } from "@/components/mail/mail-compose";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MailMessage } from "@/server/mail/queries";

/**
 * Un hilo: los mensajes en orden, los nuestros marcados aparte, y el cuadro de respuesta abajo.
 * Se usa en la bandeja y en la ficha de un lead o cliente (los mismos mensajes, otro sitio).
 */
export async function MailThread({
  slug,
  messages,
  basePath,
  canSend,
}: {
  slug: string;
  messages: MailMessage[];
  basePath: string;
  canSend: boolean;
}) {
  const t = await getTranslations("mail");
  const format = await getFormatter();
  const last = messages.at(-1);
  // Se responde a quien escribió el último mensaje de fuera; si todo es nuestro, a quien se lo enviamos.
  const incoming = [...messages].reverse().find((message) => message.direction === "incoming");
  const replyTo = incoming?.fromAddress ?? last?.toAddresses[0] ?? "";
  const clientId = messages.find((message) => message.clientId)?.clientId ?? null;

  if (messages.length === 0) {
    return <p className="rounded-xl border border-dashed px-5 py-10 text-center text-sm text-muted-foreground">{t("noThread")}</p>;
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-balance">{last?.subject || t("noSubject")}</CardTitle>
        {clientId && (
          <Link href={`${basePath}/clients/${clientId}`} className="text-sm font-semibold text-primary hover:underline">
            {t("openClient")}
          </Link>
        )}
      </CardHeader>
      <CardContent className="space-y-4 p-0">
        <ul className="divide-y">
          {messages.map((message) => (
            <li key={message.id} className={cn("px-5 py-4", message.direction === "outgoing" && "bg-muted/30")}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="flex min-w-0 items-center gap-2 font-semibold">
                  {message.direction === "incoming" ? (
                    <ArrowDownLeft className="size-4 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="truncate">{message.fromName || message.fromAddress}</span>
                  {message.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                </p>
                <time className="text-xs text-muted-foreground tabular-nums" dateTime={message.sentAt}>
                  {format.dateTime(new Date(message.sentAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </time>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {t("toLine", { addresses: message.toAddresses.join(", ") || "—" })}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{message.bodyText.trim() || t("emptyBody")}</p>
            </li>
          ))}
        </ul>
        {canSend && last && (
          <div className="px-5 pb-5">
            <MailCompose slug={slug} mode="reply" replyToId={last.id} replyTo={replyTo} replySubject={last.subject} clientId={clientId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
