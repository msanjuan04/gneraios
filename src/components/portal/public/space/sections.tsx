import type { ReactNode } from "react";
import type { SpaceData } from "@/components/portal/types";
import type { PortalSectionKey } from "@/domain/portal";
import { DocumentsSection } from "./documents-section";
import { AdsSection } from "./ads-section";
import { FilesSection } from "./files-section";
import { ProgressSection } from "./progress-section";
import { RequestsSection } from "./requests-section";
import { ServicesSection } from "./services-section";
import { WebDataSection } from "./web-data-section";
import { WorkLogSection } from "./work-log-section";

type SectionProps = { data: SpaceData; token: string };

/**
 * Qué pinta cada sección de «Tu espacio». El orden y cuáles se ven vienen de los datos
 * (PORTAL_SECTIONS en src/domain/portal/sections.ts y los ajustes del cliente): añadir una
 * sección es escribir su componente, añadirla aquí y a esa lista.
 */
const SECTIONS: Record<PortalSectionKey, (props: SectionProps) => ReactNode> = {
  progress: ProgressSection,
  work_log: WorkLogSection,
  files: FilesSection,
  services: ServicesSection,
  documents: DocumentsSection,
  requests: RequestsSection,
  web_data: WebDataSection,
  ads: AdsSection,
};

export function SpaceSections({ data, token }: SectionProps) {
  return (
    <div className="space-y-6">
      {data.sections.map((key) => {
        const Section = SECTIONS[key];
        return <Section key={key} data={data} token={token} />;
      })}
    </div>
  );
}
