"use client";

import { ArrowDownLeft, ArrowUpRight, ChevronDown, Paperclip } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { ownText } from "@/domain/mail";
import { cn } from "@/lib/utils";

/**
 * Un mensaje de un hilo. El último se enseña abierto y los anteriores plegados en una línea (quién,
 * cuándo y cómo empieza), como hace cualquier cliente de correo bueno. Por defecto solo se ve lo
 * que escribió la persona: lo citado de mensajes anteriores y la firma quedan detrás de «Ver todo».
 */
export function MailMessageCard({
  message,
  defaultOpen,
}: {
  message: {
    direction: "incoming" | "outgoing";
    fromAddress: string;
    fromName: string;
    toAddresses: string[];
    ccAddresses: string[];
    bodyText: string;
    sentAt: string;
    hasAttachments: boolean;
    seen: boolean;
  };
  defaultOpen: boolean;
}) {
  const t = useTranslations("mail");
  const format = useFormatter();
  const [open, setOpen] = useState(defaultOpen);
  const [full, setFull] = useState(false);

  const own = ownText(message.bodyText);
  // Hay algo escondido si el texto propio es más corto que el completo (citas, firma…).
  const hasHidden = message.bodyText.trim().length > own.length + 8;
  const shown = (full ? message.bodyText : own).trim() || message.bodyText.trim() || t("emptyBody");
  const who = message.fromName || message.fromAddress;
  const when = format.dateTime(new Date(message.sentAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const Arrow = message.direction === "incoming" ? ArrowDownLeft : ArrowUpRight;

  return (
    <article className={cn("px-5", message.direction === "outgoing" && "bg-muted/25")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            message.direction === "incoming" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Arrow className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", !message.seen && message.direction === "incoming" ? "font-bold" : "font-semibold")}>{who}</span>
          {!open && <span className="block truncate text-xs text-muted-foreground">{own.replace(/\s+/g, " ").slice(0, 140)}</span>}
        </span>
        {message.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("hasAttachments")} />}
        <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={message.sentAt}>
          {when}
        </time>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="pb-5 pl-11">
          <p className="mb-3 truncate text-xs text-muted-foreground">
            {t("toLine", { addresses: message.toAddresses.join(", ") || "—" })}
            {message.ccAddresses.length > 0 && ` · ${t("ccLine", { addresses: message.ccAddresses.join(", ") })}`}
          </p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{shown}</p>
          {hasHidden && (
            <button type="button" onClick={() => setFull((value) => !value)} className="mt-3 text-xs font-semibold text-primary hover:underline">
              {full ? t("hideQuoted") : t("showQuoted")}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
