import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { MailClientFilter } from "@/components/mail/mail-client-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { leadInitials } from "@/domain/crm";
import { cn } from "@/lib/utils";
import type { ThreadPage, ThreadView } from "@/server/mail/queries";

/**
 * La lista de conversaciones: pestañas con su cuenta (todo, sin leer, toca contestar), filtro por
 * cliente, búsqueda y 25 por página. Todo vive en la URL, así que compartir un enlace enseña lo
 * mismo a quien lo abra y el botón de atrás hace lo que se espera.
 */
export async function MailInbox({
  page,
  basePath,
  activeThread,
  query,
  view,
  client,
  clients,
}: {
  page: ThreadPage;
  basePath: string;
  activeThread: string | null;
  query: string;
  view: ThreadView;
  client: string;
  clients: { id: string; name: string }[];
}) {
  const t = await getTranslations("mail");
  const format = await getFormatter();
  const href = (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (view !== "all") search.set("view", view);
    if (client) search.set("client", client);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") search.delete(key);
      else search.set(key, String(value));
    }
    const text = search.toString();
    return `${basePath}/mail${text ? `?${text}` : ""}`;
  };
  const tabs: { key: ThreadView; label: string; count: number }[] = [
    { key: "all", label: t("tabAll"), count: page.counts.all },
    { key: "reply", label: t("tabReply"), count: page.counts.reply },
    { key: "unread", label: t("tabUnread"), count: page.counts.unread },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <form action={`${basePath}/mail`} className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={query} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="h-10 rounded-full pl-9" />
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          {client && <input type="hidden" name="client" value={client} />}
        </form>
        <Button asChild className="shrink-0 rounded-full">
          <Link href={href({ compose: 1, thread: undefined })}>
            <Plus data-icon="inline-start" />
            {t("newMail")}
          </Link>
        </Button>
      </div>

      <MailClientFilter clients={clients} value={client} />

      <div className="flex gap-1 rounded-full border bg-card/60 p-1" role="tablist" aria-label={t("tabsLabel")}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            role="tab"
            aria-selected={view === tab.key}
            href={href({ view: tab.key === "all" ? undefined : tab.key, page: undefined, thread: undefined })}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-semibold transition-colors sm:text-sm",
              view === tab.key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="truncate">{tab.label}</span>
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px] tabular-nums",
                tab.key !== "all" && tab.count > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {tab.count}
            </span>
          </Link>
        ))}
      </div>

      {page.threads.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">{t("noThreads")}</p>
      ) : (
        <ul className="min-h-0 divide-y overflow-y-auto rounded-2xl border bg-card/60 lg:max-h-[calc(100dvh-20rem)]">
          {page.threads.map((thread) => {
            const who = thread.counterpartName || thread.counterpart || t("unknownSender");
            const unread = thread.unread > 0;
            return (
              <li key={thread.threadKey}>
                <Link
                  href={href({ thread: thread.threadKey, compose: undefined })}
                  aria-current={thread.threadKey === activeThread ? "true" : undefined}
                  className={cn(
                    "flex gap-3 px-3.5 py-3 transition-colors hover:bg-muted/50",
                    thread.threadKey === activeThread && "bg-primary/[0.07]",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-xl text-sm font-extrabold",
                      unread ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {leadInitials(thread.clientName ?? who)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", unread ? "font-bold" : "font-semibold")}>{thread.clientName ?? who}</span>
                      <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={thread.lastAt}>
                        {format.dateTime(new Date(thread.lastAt), { day: "numeric", month: "short" })}
                      </time>
                    </span>
                    <span className={cn("block truncate text-sm", unread ? "font-semibold" : "text-foreground/90")}>{thread.subject}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{thread.snippet}</span>
                    </span>
                    {(thread.needsReply || thread.messages > 1) && (
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {thread.needsReply && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{t("needsReply")}</span>
                        )}
                        {thread.messages > 1 && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                            {t("messagesInThread", { count: thread.messages })}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {page.pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button asChild size="sm" variant="outline" className="rounded-full" disabled={page.page === 1}>
            <Link href={href({ page: Math.max(1, page.page - 1) })}>{t("previous")}</Link>
          </Button>
          <p className="text-sm text-muted-foreground tabular-nums">{t("pageOf", { page: page.page, pages: page.pages })}</p>
          <Button asChild size="sm" variant="outline" className="rounded-full" disabled={page.page === page.pages}>
            <Link href={href({ page: Math.min(page.pages, page.page + 1) })}>{t("next")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
