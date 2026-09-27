"use client";

import { Clock, Pencil, Play, Plus, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sumBy } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { startTimer, stopTimer } from "@/server/projects/actions";
import { Elapsed } from "./elapsed";
import { announceTimerChange, OptionSelect } from "./fields";
import { useProjectFormat } from "./format";
import { MemberAvatar, memberLookup } from "./member-avatar";
import { Bar } from "./meters";
import { TimeEntrySheet } from "./time-entry-sheet";
import type { ProjectDetailData, ProjectViewer, TimeEntry } from "./types";

const WEEKS_SHOWN = 8;

type SheetState = { open: false } | { open: true; entry: TimeEntry | null };

/** Horas de un proyecto: temporizador, totales por persona y por semana, y cada registro. */
export function TimeTab({ data, viewer, canEdit }: { data: ProjectDetailData; viewer: ProjectViewer; canEdit: boolean }) {
  const t = useTranslations("projects.time");
  const fmt = useProjectFormat();
  const [pending, startTransition] = useTransition();
  const [taskId, setTaskId] = useState("");
  const [sheet, setSheet] = useState<SheetState>({ open: false });
  const member = memberLookup(data.members);
  const task = new Map(data.tasks.map((x) => [x.id, x]));

  const logged = data.entries.filter((e): e is TimeEntry & { minutes: number } => e.minutes !== null);
  const running = data.entries.filter((e) => e.minutes === null);
  const mine = running.find((e) => e.memberId === viewer.memberId);
  const total = logged.reduce((sum, e) => sum + e.minutes, 0);
  const billable = logged.filter((e) => e.billable).reduce((sum, e) => sum + e.minutes, 0);
  const byMember = [...sumBy(logged, (e) => e.memberId, (e) => e.minutes)].sort((a, b) => b[1] - a[1]);
  const billableByMember = sumBy(logged.filter((e) => e.billable), (e) => e.memberId, (e) => e.minutes);
  const weeks = data.weekly.slice(-WEEKS_SHOWN).reverse();
  const maxWeek = Math.max(1, ...weeks.map((w) => w.minutes));
  const maxMember = Math.max(1, ...byMember.map(([, m]) => m));
  const canTouch = (entry: TimeEntry) => canEdit && (viewer.isOwner || entry.memberId === viewer.memberId);
  const openTasks = data.tasks.filter((x) => x.status !== "done");

  const toggleTimer = () =>
    startTransition(async () => {
      const result = mine ? await stopTimer(viewer.slug) : await startTimer(viewer.slug, data.project.id, taskId || null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(mine ? t("stopped") : t("started"));
      announceTimerChange();
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3">
        {mine ? (
          <>
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
            </span>
            <Elapsed startedAt={mine.startedAt!} className="text-lg font-extrabold tabular" />
            <span className="text-sm text-muted-foreground">
              {t("runningSince", { time: fmt.time(mine.startedAt!) })}
              {mine.taskId && task.get(mine.taskId) ? ` · ${task.get(mine.taskId)!.title}` : ""}
            </span>
          </>
        ) : (
          canEdit && (
            <OptionSelect
              size="sm"
              ariaLabel={t("taskPicker")}
              value={taskId}
              onChange={setTaskId}
              noneLabel={t("noTask")}
              options={openTasks.map((x) => ({ value: x.id, label: x.title }))}
              className="w-full sm:w-72"
            />
          )
        )}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (
            <Button variant={mine ? "secondary" : "outline"} size="sm" onClick={toggleTimer} disabled={pending}>
              {mine ? <Square data-icon="inline-start" className="fill-current text-destructive" /> : <Play data-icon="inline-start" />}
              {mine ? t("stopTimer") : t("startTimer")}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => setSheet({ open: true, entry: null })}>
              <Plus data-icon="inline-start" />
              {t("add")}
            </Button>
          )}
        </div>
        {running
          .filter((e) => e.memberId !== viewer.memberId)
          .map((e) => (
            <p key={e.id} className="flex w-full items-center gap-2 text-xs text-muted-foreground">
              <MemberAvatar member={member(e.memberId)} size="xs" />
              {t("runningBy", { name: member(e.memberId)?.fullName ?? "—" })}
              <Elapsed startedAt={e.startedAt!} className="font-semibold text-foreground tabular" />
            </p>
          ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border bg-card p-4">
          <header className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold">{t("byMember")}</h3>
            <p className="text-xs text-muted-foreground tabular">
              {t("total", { time: fmt.duration(total) })}
              {total > 0 && ` · ${t("billableShare", { percent: fmt.percent(billable / total) })}`}
            </p>
          </header>
          {byMember.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("noHours")}</p>
          ) : (
            <ul className="space-y-2.5">
              {byMember.map(([memberId, minutes]) => (
                <li key={memberId} className="flex items-center gap-3">
                  <MemberAvatar member={member(memberId)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{member(memberId)?.fullName ?? "—"}</span>
                      <span className="font-semibold tabular">{fmt.duration(minutes)}</span>
                    </div>
                    <Bar ratio={minutes / maxMember} className="mt-1" />
                    {(billableByMember.get(memberId) ?? 0) < minutes && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t("nonBillable", { time: fmt.duration(minutes - (billableByMember.get(memberId) ?? 0)) })}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <header className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold">{t("byWeek")}</h3>
            <p className="text-xs text-muted-foreground">{t("lastWeeks", { count: weeks.length })}</p>
          </header>
          <ul className="space-y-1.5">
            {weeks.map((w) => (
              <li key={w.week} className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-3 text-sm">
                <span className="text-xs text-muted-foreground tabular">{t("weekOf", { date: fmt.date(w.week, "short") })}</span>
                <Bar ratio={w.minutes / maxWeek} tone={w.minutes === 0 ? "bg-muted" : "bg-primary"} />
                <span className={cn("text-right tabular", w.minutes === 0 && "text-muted-foreground")}>{fmt.hours(w.minutes)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {data.entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
          <Clock className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 font-semibold">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{canEdit ? t("emptyBody") : t("emptyReadOnly")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5 text-xs text-muted-foreground">{t("columns.date")}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t("columns.member")}</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground md:table-cell">{t("columns.task")}</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground lg:table-cell">{t("columns.note")}</TableHead>
                <TableHead className="text-right text-xs text-muted-foreground">{t("columns.duration")}</TableHead>
                <TableHead className="w-10 pr-3">
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground tabular">{fmt.date(entry.workedOn, "weekday")}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <MemberAvatar member={member(entry.memberId)} size="xs" />
                      <span className="hidden truncate text-sm sm:inline">{member(entry.memberId)?.fullName ?? "—"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-0 md:table-cell md:w-[26%]">
                    <span className="block truncate text-sm">{entry.taskId ? (task.get(entry.taskId)?.title ?? "—") : <span className="text-muted-foreground">—</span>}</span>
                  </TableCell>
                  <TableCell className="hidden max-w-0 lg:table-cell lg:w-[30%]">
                    <span className="block truncate text-sm text-muted-foreground">{entry.note ?? ""}</span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {entry.minutes === null ? (
                      <Badge className="bg-primary/15 text-primary">
                        <Elapsed startedAt={entry.startedAt!} className="tabular" />
                      </Badge>
                    ) : (
                      <span className="flex items-center justify-end gap-2">
                        {!entry.billable && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            {t("nonBillableBadge")}
                          </Badge>
                        )}
                        <span className="font-semibold tabular">{fmt.duration(entry.minutes)}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="pr-3">
                    {canTouch(entry) && entry.minutes !== null && (
                      <Button variant="ghost" size="icon-xs" aria-label={t("edit")} onClick={() => setSheet({ open: true, entry })}>
                        <Pencil />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canEdit && (
        <TimeEntrySheet
          slug={viewer.slug}
          projectId={data.project.id}
          open={sheet.open}
          onOpenChange={(open) => !open && setSheet({ open: false })}
          entry={sheet.open ? sheet.entry : null}
          tasks={data.tasks}
          members={data.members}
          currentMemberId={viewer.memberId}
          isOwner={viewer.isOwner}
          today={viewer.today}
          defaultTaskId={taskId || undefined}
        />
      )}
    </div>
  );
}
