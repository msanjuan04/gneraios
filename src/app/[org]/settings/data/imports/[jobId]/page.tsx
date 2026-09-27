import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { JobHeader } from "@/components/dataio/job-header";
import { MappingForm } from "@/components/dataio/mapping-form";
import { ResultPanel } from "@/components/dataio/result-panel";
import { SimulationPanel } from "@/components/dataio/simulation-panel";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { loadJobPage } from "@/server/dataio/queries";
import { getOrgContext, hasRole } from "@/server/session";

type Params = { params: Promise<{ org: string; jobId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dataio.job");
  return { title: t("metaTitle") };
}

/**
 * Una importación: 1. fichero subido, 2. mapeo de columnas (automático y editable), 3. simulación
 * fila a fila (con la clasificación de cada línea y su regla, editable) y 4. confirmación con el
 * resultado y enlaces a lo creado. La simulación se calcula siempre con el estado de ahora.
 */
export default async function ImportJobPage({ params }: Params) {
  const { org: slug, jobId } = await params;
  const { org, member } = await getOrgContext(slug);
  const id = idSchema.safeParse(jobId);
  if (!id.success) notFound();
  const supabase = await createClient();
  const page = await loadJobPage(supabase, org, member.id, id.data);
  if (!page) notFound();

  const canEdit = hasRole(member.role, "partner");
  const committed = page.job.status === "committed";
  const step = committed ? "result" : page.simulation ? "simulation" : "mapping";

  return (
    <div className="space-y-6">
      <JobHeader slug={org.slug} job={page.job} step={step} canEdit={canEdit} />
      {page.result && <ResultPanel slug={org.slug} jobId={page.job.id} kind={page.job.kind} view={page.result} canEdit={canEdit} />}
      {!committed && (
        <>
          <MappingForm
            key={JSON.stringify([page.mapping.mapping, page.mapping.options])}
            slug={org.slug}
            jobId={page.job.id}
            view={page.mapping}
            canEdit={canEdit}
            collapsed={page.simulation !== null}
          />
          {page.simulation && <SimulationPanel slug={org.slug} jobId={page.job.id} view={page.simulation} canEdit={canEdit} />}
        </>
      )}
    </div>
  );
}
