import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { MailConnectForm } from "@/components/mail/mail-connect-form";
import { MailInbox } from "@/components/mail/mail-inbox";
import { MailSyncButton } from "@/components/mail/mail-sync-button";
import { MailThread } from "@/components/mail/mail-thread";
import { PageHeader } from "@/components/page-header";
import { getMailAccount } from "@/server/mail/account";
import { listThreads, loadThread } from "@/server/mail/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("mail"))("title") };
}

// Tipado a mano (y no con PageProps) para no depender de los tipos de rutas generados.
type Props = {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/**
 * El correo de la org dentro de GNERAI OS: la bandeja de siempre (IMAP), los mensajes enlazados al
 * cliente al que pertenecen y la respuesta desde aquí (SMTP, con la misma cuenta). Los originales
 * siguen en el servidor de correo; esto es la copia con la que se trabaja.
 */
export default async function MailPage({ params, searchParams }: Props) {
  const [{ org: slug }, search] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  // El buzón de la empresa es cosa de los socios (lo vuelve a decir la RLS).
  if (!hasRole(member.role, "partner")) notFound();
  const t = await getTranslations("mail");
  const format = await getFormatter();
  const account = await getMailAccount(org.id);

  if (!account) {
    return (
      <div className="w-full">
        <PageHeader title={t("title")} description={t("descriptionEmpty")} />
        <MailConnectForm slug={org.slug} defaults={{ address: `info@${org.slug}.com`, displayName: org.name }} />
      </div>
    );
  }

  const query = one(search.q).slice(0, 120);
  const unreadOnly = one(search.unread) === "1";
  const page = Number.parseInt(one(search.page), 10);
  const activeThread = one(search.thread) || null;
  const [threads, messages] = await Promise.all([
    listThreads(org.id, { query, unreadOnly }, Number.isFinite(page) ? page : 1),
    activeThread ? loadThread(org.id, activeThread) : Promise.resolve([]),
  ]);

  return (
    <div className="w-full">
      <PageHeader
        title={t("title")}
        description={
          account.lastSyncAt
            ? t("lastSync", { address: account.address, when: format.relativeTime(new Date(account.lastSyncAt)) })
            : t("neverSynced", { address: account.address })
        }
        actions={<MailSyncButton slug={org.slug} />}
      />
      {account.lastError && <p className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">{account.lastError}</p>}
      <div className="grid gap-5 lg:grid-cols-[22rem_1fr] xl:grid-cols-[26rem_1fr]">
        <MailInbox page={threads} basePath={`/${org.slug}`} activeThread={activeThread} query={query} unreadOnly={unreadOnly} />
        {activeThread ? (
          <MailThread slug={org.slug} messages={messages} basePath={`/${org.slug}`} canSend />
        ) : (
          <p className="rounded-xl border border-dashed px-5 py-16 text-center text-sm text-muted-foreground">{t("pickThread")}</p>
        )}
      </div>
    </div>
  );
}
