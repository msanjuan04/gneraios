"use client";

import { CheckCircle2, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { commitImport } from "@/app/[org]/settings/data/actions";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportKind } from "@/domain/dataio/fields";
import { ActionBadge, IssueList } from "./issue-text";
import type { ResultView } from "./types";

const PAGE = 100;

/** Paso 4: lo que se hizo con cada fila, con enlace a lo creado. Si algo falló, se puede reintentar. */
export function ResultPanel({
  slug,
  jobId,
  kind,
  view,
  canEdit,
}: {
  slug: string;
  jobId: string;
  kind: ImportKind;
  view: ResultView;
  canEdit: boolean;
}) {
  const t = useTranslations("dataio.result");
  const format = useFormatter();
  const router = useRouter();
  const [limit, setLimit] = useState(PAGE);
  const [onlyProblems, setOnlyProblems] = useState(view.counts.error > 0);
  const [pending, startTransition] = useTransition();
  const rows = onlyProblems ? view.rows.filter((r) => r.action === "error") : view.rows;

  function retry() {
    startTransition(async () => {
      const result = await commitImport(slug, jobId);
      if (!result.ok) toast.error(result.error);
      else toast.success(t("retried", { created: result.created, errors: result.errors }));
      router.refresh();
    });
  }

  return (
    <SettingsCard
      title={
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 className="size-4 text-success" />
          {t("title")}
        </span>
      }
      description={
        view.committedAt ? t("when", { date: format.dateTime(new Date(view.committedAt), { dateStyle: "long", timeStyle: "short" }) }) : undefined
      }
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href={kind === "clients" ? `/${slug}/clients` : `/${slug}/invoices`}>
            <ExternalLink data-icon="inline-start" />
            {kind === "clients" ? t("openClients") : t("openInvoices")}
          </Link>
        </Button>
      }
      bodyClassName="space-y-4"
    >
      <p className="text-sm">
        {t(kind === "clients" ? "summaryClients" : "summaryInvoices", {
          create: view.counts.create,
          update: view.counts.update,
          skip: view.counts.skip,
          error: view.counts.error,
          clients: view.newClients,
        })}
      </p>
      {view.counts.error > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOnlyProblems((v) => !v)}>
            {onlyProblems ? t("showAll") : t("showErrors")}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={retry} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RotateCcw data-icon="inline-start" />}
              {t("retry")}
            </Button>
          )}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-16 pl-4 text-xs text-muted-foreground">{t("columns.row")}</TableHead>
              <TableHead className="w-28 text-xs text-muted-foreground">{t("columns.action")}</TableHead>
              <TableHead className="text-xs text-muted-foreground">{t("columns.record")}</TableHead>
              <TableHead className="text-xs text-muted-foreground">{t("columns.reasons")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, limit).map((r) => (
              <TableRow key={r.rowNumber} className="align-top">
                <TableCell className="pl-4 text-xs text-muted-foreground tabular">{r.rowNumber}</TableCell>
                <TableCell>
                  <ActionBadge action={r.action} />
                </TableCell>
                <TableCell className="max-w-72 whitespace-normal">
                  {r.href ? (
                    <Link href={r.href} className="font-medium text-primary hover:underline">
                      {r.label ?? t("open")}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.label ?? "—"}</span>
                  )}
                </TableCell>
                <TableCell className="max-w-96 whitespace-normal">
                  <IssueList issues={r.issues} limit={3} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > limit && (
        <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
          {t("showMore", { count: rows.length - limit })}
        </Button>
      )}
    </SettingsCard>
  );
}
