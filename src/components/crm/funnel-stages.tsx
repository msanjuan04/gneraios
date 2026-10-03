import { getTranslations } from "next-intl/server";
import { dotsFor, type FunnelStage } from "@/domain/crm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * El embudo de un vistazo: una fila por etapa, con una bola por oportunidad y, al lado, lo que
 * suman esas oportunidades. Sin ponderar: es «cuánto entra si entran todas», que es lo que se
 * quiere ver aquí. La ponderada vive en el informe del embudo, donde hay sitio para explicarla.
 */
export async function FunnelStagesCard({
  stages,
  money,
  title,
  description,
}: {
  stages: FunnelStage[];
  money: (cents: number) => string;
  title?: string;
  description?: string;
}) {
  const t = await getTranslations("leads.funnel");
  const widest = Math.max(1, ...stages.map((stage) => stage.deals));

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title ?? t("title")}</CardTitle>
        <CardDescription>{description ?? t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 pt-5">
        {stages.map((stage) => {
          const { dots, rest } = dotsFor(stage.deals);
          return (
            <div key={stage.stageId} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-2 py-2 hover:bg-muted/40">
              <p className="w-32 shrink-0 text-sm font-semibold">{stage.name}</p>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {/* Las bolas: cuanto más ancha la fila, más hay. Un hueco también se ve. */}
                <span className="flex flex-wrap items-center gap-1" aria-hidden>
                  {Array.from({ length: dots }, (_, index) => (
                    <span
                      key={index}
                      className={cn(
                        "size-3 rounded-full",
                        stage.deals >= widest ? "bg-primary" : "bg-primary/60",
                      )}
                    />
                  ))}
                  {rest > 0 && <span className="text-xs font-semibold text-muted-foreground">+{rest}</span>}
                  {stage.deals === 0 && <span className="size-3 rounded-full border border-dashed border-muted-foreground/40" />}
                </span>
                <span className="text-sm font-bold tabular-nums">{stage.deals}</span>
              </div>
              <div className="ml-auto text-right">
                <p className="text-sm font-bold tabular-nums">{money(stage.oneOffCents)}</p>
                {stage.mrrCents > 0 && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t("perMonth", { amount: money(stage.mrrCents) })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
        <p className="pt-3 text-xs text-muted-foreground">{t("unweightedHint")}</p>
      </CardContent>
    </Card>
  );
}
