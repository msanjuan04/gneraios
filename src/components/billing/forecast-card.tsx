import { getFormatter, getTranslations } from "next-intl/server";
import { SettingsCard } from "@/components/settings/settings-card";
import type { ForecastMonth } from "@/domain/billing/forecast";
import { formatMoney } from "@/domain/money";

/**
 * Facturación prevista de los próximos meses (base sin IVA): lo que el cron va a facturar con
 * los contratos firmados. Recurrente y puntual apilados, nunca sumados sin desglose.
 */
export async function ForecastCard({ months }: { months: ForecastMonth[] }) {
  const t = await getTranslations("billing.forecast");
  const format = await getFormatter();
  const money = (cents: number) => formatMoney(cents, { wholeUnits: true });
  const recurring = months.reduce((s, m) => s + m.recurringCents, 0);
  const oneOff = months.reduce((s, m) => s + m.oneOffCents, 0);
  const max = Math.max(1, ...months.map((m) => m.recurringCents + m.oneOffCents));
  const next3 = months.slice(0, 3).reduce((s, m) => s + m.recurringCents + m.oneOffCents, 0);

  return (
    <SettingsCard title={t("title", { months: months.length })} description={t("description")}>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-3xl font-extrabold tracking-[-0.035em] tabular">{money(recurring + oneOff)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("next3", { amount: money(next3) })}</p>
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-chart-1" /> {t("recurring")}
            </dt>
            <dd className="font-semibold tabular">{money(recurring)}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-chart-2" /> {t("oneOff")}
            </dt>
            <dd className="font-semibold tabular">{money(oneOff)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 flex h-40 items-end gap-1.5" role="img" aria-label={t("chartLabel")}>
        {months.map((m) => {
          const total = m.recurringCents + m.oneOffCents;
          const label = format.dateTime(new Date(`${m.month}T12:00:00Z`), { month: "short", timeZone: "UTC" });
          return (
            <div key={m.month} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <div
                className="flex w-full max-w-9 flex-col justify-end overflow-hidden rounded-md bg-muted transition-opacity group-hover:opacity-90"
                style={{ height: `${Math.max(2, (total / max) * 100)}%` }}
                title={`${label}: ${money(total)} · ${t("recurring")} ${money(m.recurringCents)} · ${t("oneOff")} ${money(m.oneOffCents)}`}
              >
                {m.oneOffCents > 0 && <div className="bg-chart-2" style={{ height: `${(m.oneOffCents / Math.max(1, total)) * 100}%` }} />}
                {m.recurringCents > 0 && (
                  <div className="bg-chart-1" style={{ height: `${(m.recurringCents / Math.max(1, total)) * 100}%` }} />
                )}
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label.replace(".", "")}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("footnote")}</p>
    </SettingsCard>
  );
}
