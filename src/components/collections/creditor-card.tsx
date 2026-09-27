"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, Info, Landmark, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { saveCreditor } from "@/app/[org]/invoices/remittances/actions";
import { type CreditorFormInput, creditorFormSchema } from "@/app/[org]/invoices/remittances/schema";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { DetailItem, ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatCreditorId,
  isValidBusinessCode,
  normalizeBusinessCode,
  normalizeCreditorId,
  parseCreditorId,
  proposeSpanishCreditorId,
} from "@/domain/collections";
import { formatIban } from "@/domain/tax-id";
import { cn } from "@/lib/utils";
import { IssueList, useCollectionsValidationMessage } from "./shared";
import type { CreditorSummary } from "./types";

/**
 * Datos de acreedor SEPA de cada emisor: el identificador (ICS) con el que cobra, el nombre y la
 * cuenta de abono. Sin un ICS confirmado con el banco no se generan remesas, pero todo lo demás
 * (mandatos, selección, vista previa) funciona igual.
 */
export function CreditorsCard({ slug, creditors, canEdit }: { slug: string; creditors: CreditorSummary[]; canEdit: boolean }) {
  const t = useTranslations("collections.creditor");
  const [editing, setEditing] = useState<CreditorSummary | null>(null);
  const anyUnconfirmed = creditors.some((c) => c.source !== "confirmed");

  return (
    <SettingsCard title={t("title")} description={t("description")} bodyClassName="p-0">
      {creditors.length === 0 ? (
        <p className="px-5 py-6 text-center text-muted-foreground">{t("noIssuers")}</p>
      ) : (
        <ul className="divide-y">
          {creditors.map((c) => (
            <CreditorRow key={c.issuerId} creditor={c} canEdit={canEdit} onEdit={() => setEditing(c)} />
          ))}
        </ul>
      )}
      {anyUnconfirmed && (
        <div className="flex items-start gap-2.5 border-t bg-muted/30 px-5 py-3 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0 text-primary" />
          <p>{t.rich("howToGet", { strong: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong> })}</p>
        </div>
      )}
      {!canEdit && <ReadOnlyNotice className="border-t px-5 py-3">{t("ownerOnly")}</ReadOnlyNotice>}
      {canEdit && (
        <SettingsSheet
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          title={t("sheetTitle", { issuer: editing?.issuerName ?? "" })}
          description={t("sheetDescription")}
        >
          {editing && <CreditorForm key={editing.issuerId} slug={slug} creditor={editing} onDone={() => setEditing(null)} />}
        </SettingsSheet>
      )}
    </SettingsCard>
  );
}

function CreditorRow({ creditor, canEdit, onEdit }: { creditor: CreditorSummary; canEdit: boolean; onEdit: () => void }) {
  const t = useTranslations("collections.creditor");
  const { config } = creditor;
  const otherIssues = creditor.issues.filter((i) => i !== "creditorIdUnconfirmed");
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold">
            <Landmark className="size-4 text-muted-foreground" />
            {creditor.issuerName}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{creditor.creditorId ? formatCreditorId(creditor.creditorId) : "—"}</span>
            <CreditorIdBadge source={creditor.source} />
          </div>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil data-icon="inline-start" />
            {creditor.source === "confirmed" ? t("edit") : t("configure")}
          </Button>
        )}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
        <DetailItem label={t("name")}>{config.name || "—"}</DetailItem>
        <DetailItem label={t("iban")}>
          <span className="font-mono">{config.iban ? formatIban(config.iban) : "—"}</span>
        </DetailItem>
        <DetailItem label={t("bic")}>
          <span className="font-mono">{config.bic || t("bicNone")}</span>
        </DetailItem>
      </dl>
      <IssueList issues={otherIssues} className="mt-2" />
    </li>
  );
}

