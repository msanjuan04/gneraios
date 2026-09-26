"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Send, UserPlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { FormField, useValidationMessage } from "@/components/settings/form-field";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { InviteDelivery } from "@/server/invitations";
import { inviteMember, resendInvitation, revokeInvitation } from "./actions";
import { type InvitationInput, invitationSchema, ROLES } from "./schema";

/** Toast según haya salido o no el email de la invitación. */
function useDeliveryToast() {
  const t = useTranslations("settings.team");
  return (delivery: InviteDelivery, email: string) => {
    if (delivery === "sent") toast.success(t("inviteSent", { email }));
    else if (delivery === "not_configured") toast.info(t("inviteCreatedNoEmail"));
    else toast.warning(t("inviteFailed"));
  };
}

/** "Invitar": panel lateral con email, nombre y rol. */
export function InviteButton({ slug }: { slug: string }) {
  const t = useTranslations("settings.team");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus data-icon="inline-start" />
        {t("invite")}
      </Button>
      <SettingsSheet open={open} onOpenChange={setOpen} title={t("inviteTitle")} description={t("inviteDescription")}>
        <InviteForm slug={slug} onDone={() => setOpen(false)} />
      </SettingsSheet>
    </>
  );
}

function InviteForm({ slug, onDone }: { slug: string; onDone: () => void }) {
  const t = useTranslations("settings.team");
  const tRoles = useTranslations("roles");
  const tHints = useTranslations("roleHints");
  const tCommon = useTranslations("common");
  const message = useValidationMessage();
  const deliveryToast = useDeliveryToast();
  const form = useForm<InvitationInput>({
    resolver: zodResolver(invitationSchema),
    defaultValues: { email: "", full_name: "", role: "partner" },
    mode: "onTouched",
  });
  const { control, register, formState } = form;
  const { errors, isSubmitting } = formState;
  const role = useWatch({ control, name: "role" });

  const submit = form.handleSubmit(async () => {
    const result = await inviteMember(slug, form.getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    deliveryToast(result.delivery, result.email);
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
            <Send data-icon="inline-start" />
            {t("inviteSubmit")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <FormField id="invite-email" label={t("email")} error={message(errors.email?.message)}>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            autoFocus
            placeholder={t("emailPlaceholder")}
            aria-invalid={Boolean(errors.email)}
            {...register("email", { setValueAs: (value: string) => value.trim() })}
          />
        </FormField>
        <FormField id="invite-name" label={t("name")} optional error={message(errors.full_name?.message)}>
          <Input id="invite-name" autoComplete="off" aria-invalid={Boolean(errors.full_name)} {...register("full_name")} />
        </FormField>
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <FormField id="invite-role" label={t("role")} description={tHints(role)}>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {tRoles(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
      </div>
    </SheetForm>
  );
}

/** Reenviar (alarga la caducidad) o retirar una invitación pendiente. */
export function InvitationActions({ slug, invitationId }: { slug: string; invitationId: string }) {
  const t = useTranslations("settings.team");
  const deliveryToast = useDeliveryToast();
  const [pending, startTransition] = useTransition();

  const resend = () =>
    startTransition(async () => {
      const result = await resendInvitation(slug, invitationId);
      if (!result.ok) toast.error(result.error);
      else deliveryToast(result.delivery, result.email);
    });

  const revoke = () =>
    startTransition(async () => {
      const result = await revokeInvitation(slug, invitationId);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("inviteRevoked"));
    });

  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="sm" onClick={resend} disabled={pending}>
        <Send data-icon="inline-start" />
        {t("resend")}
      </Button>
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={revoke} disabled={pending}>
        <X data-icon="inline-start" />
        {t("revoke")}
      </Button>
    </div>
  );
}
