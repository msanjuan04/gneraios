"use client";

import { Check, ChevronDown, Paperclip, Send } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { sendMailMessage } from "@/app/[org]/mail/actions";
import { baseSubject, ownText } from "@/domain/mail";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  fromAddress: string;
  fromName: string;
  subject: string;
  bodyText: string;
  sentAt: string;
  hasAttachments: boolean;
};

/** Cuántos caracteres se ven de un mensaje hasta que se pulsa en él. */
const PREVIEW = 150;

/**
 * El correo de una ficha como una conversación de WhatsApp: tus mensajes a la derecha, los suyos a
 * la izquierda, agrupados por día, cada globo plegado a una vista previa hasta que se pulsa en él, y
 * el cuadro para escribir siempre abajo. Por debajo siguen siendo correos de verdad: cada mensaje
 * que se envía va con su asunto y se encadena al hilo.
 */
export function MailChat({
  slug,
  clientId,
  messages,
  recipients,
  accountAddress,
  canSend = true,
  maxHeightClass = "max-h-[34rem]",
}: {
  slug: string;
  clientId: string;
  messages: ChatMessage[];
  recipients: { address: string; name: string }[];
  accountAddress: string;
  /** Falso si el servidor no tiene forma de enviar (falta la clave de Brevo): se explica en vez de fallar al enviar. */
  canSend?: boolean;
  maxHeightClass?: string;
}) {
  const t = useTranslations("mail.chat");
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [to, setTo] = useState(recipients[0]?.address ?? "");
  // «Nuevo tema»: se escribe un asunto propio en vez de contestar al último mensaje.
  const [newTopic, setNewTopic] = useState(messages.length === 0);
  const [subject, setSubject] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);

  // Siempre se abre mirando lo último, como un chat.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages.length]);

  const days = useMemo(() => {
    const groups: { key: string; messages: ChatMessage[] }[] = [];
    for (const message of messages) {
      const key = message.sentAt.slice(0, 10);
      const group = groups.at(-1);
      if (group?.key === key) group.messages.push(message);
      else groups.push({ key, messages: [message] });
    }
    return groups;
  }, [messages]);

  const send = () => {
    const text = body.trim();
    if (!text) return;
    if (!to) return toast.error(t("noRecipient"));
    if (newTopic && !subject.trim()) return toast.error(t("subjectRequired"));
    start(async () => {
      const result = await sendMailMessage(slug, {
        to,
        cc: "",
        subject: newTopic ? subject.trim() : (last?.subject ?? ""),
        body: text,
        reply_to_id: !newTopic && last ? last.id : "",
        client_id: clientId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setBody("");
      setSubject("");
      setNewTopic(false);
      toast.success(t("sent"));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card/40">
      <div ref={scroller} className={cn("space-y-1 overflow-y-auto px-3 py-4 sm:px-5", maxHeightClass)}>
        {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>}
        {days.map((group) => (
          <div key={group.key} className="space-y-1">
            <p className="sticky top-0 z-10 mx-auto my-3 w-fit rounded-full bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
              {format.dateTime(new Date(`${group.key}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
            </p>
            {group.messages.map((message, index) => {
              const mine = message.direction === "outgoing";
              const own = ownText(message.bodyText).trim() || message.bodyText.trim();
              const open = openId === message.id;
              const preview = own.replace(/\s+/g, " ").slice(0, PREVIEW);
              const truncated = own.replace(/\s+/g, " ").length > PREVIEW || own.includes("\n");
              // El asunto solo se rotula cuando cambia, igual que un chat agrupa por tema.
              const previous = group.messages[index - 1] ?? messages[messages.indexOf(message) - 1];
              const showSubject = !previous || baseSubject(previous.subject) !== baseSubject(message.subject);
              return (
                <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : message.id)}
                    aria-expanded={open}
                    className={cn(
                      "group max-w-[85%] rounded-2xl px-3.5 py-2 text-left shadow-sm transition-[filter] hover:brightness-110 sm:max-w-[72%]",
                      mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
                    )}
                  >
                    {showSubject && (
                      <span className={cn("mb-0.5 block text-xs font-bold", mine ? "text-primary-foreground/80" : "text-primary")}>
                        {baseSubject(message.subject) || t("noSubject")}
                      </span>
                    )}
                    <span className={cn("block whitespace-pre-wrap break-words text-[15px] leading-snug", !open && "line-clamp-3")}>
                      {open ? own : preview}
                      {!open && truncated && "…"}
                    </span>
                    <span className={cn("mt-1 flex items-center justify-end gap-1.5 text-[11px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                      {message.hasAttachments && <Paperclip className="size-3" aria-label={t("attachments")} />}
                      {!mine && <span className="mr-auto truncate font-medium">{message.fromName || message.fromAddress}</span>}
                      {truncated && <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} aria-hidden />}
                      <time dateTime={message.sentAt} className="tabular-nums">
                        {format.dateTime(new Date(message.sentAt), { hour: "2-digit", minute: "2-digit" })}
                      </time>
                      {mine && <Check className="size-3" aria-label={t("sentMark")} />}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* El cuadro para escribir, pegado abajo como en WhatsApp. */}
      {!canSend ? (
        <p className="border-t bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">{t("sendUnavailable")}</p>
      ) : (
      <div className="border-t bg-card/70 px-3 py-3 sm:px-4">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <label className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{t("to")}</span>
            {recipients.length > 1 ? (
              <select
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="min-w-0 max-w-full truncate rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-foreground"
              >
                {recipients.map((recipient) => (
                  <option key={recipient.address} value={recipient.address}>
                    {recipient.name ? `${recipient.name} <${recipient.address}>` : recipient.address}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder={t("toPlaceholder")}
                aria-label={t("to")}
                className="min-w-0 rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-foreground"
              />
            )}
          </label>
          <span className="hidden sm:inline">{t("from", { address: accountAddress })}</span>
          {last && (
            <button type="button" onClick={() => setNewTopic((value) => !value)} className="ml-auto font-semibold text-primary hover:underline">
              {newTopic ? t("replyToLast") : t("newTopic")}
            </button>
          )}
        </div>
        {newTopic && (
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t("subject")}
            aria-label={t("subject")}
            maxLength={500}
            className="mb-2 w-full rounded-xl border bg-background px-3 py-2 text-sm"
          />
        )}
        {!newTopic && last && <p className="mb-1.5 truncate text-xs text-muted-foreground">{t("replying", { subject: baseSubject(last.subject) || t("noSubject") })}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            className="min-h-11 max-h-48 flex-1 resize-y rounded-2xl border bg-background px-4 py-2.5 text-[15px] leading-snug outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <button
            type="button"
            onClick={send}
            disabled={pending || body.trim().length === 0}
            aria-label={t("send")}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <Send className="size-5" aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 hidden text-[11px] text-muted-foreground sm:block">{t("shortcut")}</p>
      </div>
      )}
    </div>
  );
}
