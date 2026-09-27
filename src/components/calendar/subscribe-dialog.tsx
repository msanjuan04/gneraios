"use client";

import { Check, Copy, KeyRound, Rss, TriangleAlert } from "lucide-react";
import { useFormatter } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createCalendarFeedAction, revokeCalendarFeedAction } from "@/server/calendar/actions";
import type { MemberFeed } from "@/server/calendar/feeds";
import { useCalendarText } from "./use-calendar-text";

type Scope = "mine" | "all";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  /** El enlace activo del socio (sin la URL: el token no se guarda). */
  feed: MemberFeed | null;
  /** La app corre en local: Google Calendar no puede leer el enlace. */
  localAppUrl: boolean;
};

const webcal = (url: string) => url.replace(/^https?:\/\//, "webcal://");

/**
 * "Suscribirse": crea el enlace ICS privado del socio y explica cómo añadirlo. La URL se enseña una
 * sola vez (se guarda su hash); si se pierde, se crea otra y la anterior deja de funcionar.
 */
export function SubscribeDialog({ open, onOpenChange, slug, feed: initialFeed, localAppUrl }: Props) {
  const text = useCalendarText();
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [feed, setFeed] = useState<MemberFeed | null>(initialFeed);
  const [url, setUrl] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>(initialFeed?.scope ?? "mine");
  const [copied, setCopied] = useState(false);

  function create() {
    startTransition(async () => {
      const result = await createCalendarFeedAction(slug, scope);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFeed(result.feed);
      setUrl(result.url);
      setCopied(false);
    });
  }

  function revoke() {
    startTransition(async () => {
      const result = await revokeCalendarFeedAction(slug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFeed(null);
      setUrl(null);
      toast.success(text.t("subscribe.revoked"));
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success(text.t("subscribe.copied"));
    } catch {
      toast.error(text.t("subscribe.copyFailed"));
    }
  }

  const when = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-bold">
            <Rss aria-hidden className="size-4 text-primary" />
            {text.t("subscribe.title")}
          </DialogTitle>
          <DialogDescription>{text.t("subscribe.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {url ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={text.t("subscribe.urlLabel")} className="font-mono text-xs" />
                <Button type="button" variant="secondary" onClick={copy}>
                  {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                  {copied ? text.t("subscribe.copiedShort") : text.t("subscribe.copy")}
                </Button>
              </div>
              <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <KeyRound aria-hidden className="mt-px size-3.5 shrink-0" />
                {text.t("subscribe.onlyOnce")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal(url))}`} target="_blank" rel="noreferrer">
                    {text.t("subscribe.openGoogle")}
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={webcal(url)}>{text.t("subscribe.openApple")}</a>
                </Button>
              </div>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                <li>{text.t("subscribe.stepGoogle")}</li>
                <li>{text.t("subscribe.stepApple")}</li>
                <li>{text.t("subscribe.stepOutlook")}</li>
              </ol>
            </div>
          ) : (
            <>
              {feed && (
                <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                  {text.t("subscribe.active", { date: when(feed.createdAt), scope: text.t(`subscribe.scope.${feed.scope}`) })}{" "}
                  {feed.lastUsedAt ? text.t("subscribe.lastUsed", { date: when(feed.lastUsedAt) }) : text.t("subscribe.neverUsed")}
                </p>
              )}
              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-semibold text-muted-foreground">{text.t("subscribe.scopeLabel")}</legend>
                <div role="radiogroup" aria-label={text.t("subscribe.scopeLabel")} className="grid gap-2 sm:grid-cols-2">
                  {(["mine", "all"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={scope === option}
                      onClick={() => setScope(option)}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                        scope === option ? "border-primary/60 bg-primary/10" : "hover:bg-muted",
                      )}
                    >
                      <span className="block text-sm font-semibold">{text.t(`subscribe.scope.${option}`)}</span>
                      <span className="block text-xs text-muted-foreground">{text.t(`subscribe.scopeHint.${option}`)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {localAppUrl && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
              {text.t("subscribe.localWarning")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{text.t("subscribe.privacy")}</p>
        </div>

        <DialogFooter>
          {feed && (
            <Button variant="destructive" onClick={revoke} disabled={pending} className="sm:mr-auto">
              {text.t("subscribe.revoke")}
            </Button>
          )}
          {url ? (
            <Button onClick={() => onOpenChange(false)}>{text.t("subscribe.done")}</Button>
          ) : (
            <Button onClick={create} disabled={pending}>
              {feed ? text.t("subscribe.regenerate") : text.t("subscribe.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
