"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Archive, LayoutTemplate, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { archiveQuoteTemplate, updateQuoteTemplate } from "@/app/[org]/quotes/actions";
import { type TemplateFormInput, templateFormSchema, templateLineBaseCents } from "@/app/[org]/quotes/template-schema";
import { PageHeader } from "@/components/page-header";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { ReadOnlyNotice } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATALOG_CATEGORIES } from "@/domain/catalog";
import { useQuoteFormat } from "./format";
import { InlineConfirm } from "./inline-confirm";
import type { QuoteTemplateItem } from "./types";

type Props = {
  slug: string;
  basePath: string;
  templates: QuoteTemplateItem[];
  canEdit: boolean;
};

/** Los importes «desde» de una plantilla: lo puntual y cada cuota por separado, nunca sumados. */
function TemplateAmounts({ template }: { template: QuoteTemplateItem }) {
  const t = useTranslations("quotes.templates");
  const { whole, perCycle } = useQuoteFormat();
  const parts = [
    template.amounts.oneOffCents > 0 ? whole(template.amounts.oneOffCents) : null,
    template.amounts.monthlyCents > 0 ? perCycle(template.amounts.monthlyCents, "monthly", true) : null,
    template.amounts.yearlyCents > 0 ? perCycle(template.amounts.yearlyCents, "yearly", true) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-sm">
      <span className="text-muted-foreground">{t("from")} </span>
      <span className="font-semibold tabular">{parts.join(" + ")}</span>
    </span>
  );
}

function TemplateSheet({ slug, template, onClose }: { slug: string; template: QuoteTemplateItem | null; onClose: () => void }) {
  const t = useTranslations("quotes.templates");
  const tCatalog = useTranslations("catalog");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useForm<TemplateFormInput>({
    resolver: zodResolver(templateFormSchema),
    values: template
      ? { name: template.name, category: template.category, summary: template.summary ?? "", title: template.title ?? "", notes: template.notes ?? "" }
      : { name: "", category: "other", summary: "", title: "", notes: "" },
    mode: "onTouched",
  });
  const { control, register, handleSubmit, formState } = form;
  const { errors } = formState;

  const submit = handleSubmit((values) => {
    if (!template) return;
    startTransition(async () => {
      const result = await updateQuoteTemplate(slug, template.id, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("updatedToast"));
      onClose();
      router.refresh();
    });
  });

  return (
    <SettingsSheet open={template !== null} onOpenChange={(open) => !open && onClose()} title={t("editSheet.title")} description={t("editSheet.description")}>
      <SheetForm
        onSubmit={submit}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tCommon("saving") : tCommon("save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <FormField id="template-name" label={t("fields.name")} error={message(errors.name?.message)}>
            <Input id="template-name" maxLength={120} aria-invalid={Boolean(errors.name)} {...register("name")} />
          </FormField>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <FormField id="template-category" label={t("fields.category")} error={message(errors.category?.message)}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="template-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATALOG_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {tCatalog(`categories.${category}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <FormField id="template-summary" label={t("fields.summary")} description={t("fields.summaryHint")} error={message(errors.summary?.message)} optional>
            <Textarea id="template-summary" rows={3} maxLength={1000} {...register("summary")} />
          </FormField>
          <FormField id="template-title" label={t("fields.title")} description={t("fields.titleHint")} error={message(errors.title?.message)} optional>
            <Input id="template-title" maxLength={200} {...register("title")} />
          </FormField>
          <FormField id="template-notes" label={t("fields.notes")} error={message(errors.notes?.message)} optional>
            <Textarea id="template-notes" rows={5} {...register("notes")} />
          </FormField>
        </div>
      </SheetForm>
    </SettingsSheet>
  );
}

function TemplateCard({ slug, basePath, template, canEdit, onEdit }: { slug: string; basePath: string; template: QuoteTemplateItem; canEdit: boolean; onEdit: () => void }) {
  const t = useTranslations("quotes.templates");
  const tCatalog = useTranslations("catalog");
  const { whole, perCycle } = useQuoteFormat();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const archive = () => {
    startTransition(async () => {
      const result = await archiveQuoteTemplate(slug, template.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("archivedToast"));
      setConfirming(false);
      router.refresh();
    });
  };

  return (
    <article className="flex flex-col rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-primary uppercase">
            {tCatalog(`categories.${template.category}`)}
          </span>
          <h3 className="mt-2 truncate text-lg font-bold heading-tight">{template.name}</h3>
          {template.summary && <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{template.summary}</p>}
        </div>
        <TemplateAmounts template={template} />
      </div>

      <ul className="mt-4 divide-y rounded-xl border bg-background/60 text-sm">
        {template.lines.slice(0, 6).map((line, index) => (
          <li key={index} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate">{line.description}</span>
            <span className="shrink-0 text-muted-foreground tabular">
              {line.billing_type === "usage" ? "—" : line.billing_type === "one_off" ? whole(templateLineBaseCents(line)) : perCycle(templateLineBaseCents(line), line.billing_type, true)}
            </span>
          </li>
        ))}
        {template.lines.length > 6 && <li className="px-3 py-2 text-xs text-muted-foreground">+{template.lines.length - 6}</li>}
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t("linesCount", { count: template.lines.length })} · {t("uses", { count: template.usesCount })}
        </span>
        <div className="flex items-center gap-1">
          {canEdit && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onEdit} disabled={pending}>
                <Pencil data-icon="inline-start" />
                {t("edit")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending || confirming}>
                <Archive data-icon="inline-start" />
                {t("archive")}
              </Button>
            </>
          )}
          {canEdit && (
            <Button asChild size="sm">
              <Link href={`${basePath}/quotes/new?template=${template.id}`}>
                <Plus data-icon="inline-start" />
                {t("use")}
              </Link>
            </Button>
          )}
        </div>
      </div>
      {confirming && (
        <InlineConfirm tone="warning" className="mt-3" confirmLabel={t("archive")} onConfirm={archive} onCancel={() => setConfirming(false)} pending={pending}>
          {t("archiveConfirm", { name: template.name })}
        </InlineConfirm>
      )}
    </article>
  );
}

export function QuoteTemplates({ slug, basePath, templates, canEdit }: Props) {
  const t = useTranslations("quotes.templates");
  const tCatalog = useTranslations("catalog");
  const [editing, setEditing] = useState<QuoteTemplateItem | null>(null);
  const groups = CATALOG_CATEGORIES.map((category) => ({ category, items: templates.filter((item) => item.category === category) })).filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button asChild variant="outline">
            <Link href={`${basePath}/quotes`}>
              <ArrowLeft data-icon="inline-start" />
              {t("backToQuotes")}
            </Link>
          </Button>
        }
      />
      {!canEdit && <ReadOnlyNotice className="-mt-4 mb-6">{t("description")}</ReadOnlyNotice>}

      {templates.length === 0 ? (
        <div className="rounded-3xl border bg-card/50 px-8 py-14 text-center md:py-16">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
            <LayoutTemplate className="size-5" />
          </div>
          <p className="mx-auto mt-5 max-w-md text-sm text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button asChild className="mt-6" variant="outline">
              <Link href={`${basePath}/quotes`}>{t("backToQuotes")}</Link>
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.category} aria-label={tCatalog(`categories.${group.category}`)}>
              <h2 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{tCatalog(`categories.${group.category}`)}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {group.items.map((template) => (
                  <TemplateCard key={template.id} slug={slug} basePath={basePath} template={template} canEdit={canEdit} onEdit={() => setEditing(template)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <TemplateSheet slug={slug} template={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
