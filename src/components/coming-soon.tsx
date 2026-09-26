import { getTranslations } from "next-intl/server";
import { ALL_NAV_ITEMS, type NavKey } from "@/components/app-shell/nav-config";
import { Badge } from "@/components/ui/badge";

type ModuleKey = Exclude<NavKey, "dashboard" | "settings">;

/** Estado vacío de un módulo que aún no ha llegado: qué hará y en qué hito. */
export async function ComingSoon({ module }: { module: ModuleKey }) {
  const t = await getTranslations();
  const item = ALL_NAV_ITEMS.find((i) => i.key === module)!;
  const Icon = item.icon;

  return (
    <div className="mx-auto mt-10 max-w-lg rounded-3xl border bg-card/50 px-8 py-14 text-center md:mt-20">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
        <Icon className="size-6" />
      </div>
      <h2 className="mt-6 text-2xl font-extrabold heading-tight">{t(`nav.${module}`)}</h2>
      <p className="mt-3 text-muted-foreground">{t(`modules.${module}`)}</p>
      {item.hito && (
        <Badge variant="secondary" className="mt-6">
          {t("common.comingSoon", { hito: item.hito })}
        </Badge>
      )}
    </div>
  );
}
