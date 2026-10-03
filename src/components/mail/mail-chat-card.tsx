import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MailChat } from "@/components/mail/mail-chat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadMailChat } from "@/server/mail/chat";
import { canSendMail } from "@/server/mail/send";

/**
 * El apartado «Correo» de la ficha de un lead o de un cliente, en modo conversación. Solo lo ven los
 * socios (el buzón es de la empresa) y solo si hay buzón conectado; si no, nada: no se enseña un
 * hueco vacío ni un error.
 */
export async function MailChatCard({
  orgId,
  slug,
  clientId,
  basePath,
  canSee,
  tall = false,
}: {
  orgId: string;
  slug: string;
  clientId: string;
  basePath: string;
  canSee: boolean;
  /** En la página de mensajes ocupa más alto que dentro de una ficha. */
  tall?: boolean;
}) {
  if (!canSee) return null;
  const chat = await loadMailChat(orgId, clientId);
  if (!chat) return null;
  const t = await getTranslations("mail.chat");

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>{t("description", { count: chat.messages.length })}</span>
          {!tall && (
            <Link href={`${basePath}/leads/${clientId}/mail`} className="font-semibold text-primary hover:underline">
              {t("openFull")}
            </Link>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <MailChat
          slug={slug}
          clientId={clientId}
          messages={chat.messages}
          recipients={chat.recipients}
          accountAddress={chat.account.address}
          canSend={canSendMail()}
          maxHeightClass={tall ? "max-h-[calc(100dvh-24rem)] min-h-64" : "max-h-[30rem]"}
        />
      </CardContent>
    </Card>
  );
}
