import { ArrowRight, CalendarCheck2, Clock3 } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { type CalendarEvent, eventDetail, eventSummary, formatAmount, type Translate } from "@/domain/calendar";
import { addDays } from "@/domain/dates/civil-date";
import { cn } from "@/lib/utils";
import type { UpcomingWeek } from "@/server/calendar/upcoming";
import { EventIcon } from "./event-icon";
import { eventColor } from "./event-style";
import { formatDay } from "./format";

/** Eventos que caben en la tarjeta; el resto, en el calendario. */
const MAX_ROWS = 8;

/**
 * "Esta semana" para el dashboard: lo que pasa en los próximos 7 días (cobros, plazos, acciones,
 * reuniones…) y lo atrasado que aún pide algo. Se carga con `loadUpcomingWeek` (src/server/calendar).
 */
export async function UpcomingWeekCard({ data, className }: { data: UpcomingWeek; className?: string }) {
  const t = await getTranslations("calendar");
  const locale = await getLocale();
  const translate: Translate = (key, values) => t(key, values);
  const format = { t: translate, moneyLocale: data.money.locale, currency: data.money.currency };
  const calendarHref = `${data.basePath}/calendar`;
  const agendaHref = `${calendarHref}?view=agenda${data.mine ? "&mine=1" : ""}`;

  const days = fillRows(data.days, MAX_ROWS);
  const total = data.days.reduce((sum, day) => sum + day.events.length, 0);
  const shownCount = days.reduce((sum, day) => sum + day.shown.length, 0);

  const dayLabel = (date: string) => {
    if (date === data.today) return t("agenda.todayShort");
    if (date === addDays(data.today, 1)) return t("agenda.tomorrowShort");
    return formatDay(date, locale, { weekday: "long", day: "numeric" });
  };

  return (
    <section className={cn("flex flex-col rounded-2xl border bg-card text-sm", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-bold">{t("upcoming.title")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("upcoming.description")}</p>
        </div>
        {data.overdue.length > 0 && (
          <Link
            href={agendaHref}
            className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive tabular hover:bg-destructive/15"
          >
            <Clock3 aria-hidden className="size-3.5" />
            {t("upcoming.overdue", { count: data.overdue.length })}
          </Link>
        )}
      </header>

      <div className="flex flex-1 flex-col gap-3 p-5">
        {days.length === 0 ? (
          <div className="flex min-h-32 flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
            <CalendarCheck2 aria-hidden className="size-5 text-success" />
            {t("upcoming.empty")}
          </div>
        ) : (
          <ol className="space-y-3">
            {days.map((day) => (
              <li key={day.date}>
                <p className={cn("mb-1 text-xs font-semibold first-letter:uppercase", day.date === data.today ? "text-primary" : "text-muted-foreground")}>
                  {dayLabel(day.date)}
                </p>
                <ul className="-mx-2 space-y-0.5">
                  {day.shown.map((event) => (
                    <UpcomingRow key={event.id} event={event} basePath={data.basePath} t={translate} format={format} />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
          <span className="tabular">
            {data.collections.expectedCount > 0
              ? t("upcoming.collections", {
                  amount: formatAmount(data.collections.expectedCents, null, format),
                  count: data.collections.expectedCount,
                })
              : t("upcoming.noCollections")}
            {total > shownCount && ` · ${t("upcoming.more", { count: total - shownCount })}`}
          </span>
          <Link href={calendarHref} className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline">
            {t("upcoming.open")}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Los días con algo, en orden, hasta llenar la tarjeta con `max` eventos. */
function fillRows(days: UpcomingWeek["days"], max: number) {
  const out: (UpcomingWeek["days"][number] & { shown: CalendarEvent[] })[] = [];
  let left = max;
  for (const day of days) {
    if (left <= 0) break;
    if (day.events.length === 0) continue;
    const shown = day.events.slice(0, left);
    left -= shown.length;
    out.push({ ...day, shown });
  }
  return out;
}

function UpcomingRow({
  event,
  basePath,
  t,
  format,
}: {
  event: CalendarEvent;
  basePath: string;
  t: Translate;
  format: { t: Translate; moneyLocale: string; currency: string };
}) {
  const detail = eventDetail(event, t);
  const amount = event.amountCents === null ? null : formatAmount(event.amountCents, event.amountPeriod, format);
  const href = event.href ? `${basePath}${event.href}` : `${basePath}/calendar`;
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <EventIcon event={event} aria-hidden className="size-4 shrink-0" style={{ color: eventColor(event) }} />
        {event.time && <span className="shrink-0 text-xs font-semibold tabular text-muted-foreground">{event.time}</span>}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium", event.status === "overdue" && "text-destructive")}>{eventSummary(event, t)}</span>
          {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
        </span>
        {amount && <span className="shrink-0 font-semibold tabular">{amount}</span>}
      </Link>
    </li>
  );
}
