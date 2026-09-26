import { ChartBarDecreasing, Clock, Funnel, Percent, TrendingDown } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

/** La org todavía no tiene deals: qué aparecerá aquí y dónde se crean. */
export async function FunnelEmptyState({ boardHref }: { boardHref: string }) {
  const t = await getTranslations("funnel.empty");
  const items = [
    { key: "conversion", icon: ChartBarDecreasing },
    { key: "time", icon: Clock },
    { key: "closeRate", icon: Percent },
    { key: "loss", icon: TrendingDown },
  ] as const;

  return (
    <div className="mx-auto mt-6 w-full max-w-lg rounded-3xl border bg-card/50 px-8 py-12 text-center md:mt-12">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
        <Funnel className="size-6" />
      </div>
      <h2 className="mt-6 text-2xl font-extrabold heading-tight">{t("title")}</h2>
      <p className="mt-3 text-muted-foreground">{t("body")}</p>
      <ul className="mx-auto mt-6 w-fit space-y-2.5 text-left text-sm">
        {items.map(({ key, icon: Icon }) => (
          <li key={key} className="flex items-center gap-3">
            <Icon aria-hidden className="size-4 shrink-0 text-primary" />
            {t(key)}
          </li>
        ))}
      </ul>
      <Button asChild className="mt-8">
        <Link href={boardHref}>
          {t("cta")}
          <KbdGroup aria-hidden className="ml-1">
            <Kbd className="bg-white/15 text-white">G</Kbd>
            <Kbd className="bg-white/15 text-white">P</Kbd>
          </KbdGroup>
        </Link>
      </Button>
    </div>
  );
}
