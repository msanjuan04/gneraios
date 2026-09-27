import { Compass } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BriefingView } from "@/components/council/briefing-view";
import { ReportHistory } from "@/components/council/report-history";
import { RunNowButton } from "@/components/council/run-now-button";
import { councilConfigured, getReport } from "@/council/queries";
import { getOrgContext, hasRole } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("council.meta"))("briefing") };
}

/** El briefing del lunes del Chief of Staff (el último, o el que se pida). */
export default async function BriefingPage({ params, searchParams }: PageProps<"/[org]/council/briefing">) {
  const [{ org: slug }, query] = await Promise.all([params, searchParams]);
  const { org, member } = await getOrgContext(slug);
  const t = await getTranslations("council.briefing");
  const basePath = `/${org.slug}`;
  const { report, history } = await getReport(org.id, "weekly_briefing", typeof query.id === "string" ? query.id : null);

  if (!report) {
    return (
      <div className="mx-auto mt-4 max-w-lg rounded-3xl border bg-card/50 px-8 py-12 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
          <Compass className="size-5" />
        </div>
        <h2 className="mt-5 text-xl font-extrabold heading-tight">{t("empty.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("empty.body")}</p>
        {hasRole(member.role, "partner") && (
          <div className="mt-6 flex justify-center">
            <RunNowButton slug={org.slug} agent="chief_of_staff" disabled={!councilConfigured()} />
          </div>
        )}
        {!councilConfigured() && <p className="mt-3 text-xs text-muted-foreground">{t("empty.noApiKey")}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <BriefingView report={report} basePath={basePath} />
      <aside className="space-y-4">
        {hasRole(member.role, "partner") && (
          <div className="rounded-2xl border bg-card px-4 py-3 text-sm">
            <p className="text-muted-foreground">{t("regenerate")}</p>
            <div className="mt-2">
              <RunNowButton slug={org.slug} agent="chief_of_staff" variant="outline" disabled={!councilConfigured()} />
            </div>
          </div>
        )}
        <ReportHistory items={history} activeId={report.id} href={(id) => `${basePath}/council/briefing?id=${id}`} kind="weekly_briefing" />
      </aside>
    </div>
  );
}
