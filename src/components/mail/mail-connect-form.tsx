"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { connectMailAccount } from "@/app/[org]/mail/actions";
import { FormField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Conectar el buzón. La contraseña se escribe aquí una vez, viaja a la acción del servidor y se
 * guarda cifrada: ni se vuelve a enseñar ni se puede leer desde el navegador después.
 *
 * Los servidores vienen puestos para IONOS, que es el nuestro; se pueden cambiar sin tocar código.
 */
export function MailConnectForm({ slug, defaults }: { slug: string; defaults: { address: string; displayName: string } }) {
  const t = useTranslations("mail.connect");
  const [pending, start] = useTransition();
  const [address, setAddress] = useState(defaults.address);
  const [username, setUsername] = useState(defaults.address);
  // Si quien lo conecta no ha tocado el usuario, sigue a la dirección (en IONOS son lo mismo).
  const [usernameTouched, setUsernameTouched] = useState(false);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    start(async () => {
      const result = await connectMailAccount(slug, Object.fromEntries(form));
      if (result.ok) toast.success(t("connected"));
      else toast.error(result.error);
    });
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-5 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("address")} id="mail-address">
              <Input
                id="mail-address"
                name="address"
                type="email"
                required
                autoComplete="off"
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  if (!usernameTouched) setUsername(event.target.value);
                }}
              />
            </FormField>
            <FormField label={t("displayName")} id="mail-display-name" description={t("displayNameHint")}>
              <Input id="mail-display-name" name="display_name" defaultValue={defaults.displayName} maxLength={120} />
            </FormField>
            <FormField label={t("imapHost")} id="mail-imap-host">
              <Input id="mail-imap-host" name="imap_host" required defaultValue="imap.ionos.es" />
            </FormField>
            <FormField label={t("imapPort")} id="mail-imap-port">
              <Input id="mail-imap-port" name="imap_port" type="number" inputMode="numeric" required defaultValue={993} />
            </FormField>
            <FormField label={t("smtpHost")} id="mail-smtp-host">
              <Input id="mail-smtp-host" name="smtp_host" required defaultValue="smtp.ionos.es" />
            </FormField>
            <FormField label={t("smtpPort")} id="mail-smtp-port">
              <Input id="mail-smtp-port" name="smtp_port" type="number" inputMode="numeric" required defaultValue={465} />
            </FormField>
            <FormField label={t("username")} id="mail-username" description={t("usernameHint")}>
              <Input
                id="mail-username"
                name="username"
                required
                autoComplete="off"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setUsernameTouched(true);
                }}
              />
            </FormField>
            <FormField label={t("password")} id="mail-password" description={t("passwordHint")}>
              <Input id="mail-password" name="password" type="password" required autoComplete="new-password" />
            </FormField>
          </div>
          <p className="text-sm text-muted-foreground">{t("privacy")}</p>
          <Button type="submit" disabled={pending}>
            {pending ? t("connecting") : t("connect")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
