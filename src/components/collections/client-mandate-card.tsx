"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Ban, FileSignature, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { type MandateFormInput, mandateFormSchema } from "@/app/[org]/invoices/remittances/schema";
import { useInvoiceFormat } from "@/components/invoices/format";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { FormField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { suggestMandateReference } from "@/domain/collections";
import { formatIban } from "@/domain/tax-id";
import { deleteClientMandate, revokeClientMandate, saveClientMandate } from "@/server/collections/mandate-actions";
import { cn } from "@/lib/utils";
import { SequenceBadge, useCollectionsValidationMessage } from "./shared";
import type { ClientMandateItem, ClientMandatesData } from "./types";

/**
 * Domiciliación SEPA en la ficha del cliente: sus mandatos firmados (el activo con cada acreedor y
 * el historial de revocados), su secuencia (FRST hasta el primer adeudo) y cuántos cobros llevan.
 * Los datos salen de `getClientMandates(org, clientId)` (src/server/collections/mandates.ts).
 */
export function ClientMandateCard({
  slug,
  basePath,
  clientId,
  data,
  canEdit,
}: {
  slug: string;
  /** `/{slug}` de la org. */
  basePath: string;
  clientId: string;
  data: ClientMandatesData;
  /** Socio u owner (y cliente no archivado): registra, corrige y revoca mandatos. */
  canEdit: boolean;
}) {
  const t = useTranslations("collections.mandates");
  const [editing, setEditing] = useState<ClientMandateItem | "new" | null>(null);
  const active = data.mandates.filter((m) => m.isActive);
  const canAdd = canEdit && data.issuers.length > 0;

  const summary =
    active.length === 0
      ? t("summaryNone")
      : active.length === 1
        ? t("summaryOne", { issuer: active[0]!.issuerName })
        : t("summaryMany", { count: active.length });

  return (
    <SettingsCard
      title={t("title")}
      description={summary}
      bodyClassName={data.mandates.length > 0 ? "p-0" : undefined}
      actions={
        canAdd ? (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            {t("new")}
          </Button>
        ) : undefined
      }
    >
      {data.mandates.length === 0 ? (
        <div className="text-center">
          <FileSignature className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-y">
          {data.mandates.map((m) => (
            <MandateRow
              key={m.id}
              slug={slug}
              basePath={basePath}
              mandate={m}
              creditorReady={data.issuers.find((i) => i.id === m.issuerId)?.creditorReady ?? false}
              canEdit={canEdit}
              onEdit={() => setEditing(m)}
            />
          ))}
        </ul>
      )}
      {canEdit && (
        <SettingsSheet
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          title={editing === "new" ? t("sheetNew") : t("sheetEdit", { reference: editing?.reference ?? "" })}
          description={t("sheetDescription")}
        >
          {editing && (
            <MandateForm
              key={editing === "new" ? "new" : editing.id}
              slug={slug}
              clientId={clientId}
              data={data}
              mandate={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </SettingsSheet>
      )}
    </SettingsCard>
  );
}

function MandateRow({
  slug,
  basePath,
  mandate,
  creditorReady,
  canEdit,
  onEdit,
}: {
  slug: string;
  basePath: string;
  mandate: ClientMandateItem;
  creditorReady: boolean;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const t = useTranslations("collections.mandates");
  const { date } = useInvoiceFormat();
  const [confirm, setConfirm] = useState<"revoke" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const revoke = () =>
    startTransition(async () => {
      const result = await revokeClientMandate(slug, mandate.id, { reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("revokedToast", { reference: mandate.reference }));
      setConfirm(null);
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteClientMandate(slug, mandate.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deletedToast", { reference: mandate.reference }));
      setConfirm(null);
    });

  return (
    <li className={cn("px-5 py-3.5", !mandate.isActive && "text-muted-foreground")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold">{mandate.reference}</span>
            {mandate.isActive ? (
              <Badge className="bg-success/15 text-success">{t("active")}</Badge>
            ) : (
              <Badge className="bg-muted text-muted-foreground">{t("revoked")}</Badge>
            )}
            {mandate.isActive && <SequenceBadge sequence={mandate.nextSequence} />}
          </div>
          <p className="mt-1 text-xs">
            {t("line", { debtor: mandate.debtorName, issuer: mandate.issuerName })}
          </p>
          <p className="mt-0.5 font-mono text-xs">
            {formatIban(mandate.iban)}
            {mandate.bic && <span className="ml-2">{mandate.bic}</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              t("signedOn", { date: date(mandate.signedOn) }),
              mandate.collectionsCount > 0
                ? t("collections", {
                    count: mandate.collectionsCount,
                    date: mandate.lastCollectionOn ? date(mandate.lastCollectionOn) : "",
                  })
                : t("noCollections"),
              mandate.revokedAt ? t("revokedOn", { date: date(mandate.revokedAt.slice(0, 10)) }) : null,
              mandate.revokeReason,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {mandate.notes && <p className="mt-1 text-xs whitespace-pre-line text-muted-foreground">{mandate.notes}</p>}
          {mandate.isActive && !creditorReady && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span>
                {t.rich("creditorNotReady", {
                  link: (chunks) => (
                    <Link href={`${basePath}/invoices/remittances`} className="font-semibold underline-offset-4 hover:underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </span>
            </p>
          )}
        </div>
        {canEdit && confirm === null && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="icon-xs" aria-label={t("edit")} title={t("edit")} onClick={onEdit}>
              <Pencil />
            </Button>
            {mandate.isActive && (
              <Button variant="ghost" size="icon-xs" aria-label={t("revoke")} title={t("revoke")} onClick={() => setConfirm("revoke")}>
                <Ban />
              </Button>
            )}
            {!mandate.inUse && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("delete")}
                title={t("delete")}
                onClick={() => setConfirm("delete")}
                className="hover:text-destructive"
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>
      {confirm === "revoke" && (
        <InlineConfirm
          tone="warning"
          className="mt-3"
          confirmLabel={t("revokeAction")}
          onConfirm={revoke}
          onCancel={() => setConfirm(null)}
          pending={pending}
        >
          <p>{t("revokeConfirm")}</p>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={t("revokeReasonPlaceholder")}
            aria-label={t("revokeReason")}
            className="mt-2 h-7"
          />
        </InlineConfirm>
      )}
      {confirm === "delete" && (
        <InlineConfirm
          tone="destructive"
          className="mt-3"
          confirmLabel={t("deleteAction")}
          onConfirm={remove}
          onCancel={() => setConfirm(null)}
          pending={pending}
        >
          {t("deleteConfirm")}
        </InlineConfirm>
      )}
    </li>
  );
}

function MandateForm({
  slug,
  clientId,
  data,
  mandate,
  onDone,
}: {
  slug: string;
  clientId: string;
  data: ClientMandatesData;
  mandate: ClientMandateItem | null;
  onDone: () => void;
}) {
  const t = useTranslations("collections.mandates");
  const tCommon = useTranslations("common");
  const message = useCollectionsValidationMessage();
  const schema = useMemo(() => mandateFormSchema(data.today), [data.today]);
  const locked = mandate?.inUse ?? false;
  const [suggested, setSuggested] = useState(() => suggestMandateReference(data.clientName, data.today));

  const form = useForm<MandateFormInput>({
    resolver: zodResolver(schema),
    defaultValues: mandate
      ? {
          issuer_id: mandate.issuerId,
          reference: mandate.reference,
          debtor_name: mandate.debtorName,
          iban: formatIban(mandate.iban),
          bic: mandate.bic ?? "",
          signed_on: mandate.signedOn,
          notes: mandate.notes ?? "",
        }
      : {
          issuer_id: data.issuers[0]?.id ?? "",
          reference: suggested,
          debtor_name: data.defaultDebtorName,
          iban: "",
          bic: "",
          signed_on: data.today,
          notes: "",
        },
    mode: "onTouched",
  });
  const { control, register, getValues, setValue, formState } = form;
  const { errors, isSubmitting } = formState;
  const reference = useWatch({ control, name: "reference" });
  const issuerId = useWatch({ control, name: "issuer_id" });
  const creditorReady = data.issuers.find((i) => i.id === issuerId)?.creditorReady ?? false;

  // La referencia propuesta sigue a la fecha de firma mientras nadie la haya cambiado a mano.
  const onSignedOnChange = (value: string) => {
    if (mandate || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const next = suggestMandateReference(data.clientName, value);
    if (reference === suggested) setValue("reference", next, { shouldValidate: true });
    setSuggested(next);
  };

  const submit = form.handleSubmit(async () => {
    const result = await saveClientMandate(slug, clientId, mandate?.id ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(mandate ? t("updatedToast") : t("createdToast"));
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
      <div className="space-y-5">
        {locked && <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{t("locked")}</p>}
        <Controller
          control={control}
          name="issuer_id"
          render={({ field }) => (
            <FormField
              id="mandate-issuer"
              label={t("issuer")}
              description={creditorReady ? t("issuerHint") : <span className="text-warning">{t("issuerNotReady")}</span>}
              error={message(errors.issuer_id?.message)}
            >
              <Select value={field.value} onValueChange={field.onChange} disabled={locked || mandate !== null}>
                <SelectTrigger id="mandate-issuer" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.issuers.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <FormField id="mandate-reference" label={t("reference")} description={t("referenceHint")} error={message(errors.reference?.message)}>
            <Input
              id="mandate-reference"
              {...register("reference")}
              maxLength={35}
              autoComplete="off"
              spellCheck={false}
              disabled={locked}
              aria-invalid={Boolean(errors.reference)}
              className="font-mono"
            />
          </FormField>
          <FormField id="mandate-signed" label={t("signedOnLabel")} error={message(errors.signed_on?.message)}>
            <Input
              id="mandate-signed"
              type="date"
              max={data.today}
              {...register("signed_on", { onChange: (e) => onSignedOnChange(e.target.value) })}
              disabled={locked}
              aria-invalid={Boolean(errors.signed_on)}
              className="tabular"
            />
          </FormField>
        </div>
        <FormField id="mandate-debtor" label={t("debtorName")} description={t("debtorNameHint")} error={message(errors.debtor_name?.message)}>
          <Input id="mandate-debtor" {...register("debtor_name")} maxLength={70} disabled={locked} aria-invalid={Boolean(errors.debtor_name)} />
        </FormField>
        <FormField id="mandate-iban" label={t("iban")} error={message(errors.iban?.message)}>
          <Input
            id="mandate-iban"
            {...register("iban")}
            placeholder="ES00 0000 0000 0000 0000 0000"
            autoComplete="off"
            spellCheck={false}
            disabled={locked}
            aria-invalid={Boolean(errors.iban)}
            className="font-mono"
          />
        </FormField>
        <FormField id="mandate-bic" label={t("bic")} optional description={t("bicHint")} error={message(errors.bic?.message)}>
          <Input
            id="mandate-bic"
            {...register("bic")}
            autoComplete="off"
            spellCheck={false}
            disabled={locked}
            aria-invalid={Boolean(errors.bic)}
            className="font-mono uppercase"
          />
        </FormField>
        <FormField id="mandate-notes" label={t("notes")} optional error={message(errors.notes?.message)}>
          <Textarea id="mandate-notes" {...register("notes")} rows={2} placeholder={t("notesPlaceholder")} />
        </FormField>
      </div>
    </SheetForm>
  );
}
