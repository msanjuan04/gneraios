import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AGENT_ICONS, usd, usdCents } from "@/components/council/meta";
import { RunsTable } from "@/components/council/runs-table";
import { getAgentStatuses, listRuns } from "@/council/queries";
import { cn } from "@/lib/utils";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("council.meta"))("runs") };
}

/** El registro de ejecuciones del consejo (owners): qué se ha llamado, cuánto ha costado y cómo va el presupuesto. */
export default async function RunsPage({ params }: PageProps<"/[org]/council/runs">) {
  const { org: slug } = await params;
  const { org, member } = await getOrgContext(slug);
  const t = await getTranslations("council.runs");
  const tAgents = await getTranslations("council.agents");

  if (!hasRole(member.role, "owner")) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border border-dashed px-6 py-10 text-sm text-muted-foreground">
        <Lock aria-hidden className="size-4" />
        {t("ownerOnly")}
      </p>
    );
  }

  const [runs, agents] = await Promise.all([listRuns(org.id), getAgentStatuses(org.id)]);
  const monthTotal = agents.reduce((sum, a) => sum + a.spentUsdMicros, 0);

  return (
    <div className="space-y-6">
      <section aria-labelledby="council-budgets" className="rounded-2xl border bg-card">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-3">
          <h2 id="council-budgets" className="text-sm font-bold">
            {t("budgets")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("monthTotal", { total: usd(monthTotal, org.locale) })}</p>
        </header>
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => {
            const Icon = AGENT_ICONS[a.agent];
            const share = a.budgetUsdCents > 0 ? Math.min(1, a.spentUsdMicros / (a.budgetUsdCents * 10_000)) : 1;
            return (
              <li key={a.agent} className="border-b px-5 py-3 text-sm">
                <p className="flex items-center gap-1.5 font-semibold">
                  <Icon aria-hidden className="size-3.5 text-primary" />
                  {tAgents(`${a.agent}.name`)}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
                  <div className={cn("h-full rounded-full", share >= 1 ? "bg-destructive" : share > 0.8 ? "bg-warning" : "bg-brand-gradient")} style={{ width: `${Math.max(2, share * 100)}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular">{t("spent", { spent: usd(a.spentUsdMicros, org.locale), budget: usdCents(a.budgetUsdCents, org.locale) })}</p>
              </li>
            );
          })}
        </ul>
        <p className="px-5 py-3 text-xs text-muted-foreground">{t("costNote")}</p>
      </section>
      <RunsTable runs={runs} locale={org.locale} />
    </div>
  );
}
