"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronRight, History, SlidersHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { hourlyToInput, type MemberCostFormInput, memberCostFormSchema } from "@/app/[org]/finance/profitability/schema";
import { MoneyInput } from "@/components/contracts/inputs";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { FormField } from "@/components/settings/form-field";
import { ReadOnlyNotice, SettingsSectionHeader } from "@/components/settings/settings-card";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CivilDate } from "@/domain/dates/civil-date";
import { costStatus, type ProfitabilitySettings } from "@/domain/profitability";
import { cn } from "@/lib/utils";
import { deleteMemberCost, saveMemberCost } from "@/server/profitability/actions";
import { useProfitabilityFormat } from "./format";
import { ProfitabilitySettingsSheet, useProfitabilityValidationMessage } from "./settings-sheet";
import type { MemberCostsData, MemberCostsMember } from "./types";

/**
 * Coste interno por hora de cada miembro: el vigente hoy, desde cuándo y el próximo cambio. Cada fila
 * abre un panel lateral con el historial y, para un owner, el formulario para cambiarlo desde un día.
 */
export function MemberCostsManager({ slug, data, canEdit }: { slug: string; data: MemberCostsData; canEdit: boolean }) {
  const t = useTranslations("profitability.costs");
  const fmt = useProfitabilityFormat();
  const [openId, setOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const member = data.members.find((m) => m.id === openId) ?? null;
  const head = "text-xs text-muted-foreground";

  return (
    <section id="costs" className="scroll-mt-24">
      <SettingsSectionHeader
        title={t("title")}
        description={t("description")}
        actions={
          canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <SlidersHorizontal data-icon="inline-start" />
              {t("editSettings")}
            </Button>
          ) : undefined
        }
      />
      {!canEdit && <ReadOnlyNotice className="mb-4">{t("readOnly")}</ReadOnlyNotice>}
      <div className="rounded-2xl border bg-card px-2 py-1">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={head}>{t("member")}</TableHead>
              <TableHead className={cn(head, "text-right")}>{t("current")}</TableHead>
              <TableHead className={cn(head, "hidden sm:table-cell")}>{t("since")}</TableHead>
              <TableHead className={cn(head, "hidden md:table-cell")}>{t("next")}</TableHead>
              <TableHead className="w-0">
                <span className="sr-only">{t("history")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((m) => {
              const { current, next } = costStatus(m.history, data.today);
              return (
                <TableRow key={m.id} className="cursor-pointer" onClick={() => setOpenId(m.id)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white",
                          !m.isActive && "opacity-40 grayscale",
                        )}
                      >
                        {m.initials}
                      </span>
                      <span className={cn("font-medium", !m.isActive && "text-muted-foreground")}>{m.fullName}</span>
                      {!m.isActive && (
                        <Badge variant="secondary" className="text-muted-foreground">
                          {t("inactive")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {current ? (
                      <span className="font-semibold tabular">{fmt.rate(current.hourlyCostCents)}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("usesDefault", { amount: fmt.money(data.settings.defaultHourlyCostCents) })}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular sm:table-cell">{current ? fmt.date(current.validFrom) : "—"}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {next ? <span className="tabular">{t("inForceSince", { amount: fmt.money(next.hourlyCostCents), date: fmt.date(next.validFrom) })}</span> : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("open", { name: m.fullName })}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenId(m.id);
                      }}
                    >
                      <ChevronRight />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t("default", { amount: fmt.money(data.settings.defaultHourlyCostCents) })}</p>

      <SettingsSheet
        open={member !== null}
        onOpenChange={(open) => !open && setOpenId(null)}
        title={member ? t("open", { name: member.fullName }) : ""}
        description={t("sheetDescription")}
      >
        {member && <MemberCostPanel slug={slug} member={member} today={data.today} settings={data.settings} canEdit={canEdit} />}
      </SettingsSheet>
      {canEdit && <ProfitabilitySettingsSheet slug={slug} settings={data.settings} open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </section>
  );
}

function MemberCostPanel({
  slug,
  member,
  today,
  settings,
  canEdit,
}: {
  slug: string;
  member: MemberCostsMember;
  today: CivilDate;
  settings: ProfitabilitySettings;
  canEdit: boolean;
}) {
  const t = useTranslations("profitability.costs");
  const fmt = useProfitabilityFormat();
  const { current } = costStatus(member.history, today);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const history = [...member.history].reverse();

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteMemberCost(slug, id);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("deleted"));
      setConfirming(null);
    });

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
      <div className="rounded-xl border bg-muted/40 px-4 py-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t("inForce")}</p>
        <p className="mt-1 text-xl font-bold">
          {current ? fmt.rate(current.hourlyCostCents) : t("noCost")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {current ? t("inForceSince", { amount: fmt.money(current.hourlyCostCents), date: fmt.date(current.validFrom) }) : t("usesDefault", { amount: fmt.money(settings.defaultHourlyCostCents) })}
        </p>
      </div>

      {canEdit && (
        // La key rehace el formulario (limpio) cuando cambia el historial.
        <NewCostForm key={member.history.map((h) => h.id).join(",")} slug={slug} memberId={member.id} today={today} suggested={current?.hourlyCostCents ?? settings.defaultHourlyCostCents} />
      )}

      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <History aria-hidden className="size-4 text-muted-foreground" />
          {t("history")}
        </h4>
        {history.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{t("historyEmpty")}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {history.map((entry) => {
              const inForce = current?.id === entry.id;
              const scheduled = entry.validFrom > today;
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="w-24 shrink-0 text-sm tabular">{fmt.date(entry.validFrom)}</span>
                  <span className="min-w-0 flex-1 font-semibold tabular">{fmt.rate(entry.hourlyCostCents)}</span>
                  {inForce && <Badge className="bg-success/15 text-success">{t("inForce")}</Badge>}
                  {scheduled && <Badge variant="outline">{t("scheduled")}</Badge>}
                  {canEdit &&
                    (confirming === entry.id ? (
                      <InlineConfirm
                        className="w-full"
                        tone="destructive"
                        confirmLabel={t("deleteConfirm")}
                        onConfirm={() => remove(entry.id)}
                        onCancel={() => setConfirming(null)}
                        pending={pending}
                      >
                        <p>{t("deleteBody", { date: fmt.date(entry.validFrom) })}</p>
                      </InlineConfirm>
                    ) : (
                      <Button variant="ghost" size="icon-sm" aria-label={t("delete", { date: fmt.date(entry.validFrom) })} onClick={() => setConfirming(entry.id)}>
                        <Trash2 />
                      </Button>
                    ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewCostForm({ slug, memberId, today, suggested }: { slug: string; memberId: string; today: CivilDate; suggested: number }) {
  const t = useTranslations("profitability.costs");
  const tCommon = useTranslations("common");
  const message = useProfitabilityValidationMessage();
  const form = useForm<MemberCostFormInput>({
    resolver: zodResolver(memberCostFormSchema),
    defaultValues: { member_id: memberId, valid_from: today, hourly_cost: hourlyToInput(suggested) },
    mode: "onTouched",
  });
  const { register, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async (values) => {
    const result = await saveMemberCost(slug, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("saved"));
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border px-4 py-4">
      <h4 className="text-sm font-semibold">{t("newCost")}</h4>
      <input type="hidden" {...register("member_id")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="member-cost-amount" label={t("hourlyCost")} error={message(errors.hourly_cost?.message)}>
          <MoneyInput id="member-cost-amount" {...register("hourly_cost")} aria-invalid={Boolean(errors.hourly_cost)} />
        </FormField>
        <FormField id="member-cost-from" label={t("validFrom")} description={t("validFromHint")} error={message(errors.valid_from?.message)}>
          <Input id="member-cost-from" type="date" {...register("valid_from")} aria-invalid={Boolean(errors.valid_from)} className="tabular" />
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {isSubmitting ? tCommon("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}
