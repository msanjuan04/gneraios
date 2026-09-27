import { FileClock } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ImportJobListItem, ImportStatus } from "./types";

const STATUS_STYLES: Record<ImportStatus, string> = {
  draft: "border-border bg-transparent text-foreground",
  simulated: "bg-primary/15 text-primary",
  committed: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};

/** Últimas importaciones: qué fichero, de qué, en qué estado y qué hizo. */
export async function ImportJobsList({ basePath, jobs }: { basePath: string; jobs: ImportJobListItem[] }) {
  const t = await getTranslations("dataio.jobs");
  const tStatus = await getTranslations("dataio.status");
  const tKind = await getTranslations("dataio.kinds");
  const format = await getFormatter();

  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
        <FileClock className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-2xl border bg-card text-sm">
      {jobs.map((job) => (
        <li key={job.id}>
          <Link
            href={`${basePath}/settings/data/imports/${job.id}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{job.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {tKind(job.kind)} · {t("rows", { count: job.rows })} ·{" "}
                {format.dateTime(new Date(job.committedAt ?? job.createdAt), { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
            {job.counts && (
              <p className="text-xs text-muted-foreground tabular">
                {t("counts", { create: job.counts.create, update: job.counts.update, skip: job.counts.skip, error: job.counts.error })}
              </p>
            )}
            <Badge className={cn(STATUS_STYLES[job.status])}>{tStatus(job.status)}</Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
