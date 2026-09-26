"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import type { KeyboardEvent } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { createActivity } from "@/app/[org]/clients/actions";
import { ACTIVITY_KINDS, type ActivityFormInput, activityFormSchema } from "@/app/[org]/clients/schema";
import { FormField } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ACTIVITY_ICONS } from "./activity-icons";
import { useClientValidationMessage } from "./validation";

const NONE = "none";

export type ActivityOption = { id: string; label: string };

type ActivitySheetProps = {
  slug: string;
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hora de pared de la org al abrir el panel (YYYY-MM-DDTHH:mm). */
  defaultOccurredAt: string;
  deals: ActivityOption[];
  contacts: ActivityOption[];
};

/** "Registrar actividad": llamada, reunión, email o nota, opcionalmente ligada a un deal y a un contacto. */
export function ActivitySheet({ open, onOpenChange, ...props }: ActivitySheetProps) {
  const t = useTranslations("clients.activity");
  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={t("sheetTitle")} description={t("sheetDescription")}>
      <ActivityForm {...props} onDone={() => onOpenChange(false)} />
    </SettingsSheet>
  );
}

function ActivityForm({
  slug,
  clientId,
  defaultOccurredAt,
  deals,
  contacts,
  onDone,
}: Omit<ActivitySheetProps, "open" | "onOpenChange"> & { onDone: () => void }) {
  const t = useTranslations("clients.activity");
  const tKind = useTranslations("crm.activityKind");
  const tCommon = useTranslations("common");
  const message = useClientValidationMessage();
  const form = useForm<ActivityFormInput>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { kind: "note", title: "", body: "", occurred_at: defaultOccurredAt, deal_id: "", contact_id: "" },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;
  const kind = useWatch({ control, name: "kind" });

  const submit = form.handleSubmit(async () => {
    const result = await createActivity(slug, clientId, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("createdToast"));
    onDone();
  });

  // ⌘↵ / Ctrl+↵ guarda desde cualquier campo, también desde las notas.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !isSubmitting) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <KbdGroup className="mr-auto hidden text-xs text-muted-foreground sm:inline-flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : t("submit")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2" onKeyDown={onKeyDown}>
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <div role="radiogroup" aria-label={t("kind")} className="grid grid-cols-4 gap-1 rounded-xl border bg-muted/40 p-1 sm:col-span-2">
              {ACTIVITY_KINDS.map((k) => {
                const Icon = ACTIVITY_ICONS[k];
                const checked = field.value === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => field.onChange(k)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                      checked && "bg-background text-foreground shadow-sm",
                    )}
                  >
                    <Icon className={cn("size-3.5", checked && "text-primary")} />
                    {tKind(k)}
                  </button>
                );
              })}
            </div>
          )}
        />

        <FormField id="activity-title" label={t("fieldTitle")} className="sm:col-span-2" error={message(errors.title?.message)}>
          <Input
            id="activity-title"
            placeholder={t(`titlePlaceholder.${kind}`)}
            aria-invalid={Boolean(errors.title)}
            autoFocus
            {...register("title")}
          />
        </FormField>

        <FormField
          id="activity-body"
          label={t("fieldBody")}
          optional
          description={t("bodyHint")}
          className="sm:col-span-2"
          error={message(errors.body?.message)}
        >
          <Textarea id="activity-body" rows={6} aria-invalid={Boolean(errors.body)} {...register("body")} />
        </FormField>

        <FormField id="activity-at" label={t("occurredAt")} error={message(errors.occurred_at?.message)}>
          <Input
            id="activity-at"
            type="datetime-local"
            className="tabular"
            aria-invalid={Boolean(errors.occurred_at)}
            {...register("occurred_at")}
          />
        </FormField>

        {deals.length > 0 && (
          <Controller
            control={control}
            name="deal_id"
            render={({ field }) => (
              <FormField id="activity-deal" label={t("deal")} optional>
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger id="activity-deal" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("noDeal")}</SelectItem>
                    {deals.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        )}

        {contacts.length > 0 && (
          <Controller
            control={control}
            name="contact_id"
            render={({ field }) => (
              <FormField id="activity-contact" label={t("contact")} optional>
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger id="activity-contact" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("noContact")}</SelectItem>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        )}
      </div>
    </SheetForm>
  );
}
