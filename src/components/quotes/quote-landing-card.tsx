"use client";

import { ExternalLink, FileText, Globe, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setQuoteLanding } from "@/app/[org]/quotes/actions";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * «Dónde la vio el cliente»: muchas propuestas se envían como una landing propia
 * (littleforest.gnerai.com, bakmet.gnerai.com…). Aquí se guarda ese enlace y se abre de un clic;
 * si solo se mandó el PDF, se queda vacío y lo dice.
 */
export function QuoteLandingCard({ slug, quoteId, landingUrl, canAct }: { slug: string; quoteId: string; landingUrl: string | null; canAct: boolean }) {
  const t = useTranslations("quotes.landing");
  const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(landingUrl ?? "");
  const [pending, startTransition] = useTransition();
  const current = landingUrl;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const result = await setQuoteLanding(slug, quoteId, value);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
      toast.success(t("saved"));
    });
  };

  if (editing) {
    return (
      <SettingsCard title={t("title")} description={t("description")}>
        <form onSubmit={save} className="grid gap-3">
          <FormField id="landing-url" label={t("url")} description={t("urlHint")} optional>
            <Input id="landing-url" inputMode="url" placeholder="https://cliente.gnerai.com" maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => { setValue(current ?? ""); setEditing(false); }} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : tCommon("save")}
            </Button>
          </div>
        </form>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title={t("title")}
      description={current ? t("description") : t("emptyDescription")}
      actions={canAct ? (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <Pencil data-icon="inline-start" />
          {current ? tCommon("edit") : t("add")}
        </Button>
      ) : undefined}
    >
      {current ? (
        <a
          href={current}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition hover:border-primary/50 hover:text-primary"
        >
          <Globe className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{current.replace(/^https:\/\//, "")}</span>
          <ExternalLink className="size-4 shrink-0" aria-hidden />
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {/* La propuesta bonita (portada oscura, alcance numerado): la que se manda a quien pide algo. */}
      <a
        href={`/api/quotes/${quoteId}/proposal`}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-3 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition hover:border-primary/50 hover:text-primary"
      >
        <FileText className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{t("proposalPdf")}</span>
        <ExternalLink className="size-4 shrink-0" aria-hidden />
      </a>
      <p className="mt-1.5 text-xs text-muted-foreground">{t("proposalPdfHint")}</p>
    </SettingsCard>
  );
}
