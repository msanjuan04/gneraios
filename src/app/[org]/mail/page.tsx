import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { MailCompose } from "@/components/mail/mail-compose";
import { MailConnectForm } from "@/components/mail/mail-connect-form";
import { MailInbox } from "@/components/mail/mail-inbox";
import { MailSyncButton } from "@/components/mail/mail-sync-button";
import { MailThread } from "@/components/mail/mail-thread";
import { PageHeader } from "@/components/page-header";
import { getMailAccount } from "@/server/mail/account";
import { listMailClients, listThreads, loadThread, type ThreadView } from "@/server/mail/queries";
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El correo de la org dentro de GNERAI OS: dos paneles (lista y conversación) a todo el ancho; en
 * pantallas pequeñas se ve uno solo y se va y viene. Los originales siguen en el servidor de correo;
 * esto es la copia con la que se trabaja, enlazada al cliente al que pertenece cada mensaje.
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
  const rawView = one(search.view);
  const view: ThreadView = rawView === "unread" || rawView === "reply" ? rawView : "all";
  const rawClient = one(search.client);
  const client = rawClient === "none" || UUID.test(rawClient) ? rawClient : "";
  const page = Number.parseInt(one(search.page), 10);
  const activeThread = one(search.thread) || null;
  const composing = one(search.compose) === "1";
  const [threads, clients, messages] = await Promise.all([
    listThreads(org.id, { query, view, client: client || null }, Number.isFinite(page) ? page : 1),
    listMailClients(org.id),
    activeThread ? loadThread(org.id, activeThread) : Promise.resolve([]),
  ]);
  const basePath = `/${org.slug}`;
  const hasRight = Boolean(activeThread) || composing;

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
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        {/* En pantallas pequeñas, o la lista o la conversación: nunca las dos apretadas. */}
        <div className={hasRight ? "hidden lg:block" : undefined}>
          <MailInbox page={threads} basePath={basePath} activeThread={activeThread} query={query} view={view} client={client} clients={clients} />
        </div>
        <div className={hasRight ? undefined : "hidden lg:block"}>
          {composing ? (
            <section className="overflow-hidden rounded-2xl border bg-card/60">
              <header className="border-b px-5 py-4">
                <h3 className="text-lg font-bold">{t("newMail")}</h3>
              </header>
              <div className="p-5">
                <MailCompose slug={org.slug} mode="new" />
              </div>
            </section>
          ) : activeThread ? (
            <MailThread slug={org.slug} messages={messages} basePath={basePath} canSend threadKey={activeThread} backHref={`${basePath}/mail`} />
          ) : (
            <p className="rounded-2xl border border-dashed px-5 py-24 text-center text-sm text-muted-foreground">{t("pickThread")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
