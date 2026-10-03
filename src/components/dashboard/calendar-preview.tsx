"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, RefreshCw } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DraftEvent = { id: number; title: string; date: string; time: string };

function iso(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }

export function CalendarPreview() {
  const today = new Date();
  const [anchor, setAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [events, setEvents] = useState<DraftEvent[]>([]);
  const [editorDate, setEditorDate] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("09:00");
  const weekdays = ["L", "M", "X", "J", "V", "S", "D"];
  const cells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => new Date(anchor.getFullYear(), anchor.getMonth(), i - offset + 1));
  }, [anchor]);

  function move(months: number) { setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + months, 1)); }
  function open(date: string) { setEditorDate(date); setTitle(""); setTime("09:00"); }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editorDate || !title.trim()) return;
    setEvents((current) => [...current, { id: Date.now(), title: title.trim(), date: editorDate, time }]);
    setEditorDate(null);
  }

  const rawMonthTitle = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(anchor);
  const monthTitle = rawMonthTitle[0].toUpperCase() + rawMonthTitle.slice(1);
  return <div className="space-y-5 pb-8">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Agenda operativa</p><h2 className="mt-1 text-4xl font-extrabold heading-tight md:text-5xl">Calendario</h2><p className="mt-2 text-muted-foreground">Reuniones propias, entregas, tareas y fechas importantes en un solo lugar.</p></div>
      <Button onClick={() => open(iso(today))}><Plus data-icon="inline-start" />Nuevo evento</Button>
    </header>
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h3 className="mr-auto text-xl font-bold heading-tight">{monthTitle}</h3>
          <Button variant="outline" size="sm" onClick={() => setAnchor(new Date(today.getFullYear(), today.getMonth(), 1))}>Hoy</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Mes anterior" onClick={() => move(-1)}><ChevronLeft /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Mes siguiente" onClick={() => move(1)}><ChevronRight /></Button>
        </div>
        <div className="grid grid-cols-7 border-b bg-muted/25 text-center text-xs font-semibold text-muted-foreground">{weekdays.map((day, index) => <div className="py-2" key={index}>{day}</div>)}</div>
        <div className="grid grid-cols-7">{cells.map((day) => {
          const date = iso(day);
          const matches = events.filter((event) => event.date === date);
          const current = day.getMonth() === anchor.getMonth();
          return <button key={date} type="button" onClick={() => open(date)} className={`min-h-20 border-r border-b p-1.5 text-left outline-none transition-colors hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/50 sm:min-h-24 ${current ? "" : "bg-muted/15 text-muted-foreground/45"}`}>
            <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${date === iso(today) ? "bg-primary text-primary-foreground" : ""}`}>{day.getDate()}</span>
            {matches.slice(0, 2).map((event) => <span key={event.id} className="mt-1 block truncate rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary sm:text-xs">{event.time} {event.title}</span>)}
            {matches.length > 2 && <span className="text-[10px] text-muted-foreground">+{matches.length - 2} más</span>}
          </button>;
        })}</div>
      </section>
      <aside className="space-y-3">
        <div className="rounded-2xl border bg-card p-4"><div className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-primary" /> Próximas fechas</div><p className="mt-4 text-sm text-muted-foreground">Las entregas y compromisos reales aparecerán aquí.</p></div>
        <div className="rounded-2xl border bg-card p-4"><div className="flex items-center gap-2 text-sm font-semibold"><RefreshCw className="size-4 text-primary" /> Google Calendar</div><p className="mt-2 text-sm text-muted-foreground">Cada miembro conectará su cuenta y tendrá un calendario secundario GNERAI OS, seleccionable desde el calendario del móvil.</p><p className="mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">Esta preview no está conectada. La sincronización real requiere autorización de Google y la base de datos activa.</p></div>
        <div className="rounded-2xl border bg-card p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Clock3 className="size-4 text-primary" /> Datos de esta preview</div><p className="mt-2 text-sm text-muted-foreground">Los eventos que añadas aquí son temporales. La aplicación real los guardará en tu organización.</p></div>
      </aside>
    </div>
    <SettingsSheet open={editorDate !== null} onOpenChange={(open) => { if (!open) setEditorDate(null); }} title="Nuevo evento">
      <form onSubmit={save} className="flex min-h-0 flex-1 flex-col"><div className="flex-1 space-y-4 p-5">
        <p className="text-sm text-muted-foreground">Prueba de interfaz: este evento no se guarda fuera de tu navegador.</p>
        <label className="block space-y-1 text-sm font-semibold"><span>Título</span><Input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></label>
        <label className="block space-y-1 text-sm font-semibold"><span>Fecha</span><Input type="date" value={editorDate ?? ""} onChange={(e) => setEditorDate(e.target.value)} required /></label>
        <label className="block space-y-1 text-sm font-semibold"><span>Hora</span><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></label>
      </div><div className="border-t p-5"><Button type="submit" className="w-full">Añadir a la preview</Button></div></form>
    </SettingsSheet>
  </div>;
}
