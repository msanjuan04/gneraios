"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CalendarEvent } from "@/domain/calendar";
import { toDateTimeLocal } from "@/domain/dates/zoned-time";
import { deleteCalendarEntryAction, saveCalendarEntryAction } from "@/server/calendar/actions";
import { useCalendarText } from "./use-calendar-text";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  date: string;
  event: CalendarEvent | null;
  timeZone: string;
};

export function CalendarEntryEditor({ open, onOpenChange, slug, date, event, timeZone }: Props) {
  const text = useCalendarText();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [on, setOn] = useState(event?.appointmentStart?.date ?? event?.date ?? date);
  const [endDate, setEndDate] = useState(event?.endsAt
    ? event.kind === "all_day"
      ? new Date(new Date(event.endsAt).getTime() - 1).toISOString().slice(0, 10)
      : toDateTimeLocal(new Date(event.endsAt), timeZone).slice(0, 10)
    : date);
  const [allDay, setAllDay] = useState(event?.kind === "all_day");
  const [startTime, setStartTime] = useState(event?.appointmentStart?.time ?? event?.time ?? "09:00");
  const [endTime, setEndTime] = useState(event?.endsAt && event.kind !== "all_day" ? toDateTimeLocal(new Date(event.endsAt), timeZone).slice(11, 16) : "10:00");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveCalendarEntryAction(slug, { title, description, date: on, endDate, allDay, startTime, endTime }, event?.source.id);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(text.t("editor.saved"));
      onOpenChange(false);
      router.refresh();
    });
  }

  function remove() {
    if (!event || !window.confirm(text.t("editor.deleteConfirm"))) return;
    startTransition(async () => {
      const result = await deleteCalendarEntryAction(slug, event.source.id);
      if (!result.ok) { toast.error(result.error); return; }
      toast.success(text.t("editor.deleted"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={text.t(event ? "editor.editTitle" : "editor.newTitle")}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <p className="text-sm text-muted-foreground">{text.t("editor.privateHint")}</p>
          <label className="block space-y-1.5 text-sm font-semibold">
            <span>{text.t("editor.title")}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
          </label>
          <label className="block space-y-1.5 text-sm font-semibold">
            <span>{text.t("editor.date")}</span>
            <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} required />
          </label>
          <label className="block space-y-1.5 text-sm font-semibold">
            <span>{text.t("editor.endDate")}</span>
            <Input type="date" value={endDate} min={on} onChange={(e) => setEndDate(e.target.value)} required />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-primary" />
            {text.t("editor.allDay")}
          </label>
          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5 text-sm font-semibold"><span>{text.t("editor.start")}</span><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></label>
              <label className="space-y-1.5 text-sm font-semibold"><span>{text.t("editor.end")}</span><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></label>
            </div>
          )}
          <label className="block space-y-1.5 text-sm font-semibold">
            <span>{text.t("editor.description")}</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={10000}
              className="w-full resize-y rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
          </label>
          <p className="text-xs text-muted-foreground">{text.t("editor.timeZone", { zone: timeZone })}</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          {event ? <Button type="button" variant="ghost" className="text-destructive" disabled={pending} onClick={remove}><Trash2 data-icon="inline-start" />{text.t("editor.delete")}</Button> : <span />}
          <Button type="submit" disabled={pending}>{pending ? text.t("editor.saving") : text.t("editor.save")}</Button>
        </div>
      </form>
    </SettingsSheet>
  );
}
