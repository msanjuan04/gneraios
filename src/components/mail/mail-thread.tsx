import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MailCompose } from "@/components/mail/mail-compose";
import { MailMarkSeen } from "@/components/mail/mail-mark-seen";
import { MailMessageCard } from "@/components/mail/mail-message";
import { baseSubject } from "@/domain/mail";
import type { MailMessage } from "@/server/mail/queries";

/**
 * Un hilo entero: el asunto arriba, los mensajes (el último abierto, los demás plegados) y la
 * respuesta lista al final, ya desplegada: contestar no debería costar un clic más. Se usa en la
 * bandeja y en la ficha de un lead o cliente, que son los mismos mensajes en otro sitio.
 */
export async function MailThread({
  slug,
  messages,
  basePath,
  canSend,
  threadKey,
  backHref,
}: {
  slug: string;
  messages: MailMessage[];
  basePath: string;
  canSend: boolean;
  /** Con él se marca como leído al abrirlo; sin él (listas sueltas) no se toca nada. */
  threadKey?: string;
  /** El enlace de «volver a la lista», que en pantallas pequeñas es la única forma de salir. */
  backHref?: string;
}) {
  const t = await getTranslations("mail");
  const last = messages.at(-1);
  if (!last) {
    return <p className="rounded-2xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">{t("noThread")}</p>;
  }
  // Se responde a quien escribió el último mensaje de fuera; si todo es nuestro, a quien se lo enviamos.
  const incoming = [...messages].reverse().find((message) => message.direction === "incoming");
  const replyTo = incoming?.fromAddress ?? last.toAddresses[0] ?? "";
  const clientId = messages.find((message) => message.clientId)?.clientId ?? null;
  const unread = messages.some((message) => !message.seen && message.direction === "incoming");

  return (
    <section className="overflow-hidden rounded-2xl border bg-card/60">
      {threadKey && <MailMarkSeen slug={slug} threadKey={threadKey} unread={unread} />}
      <header className="flex items-start gap-3 border-b px-5 py-4">
        {backHref && (
          <Link href={backHref} aria-label={t("backToList")} className="-ml-1.5 mt-0.5 grid size-8 shrink-0 place-items-center rounded-full hover:bg-muted lg:hidden">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-balance text-lg font-bold leading-snug">{baseSubject(last.subject) || t("noSubject")}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            <span>{t("messagesInThread", { count: messages.length })}</span>
            {clientId && (
              <Link href={`${basePath}/leads/${clientId}`} className="font-semibold text-primary hover:underline">
                {t("openClient")}
              </Link>
            )}
          </p>
        </div>
      </header>

      <div className="divide-y">
        {messages.map((message, index) => (
          <MailMessageCard key={message.id} message={message} defaultOpen={index === messages.length - 1} />
        ))}
      </div>

      {canSend && (
        <div className="border-t bg-muted/20 px-5 py-4">
          <MailCompose slug={slug} mode="reply" replyToId={last.id} replyTo={replyTo} replySubject={last.subject} clientId={clientId} />
        </div>
      )}
    </section>
  );
}
