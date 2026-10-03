import { ArrowDownLeft, ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ThreadPage } from "@/server/mail/queries";

/**
 * La lista de conversaciones. Paginada siempre (25 por página) y con búsqueda y filtro de no leídos
 * por la URL, así que compartir un enlace enseña lo mismo a quien lo abra.
 */
export async function MailInbox({
  page,
  basePath,
  activeThread,
  query,
  unreadOnly,
}: {
  page: ThreadPage;
  basePath: string;
  activeThread: string | null;
  query: string;
  unreadOnly: boolean;
}) {
  const t = await getTranslations("mail");
  const format = await getFormatter();
  const href = (params: Record<string, string | number | undefined>) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (unreadOnly) search.set("unread", "1");
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
    const text = search.toString();
    return `${basePath}/mail${text ? `?${text}` : ""}`;
  };

  return (
    <div className="space-y-3">
      <form action={`${basePath}/mail`} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={query} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} className="pl-9" />
        </div>
        {unreadOnly && <input type="hidden" name="unread" value="1" />}
        <Button type="submit" variant="outline">
          {t("searchAction")}
        </Button>
      </form>

      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex gap-1">
          <Button asChild size="sm" variant={unreadOnly ? "ghost" : "secondary"}>
            <Link href={`${basePath}/mail${query ? `?q=${encodeURIComponent(query)}` : ""}`}>{t("filterAll")}</Link>
          </Button>
          <Button asChild size="sm" variant={unreadOnly ? "secondary" : "ghost"}>
            <Link href={`${basePath}/mail?unread=1${query ? `&q=${encodeURIComponent(query)}` : ""}`}>{t("filterUnread")}</Link>
          </Button>
        </div>
        <p className="text-muted-foreground tabular-nums">{t("threadCount", { count: page.total })}</p>
      </div>

      {page.threads.length === 0 ? (
        <p className="rounded-xl border border-dashed px-5 py-10 text-center text-sm text-muted-foreground">{t("noThreads")}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card/60">
          {page.threads.map((thread) => (
            <li key={thread.threadKey}>
              <Link
                href={href({ thread: thread.threadKey, page: page.page })}
                className={cn(
                  "block px-4 py-3 transition-colors hover:bg-muted/50",
                  thread.threadKey === activeThread && "bg-muted/70",
                  thread.unread > 0 && "border-l-2 border-primary",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                    {thread.lastDirection === "incoming" ? (
                      <ArrowDownLeft className="size-3.5 shrink-0 text-primary" aria-hidden />
                    ) : (
                      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="truncate">{thread.counterpartName || thread.counterpart || t("unknownSender")}</span>
                  </p>
                  <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={thread.lastAt}>
                    {format.dateTime(new Date(thread.lastAt), { day: "numeric", month: "short" })}
                  </time>
                </div>
                <p className={cn("mt-0.5 truncate text-sm", thread.unread > 0 ? "font-semibold" : "text-foreground/90")}>{thread.subject}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{thread.snippet}</p>
                {thread.clientName && <p className="mt-1 truncate text-xs font-semibold text-primary">{thread.clientName}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page.pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button asChild size="sm" variant="outline" disabled={page.page === 1}>
            <Link href={href({ page: Math.max(1, page.page - 1), thread: activeThread ?? undefined })}>{t("previous")}</Link>
          </Button>
          <p className="text-sm text-muted-foreground tabular-nums">{t("pageOf", { page: page.page, pages: page.pages })}</p>
          <Button asChild size="sm" variant="outline" disabled={page.page === page.pages}>
            <Link href={href({ page: Math.min(page.pages, page.page + 1), thread: activeThread ?? undefined })}>{t("next")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
