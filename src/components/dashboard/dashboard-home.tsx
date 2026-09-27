import { CircleCheck, Circle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type DashboardIssuer = {
  kind: "company" | "self_employed";
  legalName: string;
  hasTaxId: boolean;
  isPrimary: boolean;
  verifactuFrom: string;
  provider: string;
};

export type DashboardData = {
  firstName: string;
  basePath: string;
  /** Hoy en la zona de la org, YYYY-MM-DD. */
  today: string;
  /** Hora local de la org (0-23), para el saludo. */
  hour: number;
  issuers: DashboardIssuer[];
  memberCount: number;
  pendingInvites: number;
  clientCount: number;
  /** Lo que se prepara una vez y hace que todo lo demás vaya rodado (opcional en /preview). */
  catalogCount?: number;
  googleConnected?: boolean;
  goalsSet?: boolean;
};

function daysUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export async function DashboardHome({ data }: { data: DashboardData }) {
  const t = await getTranslations("dashboard");
  const tShell = await getTranslations("shell");
  const format = await getFormatter();

  const greeting = data.hour < 14 ? "greetingMorning" : data.hour < 21 ? "greetingAfternoon" : "greetingEvening";
  const company = data.issuers.find((i) => i.kind === "company");

  // El próximo emisor que queda obligado a Verifactu sin proveedor adaptado.
  const nextVerifactu = data.issuers
    .filter((i) => i.provider === "internal")
    .map((i) => ({ ...i, days: daysUntil(data.today, i.verifactuFrom) }))
    .filter((i) => i.days >= 0)
    .sort((a, b) => a.days - b.days)[0];

  const kpis = ["kpiMrr", "kpiArr", "kpiRevenue", "kpiReceivables"] as const;

  const steps = [
    { done: true, label: t("setupOrg") },
    { done: data.issuers.length > 0, label: t("setupIssuers", { count: data.issuers.length }) },
    ...(company ? [{ done: company.hasTaxId, label: t("setupCompanyTaxId") }] : []),
    {
      done: data.memberCount > 1,
      label: data.pendingInvites > 0 ? t("setupInvitePending", { count: data.pendingInvites }) : t("setupInvite"),
    },
    {
      done: data.clientCount > 0,
      label: t("setupCrm"),
      action: data.clientCount > 0 ? undefined : { href: `${data.basePath}/settings/data`, label: t("setupImportAction") },
    },
    {
      done: (data.catalogCount ?? 0) > 0,
      label: t("setupCatalog"),
      action: (data.catalogCount ?? 0) > 0 ? undefined : { href: `${data.basePath}/settings/catalog`, label: t("setupCatalogAction") },
    },
    {
      done: data.googleConnected === true,
      label: t("setupGoogle"),
      action: data.googleConnected ? undefined : { href: `${data.basePath}/seo`, label: t("setupGoogleAction") },
    },
    {
      done: data.goalsSet === true,
      label: t("setupGoals"),
      action: data.goalsSet ? undefined : { href: `${data.basePath}/settings#goals`, label: t("setupGoalsAction") },
    },
    { done: false, label: t("setupPush"), action: { href: `${data.basePath}/settings/preferences#push`, label: t("setupPushAction") } },
    // Solo se ve mientras no hay contratos ni facturas: en cuanto los hay, el dashboard es el de métricas.
    { done: false, label: t("setupBilling"), action: { href: `${data.basePath}/contracts`, label: t("setupBillingAction") } },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-10">
        <h2 className="text-4xl font-extrabold heading-tight md:text-5xl">
          {tShell(greeting, { name: data.firstName })}
        </h2>
        <p className="mt-3 text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k} className="gap-2">
            <CardHeader>
              <CardDescription className="font-semibold uppercase tracking-wider text-[11px]">{t(k)}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-extrabold tabular text-muted-foreground/60">—</p>
              <p className="mt-2 text-xs text-muted-foreground">{t("kpiPending")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t("setupTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  {s.done ? (
                    <CircleCheck className="size-5 shrink-0 text-success" />
                  ) : (
                    <Circle className="size-5 shrink-0 text-muted-foreground/50" />
                  )}
                  <span className={cn(s.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                    {s.label}
                  </span>
                  {"action" in s && s.action && (
                    <Link
                      href={s.action.href}
                      className="ml-auto shrink-0 text-xs font-semibold text-primary underline-offset-4 hover:underline"
                    >
                      {s.action.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <Button asChild variant="secondary" size="sm" className="mt-6">
              <Link href={`${data.basePath}/settings`}>{t("goSettings")}</Link>
            </Button>
          </CardContent>
        </Card>

        {nextVerifactu && (
          <Card className="relative overflow-hidden lg:col-span-2">
            <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5 text-primary" />
                {t("verifactuTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-5xl font-extrabold tabular heading-tight">{nextVerifactu.days}</p>
              <p className="mt-3 text-sm text-muted-foreground">
                {t("verifactuBody", {
                  issuer: nextVerifactu.legalName,
                  date: format.dateTime(new Date(`${nextVerifactu.verifactuFrom}T12:00:00Z`), { dateStyle: "long" }),
                  days: nextVerifactu.days,
                })}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">{t("verifactuHint")}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
