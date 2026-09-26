import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { GoogleConnection } from "@/components/seo/google-connection";
import { PropertiesManager } from "@/components/seo/properties-manager";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { getSeoSetup } from "@/server/seo/queries";
import { getOrgContext, hasRole } from "@/server/session";

type SearchParams = Record<string, string | string[] | undefined>;
type PropertiesPageProps = { params: Promise<{ org: string }>; searchParams: Promise<SearchParams> };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("seo");
  return { title: `${t("properties.title")} · ${t("metaTitle")}` };
}

/** Webs de la org (propia y de clientes) y la conexión con Google. */
export default async function SeoPropertiesPage({ params, searchParams }: PropertiesPageProps) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  const t = await getTranslations("seo");
  const supabase = await createClient();
  const [setup, clientsRes] = await Promise.all([
    getSeoSetup(org.id),
    supabase.from("clients").select("id, display_name").eq("org_id", org.id).is("archived_at", null).order("display_name"),
  ]);
  if (clientsRes.error) throw clientsRes.error;

  const basePath = `/${org.slug}`;
  const requestedClient = first(query.client);
  const connected = setup.integration?.status === "connected";

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href={`${basePath}/seo`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("properties.back")}
      </Link>
      <PageHeader title={t("properties.pageTitle")} description={t("properties.pageDescription")} />
      <div className="space-y-6">
        <GoogleConnection
          slug={org.slug}
          integration={setup.integration}
          googleConfigured={setup.googleConfigured}
          isOwner={hasRole(member.role, "owner")}
          isPartner={hasRole(member.role, "partner")}
          startHref={`/api/integrations/google/start?org=${org.slug}`}
        />
        <PropertiesManager
          slug={org.slug}
          basePath={basePath}
          properties={setup.properties}
          clients={(clientsRes.data ?? []).map((c) => ({ id: c.id, name: c.display_name }))}
          canEdit={hasRole(member.role, "partner")}
          googleConnected={connected}
          openNew={first(query.new) === "1"}
          newClientId={requestedClient && idSchema.safeParse(requestedClient).success ? requestedClient : null}
        />
      </div>
    </div>
  );
}
