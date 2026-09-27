"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { deleteShareholdings, saveShareholdings } from "@/app/[org]/finance/actions";
import { bpsToInput, percentToBps, type ShareholdingsFormInput, shareholdingsFormSchema } from "@/app/[org]/finance/schema";
import { PercentInput } from "@/components/contracts/inputs";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { FormField } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useFinanceFormat, useFinanceValidationMessage } from "./format";
import type { PartnersData, ShareholdingSet } from "./types";

/** Tonos de las porciones del reparto: la rampa ordinal del azul de marca (cada una con su nombre y su cifra). */
const SHARE_TONES = [
  "var(--chart-1)",
  "color-mix(in oklab, var(--chart-1) 62%, var(--chart-4))",
  "color-mix(in oklab, var(--chart-1) 30%, var(--chart-4))",
  "var(--chart-4)",
  "color-mix(in oklab, var(--chart-4) 60%, var(--card))",
];

type Sheet = { mode: "closed" } | { mode: "edit"; set: ShareholdingSet | null };

/** Participaciones de los socios (repartos con fecha, 100 %) y su retribución de los últimos meses. */
export function PartnersView({ slug, data, canEdit, today }: { slug: string; data: PartnersData; canEdit: boolean; today: string }) {
  const t = useTranslations("finance.partners");
  const { money, date, month, percent } = useFinanceFormat();
  const [sheet, setSheet] = useState<Sheet>({ mode: "closed" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const name = (id: string | null) => (id ? (data.members.find((m) => m.id === id)?.fullName ?? t("formerMember")) : t("unassigned"));
  const current = data.sets.find((s) => s.validFrom === data.currentValidFrom) ?? null;
  const upcoming = data.sets.filter((s) => s.validFrom > today);

  // Retribución: una fila por mes (el más reciente arriba) y una columna por socio.
  const memberIds = [...new Set(data.compensation.map((c) => c.memberId))].sort((a, b) => name(a).localeCompare(name(b), "es"));
  const cell = (memberId: string | null, m: string) =>
    data.compensation.filter((c) => c.memberId === memberId && c.month === m).reduce((sum, c) => sum + c.costCents, 0);
  const months = [...data.months].reverse();
  const totalOf = (memberId: string | null) => data.months.reduce((sum, m) => sum + cell(memberId, m), 0);

  const remove = (validFrom: string) =>
    startTransition(async () => {
      const result = await deleteShareholdings(slug, validFrom);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("deleted"));
      setConfirming(null);
    });

  return (
    <div className="space-y-6">
      {!canEdit && <ReadOnlyNotice>{t("readOnly")}</ReadOnlyNotice>}

      <SettingsCard
        title={t("sharesTitle")}
        description={t("sharesDescription")}
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setSheet({ mode: "edit", set: null })}>
              <Plus data-icon="inline-start" />
              {t("newSet")}
            </Button>
          ) : undefined
        }
      >
        {data.sets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
            <Users className="size-5" />
            <p>{t("sharesEmpty")}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {current && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">{t("currentSince", { date: date(current.validFrom) })}</p>
                <div className="flex h-3 overflow-hidden rounded-full" role="img" aria-label={t("currentLabel")}>
                  {current.rows.map((r, i) => (
                    <div key={r.memberId} style={{ width: `${r.percentBps / 100}%`, background: SHARE_TONES[i % SHARE_TONES.length] }} />
                  ))}
                </div>
                <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {current.rows.map((r, i) => (
                    <li key={r.memberId} className="flex items-center gap-2">
                      <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: SHARE_TONES[i % SHARE_TONES.length] }} />
                      <span className="font-medium">{name(r.memberId)}</span>
                      <span className="font-bold tabular">{percent(r.percentBps)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {upcoming.length > 0 && !current && <p className="text-xs text-muted-foreground">{t("noCurrent")}</p>}
            <ul className="divide-y rounded-xl border">
              {data.sets.map((set) => (
                <li key={set.validFrom} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="w-28 shrink-0 text-sm font-semibold tabular">{date(set.validFrom)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {set.rows.map((r) => `${name(r.memberId)} ${percent(r.percentBps)}`).join(" · ")}
                  </span>
                  {set.validFrom === data.currentValidFrom && <Badge className="bg-success/15 text-success">{t("current")}</Badge>}
                  {set.validFrom > today && <Badge variant="outline">{t("future")}</Badge>}
                  {canEdit &&
                    (confirming === set.validFrom ? (
                      <InlineConfirm
                        className="w-full"
                        tone="destructive"
                        confirmLabel={t("deleteConfirm")}
                        onConfirm={() => remove(set.validFrom)}
                        onCancel={() => setConfirming(null)}
                        pending={pending}
                      >
                        <p>{t("deleteBody", { date: date(set.validFrom) })}</p>
                      </InlineConfirm>
                    ) : (
                      <span className="flex gap-0.5">
                        <Button variant="ghost" size="icon-sm" aria-label={t("edit")} onClick={() => setSheet({ mode: "edit", set })}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t("delete")} onClick={() => setConfirming(set.validFrom)}>
                          <Trash2 />
                        </Button>
                      </span>
                    ))}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title={t("compensationTitle")} description={t("compensationDescription")} bodyClassName="p-0">
        {memberIds.length === 0 ? (
          <p className="px-5 py-8 text-center text-muted-foreground">{t("compensationEmpty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5 text-xs text-muted-foreground">{t("month")}</TableHead>
                  {memberIds.map((id) => (
                    <TableHead key={id ?? "none"} className="text-right text-xs text-muted-foreground">
                      {name(id)}
                    </TableHead>
                  ))}
                  <TableHead className="pr-5 text-right text-xs text-muted-foreground">{t("total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {months.map((m) => {
                  const total = memberIds.reduce((sum, id) => sum + cell(id, m), 0);
                  return (
                    <TableRow key={m}>
                      <TableCell className="pl-5 capitalize">{month(m)}</TableCell>
                      {memberIds.map((id) => {
                        const value = cell(id, m);
                        return (
                          <TableCell key={id ?? "none"} className={cn("text-right tabular", value === 0 && "text-muted-foreground")}>
                            {value === 0 ? "—" : money(value)}
                          </TableCell>
                        );
                      })}
                      <TableCell className="pr-5 text-right font-semibold tabular">{total === 0 ? "—" : money(total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-5 font-semibold">{t("totalMonths", { count: data.months.length })}</TableCell>
                  {memberIds.map((id) => (
                    <TableCell key={id ?? "none"} className="text-right font-semibold tabular">
                      {money(totalOf(id))}
                    </TableCell>
                  ))}
                  <TableCell className="pr-5 text-right font-bold tabular">{money(memberIds.reduce((sum, id) => sum + totalOf(id), 0))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">{t("compensationNote")}</p>
      </SettingsCard>

      <SettingsSheet
        open={sheet.mode === "edit"}
        onOpenChange={(open) => !open && setSheet({ mode: "closed" })}
        title={sheet.mode === "edit" && sheet.set ? t("editTitle") : t("newTitle")}
        description={t("sheetDescription")}
      >
        {sheet.mode === "edit" && (
          <SharesForm
            slug={slug}
            set={sheet.set}
            members={data.members}
            today={today}
            fallback={current}
            onDone={() => setSheet({ mode: "closed" })}
          />
        )}
      </SettingsSheet>
    </div>
  );
}

function SharesForm({
  slug,
  set,
  members,
  today,
  fallback,
  onDone,
}: {
  slug: string;
  set: ShareholdingSet | null;
  members: PartnersData["members"];
  today: string;
  /** Un reparto nuevo parte del vigente. */
  fallback: ShareholdingSet | null;
  onDone: () => void;
}) {
  const t = useTranslations("finance.partners");
  const tCommon = useTranslations("common");
  const message = useFinanceValidationMessage();
  const { percent } = useFinanceFormat();
  const base = set ?? fallback;
  const form = useForm<ShareholdingsFormInput>({
    resolver: zodResolver(shareholdingsFormSchema),
    defaultValues: {
      valid_from: set?.validFrom ?? today,
      rows: base
        ? base.rows.map((r) => ({ member_id: r.memberId, percent: bpsToInput(r.percentBps) }))
        : members.map((m) => ({ member_id: m.id, percent: members.length > 0 ? bpsToInput(Math.floor(10_000 / members.length)) : "" })),
    },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const { fields, append, remove } = useFieldArray({ control, name: "rows" });
  const rows = useWatch({ control, name: "rows" });
  const total = (rows ?? []).reduce((sum, r) => sum + percentToBps(r.percent ?? ""), 0);

  const submit = form.handleSubmit(async () => {
    const result = await saveShareholdings(slug, getValues(), set?.validFrom ?? null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("saved"));
    onDone();
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : tCommon("save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <FormField id="shares-from" label={t("validFrom")} description={t("validFromHint")} error={message(errors.valid_from?.message)}>
          <Input id="shares-from" type="date" {...register("valid_from")} className="w-44" />
        </FormField>
        <div className="space-y-2">
          {fields.map((f, index) => (
            <div key={f.id} className="flex items-start gap-2">
              <Controller
                control={control}
                name={`rows.${index}.member_id`}
                render={({ field }) => (
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <SelectTrigger className="min-w-0 flex-1" aria-label={t("member")}>
                      <SelectValue placeholder={t("memberPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <div className="w-28">
                <PercentInput aria-label={t("percent")} {...register(`rows.${index}.percent`)} aria-invalid={Boolean(errors.rows?.[index]?.percent)} />
              </div>
              <Button type="button" variant="ghost" size="icon-sm" className="mt-0.5" aria-label={t("removeRow")} onClick={() => remove(index)} disabled={fields.length <= 1}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => append({ member_id: "", percent: "" })} disabled={fields.length >= members.length}>
            <Plus data-icon="inline-start" />
            {t("addRow")}
          </Button>
        </div>
        <p className={cn("rounded-xl border px-3 py-2 text-sm font-semibold tabular", total === 10_000 ? "text-success" : "text-warning")}>
          {t("sum", { total: percent(total) })}
        </p>
        {errors.rows?.root?.message || errors.rows?.message ? (
          <p className="text-xs text-destructive">{message(errors.rows?.root?.message ?? errors.rows?.message)}</p>
        ) : null}
      </div>
    </SheetForm>
  );
}
