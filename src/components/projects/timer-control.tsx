"use client";

import { ArrowLeft, ExternalLink, ListTodo, Play, Square, Timer } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useShell } from "@/components/app-shell/shell-context";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDuration } from "@/domain/projects";
import { cn } from "@/lib/utils";
import { getTimerProjects, getTimerState, getTimerTasks, startTimer, stopTimer } from "@/server/projects/actions";
import { Elapsed, useElapsedSeconds } from "./elapsed";
import { announceTimerChange, TIMER_EVENT } from "./fields";
import { useProjectFormat } from "./format";
import type { RunningTimer, TimerProjectOption, TimerTaskOption } from "./types";

const REFRESH_MS = 60_000;

/**
 * Temporizador de la barra superior. Sin nada en marcha, un botón que abre el selector (proyecto y,
 * si se quiere, tarea); en marcha, el tiempo que lleva y el botón de parar. Lee y escribe con las
 * acciones de src/server/projects (start_timer / stop_timer en Postgres). Solo para quien registra
 * horas (socios y owners); en la vista previa sin base de datos no se pinta.
 *
 * Se sincroniza solo: al volver a la pestaña, cada minuto y cuando otra pantalla arranca o para un
 * temporizador (evento `gnerai:timer-changed`).
 */
export function TimerControl({ className }: { className?: string }) {
  const t = useTranslations("projects.timer");
  const { org, member, preview, basePath } = useShell();
  const router = useRouter();
  const fmt = useProjectFormat();
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [projects, setProjects] = useState<TimerProjectOption[] | null>(null);
  const [project, setProject] = useState<TimerProjectOption | null>(null);
  const [tasks, setTasks] = useState<TimerTaskOption[] | null>(null);
  const [pending, startTransition] = useTransition();
  const canTrack = !preview && member.role !== "viewer";
  const elapsed = useElapsedSeconds(timer?.startedAt ?? null);

  const refresh = useCallback(() => {
    if (!canTrack) return;
    void getTimerState(org.slug).then(setTimer);
  }, [org.slug, canTrack]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener(TIMER_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      window.removeEventListener(TIMER_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (!canTrack) return null;

  const openPicker = () => {
    setPicking(true);
    setProject(null);
    setTasks(null);
    if (projects === null) void getTimerProjects(org.slug).then(setProjects);
  };

  const chooseProject = (option: TimerProjectOption) => {
    setProject(option);
    setTasks(null);
    void getTimerTasks(org.slug, option.id).then(setTasks);
  };

  const start = (option: TimerProjectOption, taskId: string | null) =>
    startTransition(async () => {
      const result = await startTimer(org.slug, option.id, taskId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("started", { project: option.name }));
      setOpen(false);
      setPicking(false);
      announceTimerChange();
      router.refresh();
    });

  const stop = () =>
    startTransition(async () => {
      const current = timer;
      const result = await stopTimer(org.slug);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (current) toast.success(t("stopped", { time: formatDuration(Math.max(1, Math.round(elapsed / 60))), project: current.projectName }));
      setTimer(null);
      setOpen(false);
      announceTimerChange();
      router.refresh();
    });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      refresh();
      if (!timer) openPicker();
      else setPicking(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className={cn("flex items-center", className)}>
        <PopoverTrigger asChild>
          {timer ? (
            <Button
              variant="outline"
              size="sm"
              className="max-w-56 gap-2 rounded-r-none border-primary/40 bg-primary/10 pr-2 font-semibold text-foreground hover:bg-primary/15"
              aria-label={t("runningOn", { project: timer.projectName })}
            >
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <Elapsed startedAt={timer.startedAt} className="tabular" />
              <span className="hidden truncate font-medium text-muted-foreground md:inline">{timer.projectName}</span>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" aria-label={t("startLabel")} className="text-muted-foreground">
              <Timer />
              <span className="hidden lg:inline">{t("start")}</span>
            </Button>
          )}
        </PopoverTrigger>
        {timer && (
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-l-none border-l-0 border-primary/40 bg-primary/10 hover:bg-destructive/15"
            aria-label={t("stop")}
            title={t("stop")}
            onClick={stop}
            disabled={pending}
          >
            <Square className="size-3 fill-current text-destructive" />
          </Button>
        )}
      </div>

      <PopoverContent align="end" className="w-80 p-0 glass">
        {timer && !picking ? (
          <div className="p-4">
            <p className="text-xs text-muted-foreground">{t("since", { time: fmt.time(timer.startedAt) })}</p>
            <Elapsed startedAt={timer.startedAt} className="mt-1 block text-3xl font-extrabold tracking-[-0.035em] tabular" />
            <Link
              href={`${basePath}/projects/${timer.projectId}${timer.taskId ? `?task=${timer.taskId}` : ""}`}
              onClick={() => setOpen(false)}
              className="mt-3 flex items-center gap-1.5 text-sm font-semibold hover:text-primary"
            >
              <span className="truncate">{timer.projectName}</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {[timer.clientName, timer.taskTitle].filter(Boolean).join(" · ") || t("noTask")}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="destructive" className="flex-1" onClick={stop} disabled={pending}>
                <Square data-icon="inline-start" className="fill-current" />
                {t("stop")}
              </Button>
              <Button variant="outline" onClick={openPicker} disabled={pending}>
                {t("switch")}
              </Button>
            </div>
          </div>
        ) : project ? (
          <Command>
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Button variant="ghost" size="icon-xs" aria-label={t("back")} onClick={() => setProject(null)}>
                <ArrowLeft />
              </Button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{project.name}</p>
                {project.clientName && <p className="truncate text-xs text-muted-foreground">{project.clientName}</p>}
              </div>
            </div>
            <CommandInput placeholder={t("taskPlaceholder")} />
            <CommandList>
              <CommandEmpty>{tasks === null ? t("loading") : t("noTasks")}</CommandEmpty>
              <CommandGroup>
                <CommandItem value="__none__" onSelect={() => start(project, null)} disabled={pending}>
                  <Play />
                  {t("noTaskStart")}
                </CommandItem>
                {(tasks ?? []).map((task) => (
                  <CommandItem key={task.id} value={`${task.title} ${task.id}`} onSelect={() => start(project, task.id)} disabled={pending}>
                    <ListTodo />
                    <span className="truncate">{task.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <Command>
            {timer && (
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Button variant="ghost" size="icon-xs" aria-label={t("back")} onClick={() => setPicking(false)}>
                  <ArrowLeft />
                </Button>
                <p className="text-xs text-muted-foreground">{t("switchHint")}</p>
              </div>
            )}
            <CommandInput placeholder={t("projectPlaceholder")} autoFocus />
            <CommandList>
              <CommandEmpty>{projects === null ? t("loading") : t("noProjects")}</CommandEmpty>
              <CommandGroup heading={t("project")}>
                {(projects ?? []).map((option) => (
                  <CommandItem key={option.id} value={`${option.name} ${option.clientName ?? ""} ${option.id}`} onSelect={() => chooseProject(option)}>
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    {option.clientName && <span className="max-w-28 shrink-0 truncate text-xs text-muted-foreground">{option.clientName}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
