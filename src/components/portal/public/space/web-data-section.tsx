import { ChartNoAxesColumn } from "lucide-react";
import type { SpaceData } from "@/components/portal/types";
import { type PortalLocale, portalIntlLocale } from "@/domain/portal";
import { portalCopy } from "@/server/portal/copy";
import { civil, EmptyState, Eyebrow, SectionCard } from "../ui";
import { SPACE_SECTION_ICONS } from "./icons";

function formatNumber(value: number, locale: PortalLocale, digits = 0) {
  return new Intl.NumberFormat(portalIntlLocale(locale), { maximumFractionDigits: digits, minimumFractionDigits: digits, useGrouping: "always" }).format(value);
}

/** Variación neutra (sin colores de bueno o malo): son datos medidos, no una valoración. */
function formatChange(value: number, locale: PortalLocale, kind: "relative" | "positions") {
  if (kind === "positions") return `${value > 0 ? "+" : ""}${formatNumber(value, locale, 1)}`;
  return new Intl.NumberFormat(portalIntlLocale(locale), { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(value);
}

/** «Datos de tu web»: cifras medidas por Google de los últimos 28 días. Opcional y apagado por defecto. */
export function WebDataSection({ data }: { data: SpaceData }) {
  const t = portalCopy(data.locale);
  const web = data.webData;
  if (!web) {
    return (
      <SectionCard id="web_data" icon={SPACE_SECTION_ICONS.web_data} title={t("space.sections.web_data.title")}>
        <EmptyState icon={ChartNoAxesColumn}>{t("space.sections.web_data.empty")}</EmptyState>
      </SectionCard>
    );
  }
  const tiles = [
    { key: "clicks", label: t("space.sections.web_data.clicks"), value: web.clicks, change: web.change.clicks, kind: "relative" as const, digits: 0 },
    { key: "impressions", label: t("space.sections.web_data.impressions"), value: web.impressions, change: web.change.impressions, kind: "relative" as const, digits: 0 },
    // Sin variación: «+1,5» se lee al revés (bajar de número es subir en Google).
    { key: "position", label: t("space.sections.web_data.position"), value: web.position, change: null, kind: "positions" as const, digits: 1 },
    { key: "sessions", label: t("space.sections.web_data.sessions"), value: web.sessions, change: web.change.sessions, kind: "relative" as const, digits: 0 },
  ].filter((tile) => tile.value !== null);

  return (
    <SectionCard
      id="web_data"
      icon={SPACE_SECTION_ICONS.web_data}
      title={t("space.sections.web_data.title")}
      subtitle={t("space.sections.web_data.subtitle", { site: web.site })}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        {t("space.sections.web_data.range", { from: civil(web.range.from, data.locale, "medium"), to: civil(web.range.to, data.locale, "medium") })}
      </p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.key} className="rounded-2xl border bg-background/50 p-4">
            <dt>
              <Eyebrow>{tile.label}</Eyebrow>
            </dt>
            <dd className="mt-2">
              <span className="block text-3xl font-extrabold heading-tight tabular">{formatNumber(tile.value ?? 0, data.locale, tile.digits)}</span>
              {tile.change !== null && (
                <span className="mt-1 block text-xs text-muted-foreground tabular">
                  {t("space.sections.web_data.change", { value: formatChange(tile.change, data.locale, tile.kind) })}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-muted-foreground">
        {t("space.sections.web_data.measured")} {web.source === "demo" && t("space.sections.web_data.demo")}
      </p>
    </SectionCard>
  );
}
