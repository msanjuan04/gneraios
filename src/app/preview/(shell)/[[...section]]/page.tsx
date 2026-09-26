import { notFound } from "next/navigation";
import { brand } from "@/brand";
import { ComingSoon } from "@/components/coming-soon";
import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { DesignShowcase } from "@/components/dashboard/design-showcase";
import { VERIFACTU_FROM } from "@/domain/tax/spain-defaults";
import { nowInZone } from "@/lib/clock";

const MODULES = ["pipeline", "clients", "quotes", "contracts", "invoices"] as const;
type Module = (typeof MODULES)[number];

function isModule(value: string): value is Module {
  return (MODULES as readonly string[]).includes(value);
}

export default async function PreviewPage(props: PageProps<"/preview/[[...section]]">) {
  const { section } = await props.params;
  const [first, ...rest] = section ?? [];
  if (rest.length > 0) notFound();

  if (!first) {
    const clock = nowInZone("Europe/Madrid");
    return (
      <DashboardHome
        data={{
          firstName: "Socio",
          basePath: "/preview",
          today: clock.date,
          hour: clock.hour,
          issuers: [
            {
              kind: "company",
              legalName: `${brand.name} SL`,
              hasTaxId: false,
              isPrimary: true,
              verifactuFrom: VERIFACTU_FROM.company,
              provider: "internal",
            },
            {
              kind: "self_employed",
              legalName: "Socio de ejemplo",
              hasTaxId: true,
              isPrimary: false,
              verifactuFrom: VERIFACTU_FROM.self_employed,
              provider: "internal",
            },
          ],
          memberCount: 1,
          pendingInvites: 2,
          clientCount: 0,
        }}
      />
    );
  }

  if (first === "settings") return <DesignShowcase />;
  if (isModule(first)) return <ComingSoon module={first} />;
  notFound();
}
