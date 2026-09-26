"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, Mail, Pencil, Phone, Plus, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { archiveContact, saveContact } from "@/app/[org]/clients/actions";
import { contactFormDefaults, type ContactFormInput, contactFormSchema, type ContactRow } from "@/app/[org]/clients/schema";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { FormField, ToggleField } from "@/components/settings/form-field";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { initialsFrom } from "@/domain/people";
import { useClientValidationMessage } from "./validation";

type Props = {
  slug: string;
  clientId: string;
  contacts: ContactRow[];
  canEdit: boolean;
};

/** `tel:` sin espacios ni paréntesis: "+34 600 00 00 00" → "+34600000000". */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** Contactos del cliente: los emails viven aquí, y las facturas van a los marcados como facturación. */
export function ContactsCard({ slug, clientId, contacts, canEdit }: Props) {
  const t = useTranslations("clients.contacts");
  const tCommon = useTranslations("common");
  // El contacto se conserva al cerrar para que el título no cambie durante la animación de salida.
  const [sheet, setSheet] = useState<{ open: boolean; contact: ContactRow | null }>({ open: false, contact: null });
  const [archiving, setArchiving] = useState<{ open: boolean; contact: ContactRow | null }>({ open: false, contact: null });
  const [pending, startTransition] = useTransition();
  const primary = contacts.find((c) => c.is_primary) ?? null;
  const editingContact = sheet.contact ?? undefined;

  const openSheet = (contact: ContactRow | null) => setSheet({ open: true, contact });
  const closeSheet = () => setSheet((s) => ({ ...s, open: false }));

  const confirmArchive = () =>
    startTransition(async () => {
      const contact = archiving.contact;
      if (!contact) return;
      const result = await archiveContact(slug, clientId, contact.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("archivedToast", { name: contact.full_name }));
      setArchiving((a) => ({ ...a, open: false }));
    });

  return (
    <SettingsCard
      title={t("title")}
      description={contacts.length > 0 ? t("count", { count: contacts.length }) : undefined}
      actions={
        canEdit ? (
          <Button variant="outline" size="sm" onClick={() => openSheet(null)}>
            <Plus data-icon="inline-start" />
            {tCommon("add")}
          </Button>
        ) : undefined
      }
      bodyClassName={contacts.length > 0 ? "px-5 py-1" : undefined}
    >
      {contacts.length === 0 ? (
        <div className="text-center">
          <UserRound className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => openSheet(null)}>
              <Plus data-icon="inline-start" />
              {t("add")}
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y">
          {contacts.map((contact) => (
            <li key={contact.id} className="group flex items-start gap-3 py-3">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/50 text-[11px] font-bold text-muted-foreground"
              >
                {initialsFrom(contact.full_name)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-semibold">{contact.full_name}</p>
                  {contact.is_primary && <Badge className="bg-primary/15 text-primary">{t("primary")}</Badge>}
                  {contact.is_billing && <Badge variant="outline">{t("billing")}</Badge>}
                </div>
                {contact.role && <p className="text-xs text-muted-foreground">{contact.role}</p>}
                {(contact.email || contact.phone) && (
                  <div className="mt-1 flex flex-col gap-0.5 text-xs">
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-primary"
                      >
                        <Mail className="size-3.5 shrink-0" />
                        <span className="truncate">{contact.email}</span>
                      </a>
                    )}
                    {contact.phone && (
                      <a
                        href={telHref(contact.phone)}
                        className="inline-flex items-center gap-1.5 text-muted-foreground tabular hover:text-primary"
                      >
                        <Phone className="size-3.5 shrink-0" />
                        {contact.phone}
                      </a>
                    )}
                  </div>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon-xs" aria-label={tCommon("edit")} onClick={() => openSheet(contact)}>
                        <Pencil />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{tCommon("edit")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("archive")}
                        onClick={() => setArchiving({ open: true, contact })}
                      >
                        <Archive />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("archive")}</TooltipContent>
                  </Tooltip>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <SettingsSheet
            open={sheet.open}
            onOpenChange={(open) => {
              if (!open) closeSheet();
            }}
            title={editingContact ? t("editTitle") : t("addTitle")}
            description={t("formDescription")}
          >
            <ContactForm
              slug={slug}
              clientId={clientId}
              contact={editingContact}
              defaults={contactFormDefaults(editingContact, contacts.length === 0)}
              currentPrimary={primary && primary.id !== editingContact?.id ? primary.full_name : null}
              onDone={closeSheet}
            />
          </SettingsSheet>
          <ConfirmDialog
            open={archiving.open}
            onOpenChange={(open) => setArchiving((a) => ({ ...a, open }))}
            title={t("archiveTitle", { name: archiving.contact?.full_name ?? "" })}
            description={t("archiveBody")}
            confirmLabel={t("archive")}
            onConfirm={confirmArchive}
            pending={pending}
          />
        </>
      )}
    </SettingsCard>
  );
}

function ContactForm({
  slug,
  clientId,
  contact,
  defaults,
  currentPrimary,
  onDone,
}: {
  slug: string;
  clientId: string;
  contact?: ContactRow;
  defaults: ContactFormInput;
  /** Nombre del principal actual si es otro: marcar este lo sustituye. */
  currentPrimary: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("clients.contacts");
  const tCommon = useTranslations("common");
  const message = useClientValidationMessage();
  const form = useForm<ContactFormInput>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: defaults,
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async () => {
    const result = await saveContact(slug, clientId, contact?.id ?? null, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(contact ? t("savedToast") : t("createdToast"));
    onDone();
  });

  type TextField = "full_name" | "role" | "email" | "phone" | "notes";
  const input = (name: TextField) => ({ ...register(name), id: `contact-${name}`, "aria-invalid": Boolean(errors[name]) });
  const field = (name: TextField) => ({ id: `contact-${name}`, error: message(errors[name]?.message) });

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
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("fullName")} className="sm:col-span-2" {...field("full_name")}>
          <Input {...input("full_name")} autoComplete="name" autoFocus />
        </FormField>
        <FormField label={t("role")} optional className="sm:col-span-2" {...field("role")}>
          <Input {...input("role")} placeholder={t("rolePlaceholder")} autoComplete="organization-title" />
        </FormField>
        <FormField label={t("email")} optional {...field("email")}>
          <Input {...input("email")} type="email" autoComplete="email" />
        </FormField>
        <FormField label={t("phone")} optional {...field("phone")}>
          <Input {...input("phone")} type="tel" autoComplete="tel" className="tabular" />
        </FormField>
        <Controller
          control={control}
          name="is_primary"
          render={({ field: primary }) => (
            <ToggleField
              id="contact-primary"
              label={t("primaryToggle")}
              description={
                currentPrimary && !defaults.is_primary ? t("primaryReplaces", { name: currentPrimary }) : t("primaryHint")
              }
              checked={primary.value}
              onCheckedChange={primary.onChange}
              className="sm:col-span-2"
            />
          )}
        />
        <Controller
          control={control}
          name="is_billing"
          render={({ field: billing }) => (
            <ToggleField
              id="contact-billing"
              label={t("billingToggle")}
              description={t("billingHint")}
              checked={billing.value}
              onCheckedChange={billing.onChange}
              className="sm:col-span-2"
            />
          )}
        />
        <FormField label={t("notes")} optional className="sm:col-span-2" {...field("notes")}>
          <Textarea {...input("notes")} rows={3} />
        </FormField>
      </div>
    </SheetForm>
  );
}