/** De dónde sale el ICS: confirmado con el banco, guardado sin confirmar o calculado del NIF. */
export function CreditorIdBadge({ source }: { source: CreditorSummary["source"] }) {
  const t = useTranslations("collections.creditor.source");
  if (source === "confirmed") {
    return (
      <Badge className="bg-success/15 text-success">
        <BadgeCheck />
        {t("confirmed")}
      </Badge>
    );
  }
  return (
    <Badge className={cn(source ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive")}>
      {t(source ?? "missing")}
    </Badge>
  );
}

function initialBusinessCode(creditor: CreditorSummary): string {
  const parts = creditor.stored.creditorId ? parseCreditorId(creditor.stored.creditorId) : null;
  return parts?.countryCode === "ES" ? parts.businessCode : "000";
}

function CreditorForm({ slug, creditor, onDone }: { slug: string; creditor: CreditorSummary; onDone: () => void }) {
  const t = useTranslations("collections.creditor");
  const tCommon = useTranslations("common");
  const message = useCollectionsValidationMessage();
  const [businessCode, setBusinessCode] = useState(() => initialBusinessCode(creditor));
  const propose = (code: string) =>
    creditor.issuerTaxId && isValidBusinessCode(code) ? proposeSpanishCreditorId(creditor.issuerTaxId, code) : null;
  const proposal = propose(businessCode);

  const form = useForm<CreditorFormInput>({
    resolver: zodResolver(creditorFormSchema),
    defaultValues: {
      creditor_id: creditor.stored.creditorId ?? proposal ?? "",
      confirmed: creditor.stored.confirmedAt !== null,
      name: creditor.stored.name ?? "",
      iban: creditor.stored.iban ? formatIban(creditor.stored.iban) : "",
      bic: creditor.stored.bic ?? "",
    },
    mode: "onTouched",
  });
  const { control, register, getValues, setValue, formState } = form;
  const { errors, isSubmitting } = formState;
  const creditorId = useWatch({ control, name: "creditor_id" }) ?? "";
  const isProposal = proposal !== null && normalizeCreditorId(creditorId) === proposal;

  const onBusinessCodeChange = (value: string) => {
    const code = normalizeBusinessCode(value).slice(0, 3);
    const next = propose(code);
    // El ICS sigue al sufijo mientras sea el calculado (o esté vacío); uno escrito a mano no se pisa.
    if (next && (isProposal || creditorId.trim() === "")) setValue("creditor_id", next, { shouldValidate: true, shouldDirty: true });
    setBusinessCode(code);
  };

  const submit = form.handleSubmit(async () => {
    const result = await saveCreditor(slug, creditor.issuerId, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("savedToast"));
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
        <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">{creditor.issuerLegalName}</p>
          <p className="mt-0.5">
            {creditor.issuerTaxId ? t("taxId", { taxId: creditor.issuerTaxId }) : t("noTaxId")}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <FormField id="creditor-suffix" label={t("businessCode")} description={t("businessCodeHint")}>
            <Input
              id="creditor-suffix"
              value={businessCode}
              onChange={(e) => onBusinessCodeChange(e.target.value)}
              maxLength={3}
              autoComplete="off"
              className="font-mono uppercase"
              disabled={!creditor.issuerTaxId}
            />
          </FormField>
          <FormField
            id="creditor-id"
            label={t("creditorId")}
            description={isProposal ? <span className="text-warning">{t("proposedHint")}</span> : t("creditorIdHint")}
            error={message(errors.creditor_id?.message)}
          >
            <Input
              id="creditor-id"
              {...register("creditor_id")}
              autoComplete="off"
              spellCheck={false}
              placeholder="ES00000B00000000"
              aria-invalid={Boolean(errors.creditor_id)}
              className="font-mono uppercase"
            />
          </FormField>
        </div>

        <Controller
          control={control}
          name="confirmed"
          render={({ field }) => (
            <ToggleField
              id="creditor-confirmed"
              control="checkbox"
              label={t("confirmed")}
              description={t("confirmedHint")}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />

        <FormField id="creditor-name" label={t("name")} optional description={t("nameHint")} error={message(errors.name?.message)}>
          <Input id="creditor-name" {...register("name")} placeholder={creditor.issuerLegalName} autoComplete="off" />
        </FormField>
        <FormField id="creditor-iban" label={t("iban")} optional description={t("ibanHint")} error={message(errors.iban?.message)}>
          <Input
            id="creditor-iban"
            {...register("iban")}
            placeholder={creditor.issuerIban ? formatIban(creditor.issuerIban) : "ES00 0000 0000 0000 0000 0000"}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.iban)}
            className="font-mono"
          />
        </FormField>
        <FormField id="creditor-bic" label={t("bic")} optional description={t("bicHint")} error={message(errors.bic?.message)}>
          <Input
            id="creditor-bic"
            {...register("bic")}
            placeholder="CAIXESBBXXX"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(errors.bic)}
            className="font-mono uppercase"
          />
        </FormField>
      </div>
    </SheetForm>
  );
}
