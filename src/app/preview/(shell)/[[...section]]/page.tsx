import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/coming-soon";
import { LeadsPreview, OperationalPreview } from "@/components/dashboard/operational-preview";
import { DesignShowcase } from "@/components/dashboard/design-showcase";
import { ModulePreview } from "@/components/dashboard/module-preview";
import { CalendarPreview } from "@/components/dashboard/calendar-preview";
import { AdsPreview } from "@/components/dashboard/ads-preview";

const MODULES = ["pipeline", "clients", "quotes", "projects", "contracts", "invoices", "finance"] as const;
type Module = (typeof MODULES)[number];

function isModule(value: string): value is Module {
  return (MODULES as readonly string[]).includes(value);
}

export default async function PreviewPage(props: PageProps<"/preview/[[...section]]">) {
  const { section } = await props.params;
  const [first, ...rest] = section ?? [];
  if (rest.length > 0) notFound();

  if (!first) return <OperationalPreview />;
  if (first === "leads") return <LeadsPreview />;
  if (first === "calendar") return <CalendarPreview />;
  if (first === "ads") return <AdsPreview />;

  if (isModule(first)) return <ModulePreview module={first} />;

  if (first === "settings") return <DesignShowcase />;
  if (first === "council" || first === "seo" || first === "sites") return <ComingSoon module={first} />;
  notFound();
}
