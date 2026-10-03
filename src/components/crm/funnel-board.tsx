import { getTranslations } from "next-intl/server";
import { dotsFor, type FunnelStage } from "@/domain/crm";
import { cn } from "@/lib/utils";

/**
 * El embudo, a lo que se ve de un vistazo: una caja por etapa, con una bola por oportunidad que
 * cae dentro, y a la derecha cuántas son y cuánto suman (sin ponderar: lo que entra si entran todas).
 *
 * La forma no depende de los datos: la primera etapa es siempre la más ancha y cada una es más
 * estrecha que la anterior, aunque tenga más oportunidades. Es un embudo, no un gráfico de barras:
 * lo que dice cuántas hay son las bolas y el número.
 */

/** Cuánto se estrecha cada caja respecto de la anterior; nunca baja de la mitad del ancho. */
const TAPER_FROM = 100;
const TAPER_TO = 56;

const widthOf = (index: number, count: number): number =>
  count <= 1 ? TAPER_FROM : Math.round(TAPER_FROM - ((TAPER_FROM - TAPER_TO) * index) / (count - 1));

export async function FunnelBoard({
  stages,
  money,
  compact = false,
  className,
}: {
  stages: FunnelStage[];
  money: (cents: number) => string;
  /** Para columnas estrechas: las bolas más pequeñas y las cajas más bajas. */
  compact?: boolean;
  className?: string;
}) {
  const t = await getTranslations("funnel.board");
  const total = stages.reduce((sum, stage) => (stage.kind === "open" ? sum + stage.deals : sum), 0);

  return (
    <section aria-label={t("label")} className={cn("w-full", className)}>
      <ol className="space-y-2">
        {stages.map((stage, index) => {
          const { dots, rest } = dotsFor(stage.deals, compact ? 14 : 28);
          const won = stage.kind === "won";
          const width = widthOf(index, stages.length);
          return (
            <li
              key={stage.stageId}
              className={cn("grid items-stretch gap-3", compact ? "grid-cols-[minmax(0,1fr)_6.5rem]" : "grid-cols-[minmax(0,1fr)_11rem] md:gap-6")}
            >
              {/* La caja: centrada y cada vez más estrecha. Las bolas caen y se apilan abajo. */}
              <div className="flex justify-center">
                <div
                  style={{ width: `${width}%` }}
                  className={cn(
                    "relative flex flex-col justify-between overflow-hidden rounded-2xl border px-4 pb-3 pt-2.5",
                    compact ? "min-h-20" : "min-h-28",
                    won ? "border-success/40 bg-success/10" : "border-primary/25 bg-primary/[0.06]",
                  )}
                >
                  <p className="truncate text-xs font-bold uppercase tracking-wide text-muted-foreground">{stage.name}</p>
                  <div className="mt-2 flex flex-wrap-reverse content-start justify-center gap-1.5" aria-hidden>
                    {Array.from({ length: dots }, (_, dot) => (
                      <span
                        key={dot}
                        style={{ "--i": dot, "--row": index } as React.CSSProperties}
                        className={cn(
                          "gos-ball rounded-full shadow-sm",
                          compact ? "size-3.5" : "size-5",
                          won ? "bg-success" : "bg-primary",
                        )}
                      />
                    ))}
                    {rest > 0 && <span className="self-center pl-1 text-xs font-bold text-muted-foreground">+{rest}</span>}
                    {stage.deals === 0 && <span className="py-1.5 text-xs text-muted-foreground/70">{t("empty")}</span>}
                  </div>
                </div>
              </div>

              {/* Los números, siempre a la derecha y alineados entre etapas. */}
              <div className="flex flex-col justify-center text-right">
                <p className={cn("font-extrabold tabular-nums leading-none heading-tight", compact ? "text-2xl" : "text-4xl")}>{stage.deals}</p>
                <p className={cn("mt-1.5 font-bold tabular-nums", compact ? "text-xs" : "text-base")}>
                  {stage.estimated && <span title={t("estimatedHint")}>≈ </span>}
                  {money(stage.oneOffCents)}
                </p>
                {stage.mrrCents > 0 && (
                  <p className={cn("tabular-nums text-muted-foreground", compact ? "text-[11px]" : "text-sm")}>
                    {t("perMonth", { amount: money(stage.mrrCents) })}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">{t("hint", { count: total })}</p>
    </section>
  );
}
