"use client";

import { ArrowLeft, Check, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteImportJob } from "@/app/[org]/settings/data/actions";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ImportJobView } from "./types";

const STEPS = ["upload", "mapping", "simulation", "result"] as const;
type Step = (typeof STEPS)[number];

/** Cabecera de una importación: el fichero, en qué paso está y, si no se ha confirmado, descartarla. */
export function JobHeader({ slug, job, step, canEdit }: { slug: string; job: ImportJobView; step: Step; canEdit: boolean }) {
  const t = useTranslations("dataio.job");
  const tKind = useTranslations("dataio.kinds");
  const format = useFormatter();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const current = STEPS.indexOf(step);

  function discard() {
    startTransition(async () => {
      const result = await deleteImportJob(slug, job.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirm(false);
      router.push(`/${slug}/settings/data`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/${slug}/settings/data`} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            {t("back")}
          </Link>
          <h3 className="mt-1 truncate text-base font-bold tracking-tight">{job.fileName}</h3>
          <p className="text-xs text-muted-foreground">
            {tKind(job.kind)} · {t("rows", { count: job.rows })} ·{" "}
            {job.format === "json" ? t("formatJson") : t("formatCsv", { encoding: job.encoding ?? "?", delimiter: job.delimiter === "\t" ? t("tab") : (job.delimiter ?? "?") })} ·{" "}
            {format.dateTime(new Date(job.createdAt), { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        {canEdit && job.status !== "committed" && (
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
            <Trash2 data-icon="inline-start" />
            {t("discard")}
          </Button>
        )}
      </div>
      <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-3",
                i < current && "border-transparent bg-success/15 text-success",
                i === current && "border-primary/40 bg-primary/10 text-foreground",
                i > current && "text-muted-foreground",
              )}
            >
              {i < current ? <Check className="size-3.5" /> : <span className="tabular">{i + 1}</span>}
              {t(`steps.${s}`)}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-border" />}
          </li>
        ))}
      </ol>
      {job.sameFileCommittedAt && (
        <p className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-xs">
          {t("sameFile", { date: format.dateTime(new Date(job.sameFileCommittedAt), { dateStyle: "long" }) })}
        </p>
      )}
      {job.status === "failed" && job.error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-xs">{t("failed")}</p>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("discardTitle")}
        description={t("discardBody")}
        confirmLabel={t("discard")}
        onConfirm={discard}
        pending={pending}
      />
    </div>
  );
}
