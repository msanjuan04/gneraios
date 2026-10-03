import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MailChatCard } from "@/components/mail/mail-chat-card";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { getMailAccount } from "@/server/mail/account";
import { getOrgContext, hasRole } from "@/server/session";

type Props = { params: Promise<{ org: string; clientId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org: slug, clientId } = await params;
  const t = await getTranslations("leads.mail");
  if (!idSchema.safeParse(clientId).success) return { title: t("title") };
  const { org } = await getOrgContext(slug);
  const db = await createClient();
  const { data } = await db.from("clients").select("display_name").eq("org_id", org.id).eq("id", clientId).maybeSingle();
  return { title: data ? `${data.display_name} · ${t("title")}` : t("title") };
}

/** Toda la conversación por correo con esta ficha, en modo chat y a pantalla completa. */
export default async function LeadMailPage({ params }: Props) {
  const { org: slug, clientId } = await params;
  if (!idSchema.safeParse(clientId).success) notFound();
  const { org, member } = await getOrgContext(slug);
  // El correo de la empresa es cosa de los socios, igual que la bandeja.
  if (!hasRole(member.role, "partner")) notFound();
  const t = await getTranslations("leads.mail");
  const db = await createClient();
  const [{ data: client }, account] = await Promise.all([
    db.from("clients").select("display_name").eq("org_id", org.id).eq("id", clientId).maybeSingle(),
    getMailAccount(org.id),
  ]);
  if (!client) notFound();
  const basePath = `/${org.slug}`;

  return (
    <div className="w-full space-y-5">
      <PageHeader
        title={t("title")}
        description={t("description", { name: client.display_name })}
        actions={
          <Button asChild variant="outline">
            <Link href={`${basePath}/leads/${clientId}`}>
              <ArrowLeft data-icon="inline-start" />
              {t("back")}
            </Link>
          </Button>
        }
      />
      {account ? (
        <MailChatCard orgId={org.id} slug={org.slug} clientId={clientId} basePath={basePath} canSee tall />
      ) : (
        <p className="rounded-xl border border-dashed px-5 py-12 text-center text-sm text-muted-foreground">
          {t("notConnected")}{" "}
          <Link href={`${basePath}/mail`} className="font-semibold text-primary hover:underline">
            {t("connect")}
          </Link>
        </p>
      )}
    </div>
  );
}
