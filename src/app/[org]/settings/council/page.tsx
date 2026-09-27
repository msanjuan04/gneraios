import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cadenceOf } from "@/components/council/cadence";
import { AgentSettingsList } from "@/components/council/settings/agent-settings";
import { ConnectionCard } from "@/components/council/settings/connection-card";
import { PolicyForm } from "@/components/council/settings/policy-form";
import { UpsellRulesEditor } from "@/components/council/settings/upsell-rules";
import { SettingsSectionHeader } from "@/components/settings/settings-card";
import { AGENTS } from "@/council/agents";
import { councilConfigured, councilProviderName, getAgentStatuses, getPolicyWithHistory, listUpsellRules, reviewAccuracy } from "@/council/queries";
import { cn } from "@/lib/utils";
import { getOrgContext, hasRole } from "@/server/session";

const SECTIONS = ["policy", "agents", "rules"] as const;
type Section = (typeof SECTIONS)[number];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.council")} · ${t("title")}` };
}

/**
 * Ajustes → Consejo: la política financiera (versionada), los agentes (encendido, modelo,
 * presupuesto y umbrales) y las reglas de venta cruzada. Lo cambia un owner; el resto lo ve.
 */
export default async function CouncilSettingsPage({ params, searchParams }: PageProps<"/[org]/settings/council">) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  const t = await getTranslations("council.settings");
  const tCadence = await getTranslations("council.cadence");
  const isOwner = hasRole(member.role, "owner");
  const basePath = `/${org.slug}`;
  const section: Section = SECTIONS.find((s) => s === query.section) ?? "policy";

  const [policy, agents, rules, accuracy] = await Promise.all([
    getPolicyWithHistory(org.id),
    getAgentStatuses(org.id),
    section === "rules" ? listUpsellRules(org.id) : Promise.resolve([]),
    section === "agents" ? reviewAccuracy(org.id) : Promise.resolve(null),
  ]);
  const cadence = Object.fromEntries(
    agents.map((a) => {
      const c = cadenceOf(AGENTS[a.agent]);
      return [a.agent, tCadence(c.key, c.values)];
    }),
  );

  return (
    <div className="space-y-6">
      <ConnectionCard configured={councilConfigured()} provider={councilProviderName()} cronConfigured={Boolean(process.env.CRON_SECRET)} basePath={basePath} isOwner={isOwner} />

      <nav aria-label={t("sectionsLabel")} className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border bg-card/60 p-1 [scrollbar-width:none]">
        {SECTIONS.map((s) => (
          <Link
            key={s}
            href={`${basePath}/settings/council${s === "policy" ? "" : `?section=${s}`}`}
            aria-current={s === section ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
              s === section ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`sections.${s}`)}
            {s === "policy" && policy.current.isExample && <span className="ml-1.5 rounded-full border border-warning/40 px-1.5 text-[10px] font-semibold text-warning uppercase">{t("exampleBadge")}</span>}
          </Link>
        ))}
      </nav>

      {section === "policy" && (
        <section>
          <SettingsSectionHeader
            title={t("policyTitle")}
            description={policy.current.isExample ? t("policyDescriptionExample") : t("policyDescription", { version: policy.current.version ?? 0 })}
          />
          <PolicyForm
            slug={org.slug}
            policy={policy.current.policy}
            version={policy.current.version}
            isExample={policy.current.isExample}
            invalid={policy.invalid}
            versions={policy.versions}
            canEdit={isOwner}
          />
        </section>
      )}

      {section === "agents" && accuracy && (
        <section>
          <SettingsSectionHeader title={t("agentsTitle")} description={t("agentsDescription")} />
          <AgentSettingsList slug={org.slug} agents={agents} accuracy={accuracy} locale={org.locale} canEdit={isOwner} cadence={cadence} />
        </section>
      )}

      {section === "rules" && (
        <UpsellRulesEditor
          slug={org.slug}
          rules={rules.map((r) => ({
            id: r.id,
            label: r.label,
            requires_any: r.requires_any,
            excludes_any: r.excludes_any,
            max_services: r.max_services,
            min_months: r.min_months,
            suggestion: r.suggestion,
            reference_mrr_cents: r.reference_mrr_cents,
            archived_at: r.archived_at,
          }))}
          money={{ locale: org.locale, currency: org.currency }}
          canEdit={isOwner}
        />
      )}
    </div>
  );
}
