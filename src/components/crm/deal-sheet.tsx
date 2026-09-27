"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArrowRight, ExternalLink, FileSignature, FileText } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  archiveDeal,
  type DealHistoryEntry,
  getDealHistory,
  saveDeal,
} from "@/app/[org]/pipeline/actions";
import { type DealFormInput, dealFormSchema, type DealFormValues } from "@/app/[org]/pipeline/schema";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { newQuoteHref } from "@/components/quotes/create-quote-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BoardDeal, BoardMember, BoardOption, BoardStage } from "./board-types";
import { ClientPicker } from "./client-picker";

const NONE = "__none__";

function centsToInput(cents: number): string {
  return cents === 0 ? "" : String(cents / 100).replace(".", ",");
}

export type DealSheetProps = {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Deal a editar; sin él, se crea uno nuevo. */
  deal: BoardDeal | null;
  defaults: { clientId?: string; stageId?: string };
  stages: BoardStage[];
  clients: BoardOption[];
  sources: BoardOption[];
  lossReasons: BoardOption[];
  members: BoardMember[];
  currentMemberId: string;
  canEdit: boolean;
  /** Tras guardar: el tablero salta a la columna del deal y lo resalta. */
  onSaved?: (dealId: string, stageId: string) => void;
};

export function DealSheet(props: DealSheetProps) {
  const t = useTranslations("pipeline.sheet");
  return (
    <SettingsSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.deal ? t("editTitle") : t("createTitle")}
      description={props.deal ? undefined : t("description")}
    >
      {/* Se monta al abrir: cada apertura empieza con el formulario limpio. */}
      {props.open && <DealForm key={props.deal?.id ?? "new"} {...props} />}
    </SettingsSheet>
  );
}

