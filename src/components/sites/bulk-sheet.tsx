"use client";

import { Check, CircleSlash, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/app-shell/shell-context";
import { OptionSelect } from "@/components/projects/fields";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { suggestClientForSite } from "@/domain/seo/site-url";
import { BULK_MAX_SITES, parseSiteList, siteDisplayUrl } from "@/domain/sites";
import { cn } from "@/lib/utils";
import { addSitesInBulk } from "@/server/sites/actions";
import type { SiteClientOption } from "./types";

type Props = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: SiteClientOption[];
  /** Las URLs que ya se vigilan (se saltan). */
  existingUrls: readonly string[];
  onAdded?: (added: number) => void;
};

const PREVIEW_ROWS = 60;

/** Alta en bloque: se pegan varias webs (una por línea) y se ve al momento qué se añadirá. */
export function BulkSitesSheet(props: Props) {
  const t = useTranslations("sites.bulk");
  return (
    <SettingsSheet open={props.open} onOpenChange={props.onOpenChange} title={t("title")} description={t("description")}>
      {props.open && <BulkForm {...props} />}
    </SettingsSheet>
  );
}

function BulkForm({ slug, onOpenChange, clients, existingUrls, onAdded }: Props) {
  const t = useTranslations("sites.bulk");
  const tCommon = useTranslations("common");
  const { preview } = useShell();
  const [text, setText] = useState("");
  const [hostedByUs, setHostedByUs] = useState(true);
  const [matchClients, setMatchClients] = useState(true);
  const [clientId, setClientId] = useState("");
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(() => parseSiteList(text), [text]);
  const existing = useMemo(() => new Set(existingUrls), [existingUrls]);
  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const rows = parsed.urls.map((url) => {
    const matched = clientId || (matchClients ? suggestClientForSite(url, clients) : null);
    return { url, known: existing.has(url), client: matched ? (clientName.get(matched) ?? null) : null };
  });
  const toAdd = rows.filter((r) => !r.known).length;
  const tooMany = parsed.urls.length > BULK_MAX_SITES;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (toAdd === 0 || tooMany) return;
    if (preview) {
      toast.info(t("previewOnly"));
      return;
    }
    startTransition(async () => {
      const result = await addSitesInBulk(slug, { text, hosted_by_us: hostedByUs, match_clients: matchClients, client_id: clientId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("added", { count: result.added }), {
        description: result.skipped > 0 ? t("skipped", { count: result.skipped }) : t("checkingSoon"),
      });
      onOpenChange(false);
      onAdded?.(result.added);
    });
  };

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={pending || toAdd === 0 || tooMany}>
            {pending ? tCommon("saving") : t("submit", { count: toAdd })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField id="bulk-text" label={t("label")} description={t("hint", { max: BULK_MAX_SITES })} error={tooMany ? t("tooMany", { max: BULK_MAX_SITES }) : undefined}>
          <Textarea
            id="bulk-text"
            autoFocus
            rows={8}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("placeholder")}
            className="font-mono text-[13px]"
          />
        </FormField>

        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleField id="bulk-hosted" label={t("hostedByUs")} description={t("hostedByUsHint")} checked={hostedByUs} onCheckedChange={setHostedByUs} />
          <ToggleField
            id="bulk-match"
            label={t("matchClients")}
            description={t("matchClientsHint")}
            checked={matchClients && !clientId}
            onCheckedChange={setMatchClients}
            disabled={Boolean(clientId)}
          />
        </div>

        <FormField id="bulk-client" label={t("client")} optional description={t("clientHint")}>
          <OptionSelect
            id="bulk-client"
            value={clientId}
            onChange={setClientId}
            noneLabel={t("noClient")}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
          />
        </FormField>

        {(rows.length > 0 || parsed.invalid.length > 0) && (
          <section aria-label={t("previewTitle")} className="rounded-xl border">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
              <span className="font-semibold">{t("previewTitle")}</span>
              <span className="text-muted-foreground tabular">
                {t("previewSummary", { add: toAdd, known: rows.length - toAdd, invalid: parsed.invalid.length })}
              </span>
            </header>
            <ul className="max-h-72 divide-y overflow-y-auto text-sm">
              {rows.slice(0, PREVIEW_ROWS).map((row) => (
                <li key={row.url} className={cn("flex items-center gap-2 px-3 py-1.5", row.known && "text-muted-foreground")}>
                  {row.known ? <Copy className="size-3.5 shrink-0" aria-hidden /> : <Check className="size-3.5 shrink-0 text-success" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{siteDisplayUrl(row.url)}</span>
                  <span className="shrink-0 truncate text-xs text-muted-foreground">{row.known ? t("alreadyWatched") : (row.client ?? t("noClientShort"))}</span>
                </li>
              ))}
              {parsed.invalid.slice(0, PREVIEW_ROWS).map((token, i) => (
                <li key={`invalid-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-destructive">
                  <CircleSlash className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{token}</span>
                  <span className="shrink-0 text-xs">{t("invalid")}</span>
                </li>
              ))}
            </ul>
            {rows.length > PREVIEW_ROWS && <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t("more", { count: rows.length - PREVIEW_ROWS })}</p>}
          </section>
        )}
      </div>
    </SheetForm>
  );
}
