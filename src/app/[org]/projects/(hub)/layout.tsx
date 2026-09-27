import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ProjectsTabs } from "@/components/projects/projects-tabs";

// Tipado a mano: la ruta es nueva y los tipos de rutas de Next se regeneran con `next dev`/`next build`.
type Props = { children: ReactNode; params: Promise<{ org: string }> };

/** Proyectos: el listado, "Mis tareas" y las plantillas, con sus pestañas (la ficha de un proyecto va aparte). */
export default async function ProjectsHubLayout({ children, params }: Props) {
  const { org } = await params;
  const t = await getTranslations("projects.tabs");
  return (
    <div className="mx-auto max-w-7xl">
      <ProjectsTabs
        tabs={[
          { href: `/${org}/projects`, label: t("projects") },
          { href: `/${org}/projects/tasks`, label: t("myTasks") },
          { href: `/${org}/projects/templates`, label: t("templates") },
        ]}
      />
      {children}
    </div>
  );
}
