import { getTranslations } from "next-intl/server";
import { PipelineTabs } from "./pipeline-tabs";

/** Pipeline: el tablero del día a día y el embudo para analizarlo. */
export default async function PipelineLayout({ children, params }: LayoutProps<"/[org]/pipeline">) {
  const { org } = await params;
  const t = await getTranslations("pipeline.tabs");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PipelineTabs
        tabs={[
          { href: `/${org}/pipeline`, label: t("board") },
          { href: `/${org}/pipeline/funnel`, label: t("funnel") },
        ]}
      />
      {children}
    </div>
  );
}