function DealForm({
  slug,
  onOpenChange,
  onSaved,
  deal,
  defaults,
  stages,
  clients,
  sources,
  lossReasons,
  members,
  currentMemberId,
  canEdit,
}: DealSheetProps) {
  const t = useTranslations("pipeline.sheet");
  const tErrors = useTranslations("pipeline.errors");
  const tCommon = useTranslations("common");
  const validation = useValidationMessage();
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [history, setHistory] = useState<DealHistoryEntry[] | null>(null);

  const firstStage = stages.find((s) => s.kind === "open") ?? stages[0];
  const form = useForm<DealFormInput, unknown, DealFormValues>({
    resolver: zodResolver(dealFormSchema),
    defaultValues: {
      title: deal?.title ?? "",
      client_id: deal?.clientId ?? defaults.clientId ?? "",
      new_client_name: "",
      stage_id: deal?.stageId ?? defaults.stageId ?? firstStage?.id ?? "",
      est_one_off: centsToInput(deal?.estOneOffCents ?? 0),
      est_mrr: centsToInput(deal?.estMrrCents ?? 0),
      probability: deal?.probabilityOverrideBps != null ? String(deal.probabilityOverrideBps / 100) : "",
      source_id: deal?.sourceId ?? "",
      brought_by_member_id: deal?.broughtById ?? (deal ? "" : currentMemberId),
      owner_member_id: deal?.ownerId ?? (deal ? "" : currentMemberId),
      next_action: deal?.nextAction ?? "",
      next_action_on: deal?.nextActionOn ?? "",
      loss_reason_id: deal?.lossReasonId ?? "",
      loss_note: deal?.lossNote ?? "",
    },
  });
  const { errors } = form.formState;
  const stageId = useWatch({ control: form.control, name: "stage_id" });
  // Con useWatch (no getValues): al elegir «Crear cliente …» el selector tiene que volver a pintarse
  // con el nombre nuevo; antes se quedaba en blanco y parecía que no había cogido nada.
  const newClientName = useWatch({ control: form.control, name: "new_client_name" }) ?? "";
  const stage = stages.find((s) => s.id === stageId);
  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name ?? "—";

  // El historial se pide al abrir un deal existente.
  useEffect(() => {
    if (!deal) return;
    let alive = true;
    void getDealHistory(slug, deal.id).then((h) => alive && setHistory(h));
    return () => {
      alive = false;
    };
  }, [slug, deal]);

  const message = (key: string | undefined) => (key && tErrors.has(key) ? tErrors(key) : validation(key));

  const submit = form.handleSubmit((values) =>
    startTransition(async () => {
      const result = await saveDeal(slug, deal?.id ?? null, values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(deal ? t("saved") : t("created"));
      onSaved?.(result.id, values.stage_id);
      onOpenChange(false);
    }),
  );

  function onArchive() {
    if (!deal) return;
    startTransition(async () => {
      const result = await archiveDeal(slug, deal.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("archived"));
      setConfirmArchive(false);
      onOpenChange(false);
    });
  }

  const optionalSelect = (
    name: "source_id" | "brought_by_member_id" | "owner_member_id" | "loss_reason_id",
    options: { id: string; label: string }[],
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Select
          value={field.value || NONE}
          onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
          disabled={!canEdit}
        >
          <SelectTrigger id={name} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("none")}</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );

  const memberOptions = members.map((m) => ({ id: m.id, label: `${m.fullName} · ${m.initials}` }));

  return (
    <SheetForm
        onSubmit={submit}
        footer={
          confirmArchive ? (
            // Confirmación en línea: nunca un modal encima del panel.
            <>
              <p className="mr-auto text-xs text-muted-foreground">{t("archiveConfirm")}</p>
              <Button type="button" variant="ghost" onClick={() => setConfirmArchive(false)} disabled={pending}>
                {tCommon("cancel")}
              </Button>
              <Button type="button" variant="destructive" onClick={onArchive} disabled={pending}>
                {t("archive")}
              </Button>
            </>
          ) : (
            <>
              {deal && canEdit && (
                <Button type="button" variant="ghost" className="mr-auto" onClick={() => setConfirmArchive(true)}>
                  <Archive data-icon="inline-start" />
                  {t("archive")}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              {canEdit && (
                <Button type="submit" disabled={pending}>
                  {pending ? tCommon("saving") : deal ? t("save") : t("create")}
                </Button>
              )}
            </>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="title" label={t("title")} error={message(errors.title?.message)} className="sm:col-span-2">
            <Input
              id="title"
              autoFocus={!deal}
              placeholder={t("titlePlaceholder")}
              disabled={!canEdit}
              {...form.register("title")}
            />
          </FormField>

          <FormField label={t("client")} error={message(errors.client_id?.message)} className="sm:col-span-2">
            <Controller
              control={form.control}
              name="client_id"
              render={({ field }) => (
                <ClientPicker
                  clients={clients}
                  clientId={field.value}
                  newClientName={newClientName}
                  invalid={Boolean(errors.client_id)}
                  disabled={!canEdit}
                  onChange={({ clientId, newClientName: typed }) => {
                    form.setValue("new_client_name", typed, { shouldValidate: form.formState.isSubmitted });
                    field.onChange(clientId);
                  }}
                />
              )}
            />
            {deal && (
              <Link
                href={`/${slug}/clients/${deal.clientId}`}
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                {t("openClient")}
                <ExternalLink className="size-3" />
              </Link>
            )}
          </FormField>

          <FormField id="stage_id" label={t("stage")}>
            <Controller
              control={form.control}
              name="stage_id"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                  <SelectTrigger id="stage_id" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          <FormField
            id="probability"
            label={t("probability")}
            optional
            error={message(errors.probability?.message)}
            description={t("probabilityHint", { value: Math.round((stage?.defaultProbabilityBps ?? 0) / 100) })}
          >
            <div className="relative">
              <Input
                id="probability"
                inputMode="decimal"
                className="pr-7 text-right tabular"
                disabled={!canEdit}
                {...form.register("probability")}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </FormField>

          <FormField id="est_one_off" label={t("oneOff")} error={message(errors.est_one_off?.message)} description={t("oneOffHint")}>
            <MoneyInput id="est_one_off" disabled={!canEdit} {...form.register("est_one_off")} />
          </FormField>
          <FormField id="est_mrr" label={t("mrr")} error={message(errors.est_mrr?.message)} description={t("mrrHint")}>
            <MoneyInput id="est_mrr" disabled={!canEdit} {...form.register("est_mrr")} />
          </FormField>

          <FormField id="source_id" label={t("source")}>
            {optionalSelect("source_id", sources.map((s) => ({ id: s.id, label: s.name })))}
          </FormField>
          <FormField id="brought_by_member_id" label={t("broughtBy")}>
            {optionalSelect("brought_by_member_id", memberOptions)}
          </FormField>
          <FormField id="owner_member_id" label={t("owner")}>
            {optionalSelect("owner_member_id", memberOptions)}
          </FormField>
          <FormField id="next_action_on" label={t("nextActionOn")} optional>
            <Input id="next_action_on" type="date" disabled={!canEdit} {...form.register("next_action_on")} />
          </FormField>
          <FormField id="next_action" label={t("nextAction")} optional className="sm:col-span-2">
            <Input
              id="next_action"
              placeholder={t("nextActionPlaceholder")}
              disabled={!canEdit}
              {...form.register("next_action")}
            />
          </FormField>

          {stage?.kind === "lost" && (
            <>
              <FormField id="loss_reason_id" label={t("lossReason")} className="sm:col-span-2">
                {optionalSelect("loss_reason_id", lossReasons.map((r) => ({ id: r.id, label: r.name })))}
              </FormField>
              <FormField id="loss_note" label={t("lossNote")} optional className="sm:col-span-2">
                <Textarea id="loss_note" rows={2} disabled={!canEdit} {...form.register("loss_note")} />
              </FormField>
            </>
          )}
        </div>

        {deal && canEdit && (
          <section className="mt-8 border-t pt-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("nextStep")}</h3>
            <div className="flex flex-wrap gap-2">
              {stage?.kind !== "lost" && (
                <Button asChild variant="outline" size="sm">
                  <Link href={newQuoteHref(slug, { dealId: deal.id, clientId: deal.clientId })}>
                    <FileText data-icon="inline-start" />
                    {t("createQuote")}
                  </Link>
                </Button>
              )}
              {stage?.kind === "won" && (
                <Button asChild size="sm">
                  <Link href={`/${slug}/contracts?new=1&client=${deal.clientId}&deal=${deal.id}`}>
                    <FileSignature data-icon="inline-start" />
                    {t("createContract")}
                  </Link>
                </Button>
              )}
            </div>
          </section>
        )}

        {deal && history && history.length > 0 && (
          <section className="mt-8 border-t pt-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("history")}</h3>
            <ol className="space-y-2.5 text-sm">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground tabular">
                    {format.dateTime(new Date(h.at), { day: "numeric", month: "short", year: "2-digit" })}
                  </span>
                  {h.fromStageId ? (
                    <span className="flex items-center gap-1.5">
                      {stageName(h.fromStageId)}
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span className="font-semibold">{stageName(h.toStageId)}</span>
                    </span>
                  ) : (
                    <span>{t("historyCreated", { stage: stageName(h.toStageId) })}</span>
                  )}
                  {h.byInitials && <span className="ml-auto text-xs text-muted-foreground">{h.byInitials}</span>}
                </li>
              ))}
            </ol>
          </section>
        )}
    </SheetForm>
  );
}

function MoneyInput(props: React.ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Input inputMode="decimal" placeholder="0" className="pr-7 text-right tabular" {...props} />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">€</span>
    </div>
  );
}
