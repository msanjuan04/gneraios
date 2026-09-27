import { Boxes } from "lucide-react";
import type { SpaceData } from "@/components/portal/types";
import { portalCopy } from "@/server/portal/copy";
import { Chip, civil, EmptyState, SectionCard } from "../ui";
import { SPACE_SECTION_ICONS } from "./icons";

/** «Tus servicios»: las líneas vivas de sus contratos, por lo que incluyen (sin notas internas). */
export function ServicesSection({ data }: { data: SpaceData }) {
  const t = portalCopy(data.locale);
  const services = data.services ?? [];
  return (
    <SectionCard id="services" icon={SPACE_SECTION_ICONS.services} title={t("space.sections.services.title")} subtitle={t("space.sections.services.subtitle")}>
      {services.length === 0 ? (
        <EmptyState icon={Boxes}>{t("space.sections.services.empty")}</EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border bg-background/50">
          {services.map((service) => {
            const since =
              service.status === "scheduled" && service.startsOn
                ? t("space.sections.services.startsOn", { date: civil(service.startsOn, data.locale) })
                : service.startsOn
                  ? t("space.sections.services.since", { date: civil(service.startsOn, data.locale) })
                  : null;
            const until = service.endsOn ? t("space.sections.services.until", { date: civil(service.endsOn, data.locale) }) : null;
            return (
              <li key={service.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-4">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">{service.description}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{[service.contractTitle, [since, until].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Chip tone="primary">{t(`space.sections.services.types.${service.billingType}`)}</Chip>
                  {service.status !== "active" && (
                    <Chip tone={service.status === "paused" ? "warning" : "neutral"}>{t(`space.sections.services.states.${service.status}`)}</Chip>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
