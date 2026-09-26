"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClock, ExternalLink, Flag, Pencil, Receipt } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { billContractMilestone, saveMilestones } from "@/app/[org]/contracts/actions";
import { bpsToPercentInput, type MilestonesSheetInput, milestonesSheetSchema } from "@/app/[org]/contracts/schema";
import { SettingsCard } from "@/components/settings/settings-card";
import { SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useContractFormat } from "./format";
import { ContractSheet } from "./inputs";
import { MilestoneFields } from "./milestone-fields";
import { BillableStateBadge } from "./status-badges";
import type { ContractDetailData } from "./types";

/**
 * Hitos de lo puntual: cuánto factura cada uno y si ya se ha facturado. Se facturan en orden;
 * el siguiente se factura con un clic y el borrador queda listo para revisar y emitir.
 */
export function MilestonesCard({ data, onEdit }: { data: ContractDetailData; onEdit: () => void }) {
  const t = useTranslations("contracts.milestones");
  const fmt = useContractFormat();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { milestones, basePath, slug, canEdit } = data;
  const signed = data.contract.signedOn !== null;
  const billedCount = milestones.filter((m) => m.state !== null).length;
  // Sin líneas puntuales no hay nada que repartir: no se ofrece facturar.
  const hasOneOff = data.lines.some((l) => l.billingType === "one_off");

  const bill = (milestoneId: string, label: string) =>
    startTransition(async () => {
      const result = await billContractMilestone(slug, milestoneId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const href = `${basePath}/invoices/${result.invoiceId}`;
      toast.success(t("billedToast", { label }), {
        description: t("billedToastBody"),
        action: { label: t("openDraft"), onClick: () => router.push(href) },
      });
    });

  return (
    <SettingsCard
      title={t("title")}
      description={
        milestones.length === 0 ? t("emptyDescription") : t("summary", { count: milestones.length, billed: billedCount })
      }
      actions={
        canEdit ? (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil data-icon="inline-start" />
            {milestones.length === 0 ? t("define") : t("edit")}
          </Button>
        ) : undefined
      }
      bodyClassName={milestones.length > 0 ? "p-0" : undefined}
    >
      {milestones.length === 0 ? (
        <div className="text-center">
          <Flag className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onEdit}>
              {t("define")}
            </Button>
          )}
        </div>
      ) : (
        <ol className="divide-y">
          {milestones.map((m, index) => {
            const isNext = m.id === data.nextMilestoneId;
            return (
              <li key={m.id} className={cn("flex items-center gap-3 px-5 py-3", m.state === null && !isNext && "text-muted-foreground")}>
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold tabular",
                    m.state === "invoiced" && "border-success/40 bg-success/15 text-success",
                    isNext && "border-primary/40 bg-primary/15 text-primary",
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{m.label}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular">{fmt.percent(m.percentBps)}</span>
                    {m.plannedOn && (
                      <span className="flex items-center gap-1 tabular">
                        <CalendarClock className="size-3" />
                        {fmt.date(m.plannedOn)}
                      </span>
                    )}
                    {m.auto && m.state === null && <Badge variant="outline">{t("autoBadge")}</Badge>}
                    {m.state && <BillableStateBadge state={m.state} />}
                    {m.invoiceId && (
                      <Link
                        href={`${basePath}/invoices/${m.invoiceId}`}
                        className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                      >
                        <Receipt className="size-3" />
                        {m.invoiceNumber ?? t("draft")}
                      </Link>
                    )}
                  </div>
                </div>
                <p className="shrink-0 text-right font-semibold text-foreground tabular">
                  {m.amountCents === null ? "—" : fmt.money(m.amountCents)}
                </p>
                {/* Un botón desactivado no lanza eventos: el aviso va en el envoltorio. */}
                {isNext && canEdit && hasOneOff && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={signed ? -1 : 0}>
                        <Button size="sm" onClick={() => bill(m.id, m.label)} disabled={!signed || pending}>
                          {pending ? t("billing") : t("bill")}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{signed ? t("billHint") : t("billUnsigned")}</TooltipContent>
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {milestones.some((m) => m.invoiceId) && (
        <p className="flex items-center gap-1.5 border-t px-5 py-2.5 text-xs text-muted-foreground">
          <ExternalLink className="size-3" />
          {t("invoicesHint")}
        </p>
      )}
    </SettingsCard>
  );
}

/** Editor de hitos: todos a la vez, y el total tiene que ser exactamente el 100 %. */
export function MilestonesSheet({
  data,
  open,
  onOpenChange,
}: {
  data: ContractDetailData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("contracts.milestones");
  return (
    <ContractSheet open={open} onOpenChange={onOpenChange} title={t("sheetTitle")} description={t("sheetDescription")} wide>
      <MilestonesForm data={data} onDone={() => onOpenChange(false)} />
    </ContractSheet>
  );
}

function MilestonesForm({ data, onDone }: { data: ContractDetailData; onDone: () => void }) {
  const t = useTranslations("contracts.milestones");
  const tCommon = useTranslations("common");
  const oneOffLines = data.lines.filter((l) => l.billingType === "one_off");
  const locked = new Set(data.milestones.filter((m) => m.state !== null).map((m) => m.id));
  const form = useForm<MilestonesSheetInput>({
    resolver: zodResolver(milestonesSheetSchema(oneOffLines.length > 0)),
    defaultValues: {
      milestones:
        data.milestones.length > 0
          ? data.milestones.map((m) => ({
              id: m.id,
              label: m.label,
              percent: bpsToPercentInput(m.percentBps),
              planned_on: m.plannedOn ?? "",
              auto: m.auto,
            }))
          : [{ id: "", label: t("presetLabels.signature"), percent: "100", planned_on: "", auto: false }],
    },
    mode: "onTouched",
  });
  const { getValues, formState } = form;

  const submit = form.handleSubmit(async () => {
    const result = await saveMilestones(data.slug, data.contract.id, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("savedToast"));
    onDone();
  });

  return (
    <FormProvider {...form}>
      <SheetForm
        onSubmit={submit}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onDone} disabled={formState.isSubmitting}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? tCommon("saving") : tCommon("save")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("sheetExplain")}</p>
          {locked.size > 0 && <p className="rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">{t("lockedExplain")}</p>}
          <MilestoneFields oneOffBases={oneOffLines.map((l) => ({ id: l.id, baseCents: l.baseCents }))} locked={locked} />
        </div>
      </SheetForm>
    </FormProvider>
  );
}
