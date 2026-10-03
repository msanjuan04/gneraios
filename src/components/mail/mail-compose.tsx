"use client";

import { Reply, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { sendMailMessage } from "@/app/[org]/mail/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/**
 * Escribir: una respuesta a un mensaje del hilo, o un correo nuevo. Al responder no se piden
 * destinatario ni asunto (salen del mensaje original) y la cita la pone el servidor.
 */
export function MailCompose({
  slug,
  mode,
  replyToId,
  replyTo,
  replySubject,
  clientId,
}: {
  slug: string;
  mode: "reply" | "new";
  replyToId?: string;
  replyTo?: string;
  replySubject?: string;
  clientId?: string | null;
}) {
  const t = useTranslations("mail.compose");
  const [open, setOpen] = useState(mode === "new");
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start(async () => {
      const result = await sendMailMessage(slug, {
        to: mode === "reply" ? (replyTo ?? "") : String(form.get("to") ?? ""),
        cc: String(form.get("cc") ?? ""),
        subject: mode === "reply" ? (replySubject ?? "") : String(form.get("subject") ?? ""),
        body: String(form.get("body") ?? ""),
        reply_to_id: mode === "reply" ? (replyToId ?? "") : "",
        client_id: clientId ?? "",
      });
      if (result.ok) {
        toast.success(t("sent"));
        setBody("");
        if (mode === "reply") setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  };

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Reply data-icon="inline-start" />
        {t("reply")}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card/60 p-4">
      {mode === "reply" ? (
        <p className="text-sm text-muted-foreground">{t("replyingTo", { address: replyTo ?? "" })}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input name="to" required placeholder={t("to")} aria-label={t("to")} autoComplete="off" />
          <Input name="cc" placeholder={t("cc")} aria-label={t("cc")} autoComplete="off" />
          <Input name="subject" required placeholder={t("subject")} aria-label={t("subject")} className="sm:col-span-2" />
        </div>
      )}
      <Textarea
        name="body"
        required
        rows={mode === "reply" ? 6 : 10}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={t("bodyPlaceholder")}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending || body.trim().length === 0}>
          <Send data-icon="inline-start" />
          {pending ? t("sending") : t("send")}
        </Button>
        {mode === "reply" && (
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            <X data-icon="inline-start" />
            {t("cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
