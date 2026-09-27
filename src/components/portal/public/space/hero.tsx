import { CircleCheck, FileSignature, Layers, Receipt, Route } from "lucide-react";
import type { ReactNode } from "react";
import { brand } from "@/brand";
import type { SpaceData } from "@/components/portal/types";
import { portalCopy } from "@/server/portal/copy";
import { SPACE_SECTION_ICONS } from "./icons";

function Highlight({ href, icon, tone = "neutral", children }: { href: string; icon: ReactNode; tone?: "neutral" | "warning" | "success"; children: ReactNode }) {
  const tones = { neutral: "text-primary", warning: "text-warning", success: "text-success" } as const;
  return (
    <a
      href={href}
      className="glass inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className={tones[tone]}>{icon}</span>
      {children}
    </a>
  );
}

/** El saludo: su nombre, en su idioma, y lo importante de un vistazo (solo hechos, nada de promesas). */
export function SpaceHero({ data }: { data: SpaceData }) {
  const t = portalCopy(data.locale);
  const on = new Set(data.sections);
  const project = data.progress?.projects.find((p) => p.progress.ratio < 1) ?? data.progress?.projects[0];
  const toPay = data.documents?.invoices.filter((i) => i.payment).length ?? 0;
  const hasInvoices = (data.documents?.invoices.length ?? 0) > 0;
  const openQuotes = data.documents?.quotes.filter((q) => q.state === "open").length ?? 0;
  const activeServices = data.services?.filter((s) => s.status === "active").length ?? 0;

  return (
    <header className="portal-rise">
      <p className="text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">{t("brand.space", { brand: brand.name })}</p>
      <h1 className="mt-3 text-4xl font-extrabold heading-tight text-balance sm:text-6xl">
        {t.rich(`space.greeting.${data.greeting}`, {
          name: data.clientName,
          // Su nombre, con el degradado secundario de la web.
          hl: (chunks) => <span className="bg-brand-gradient-secondary bg-clip-text text-transparent">{chunks}</span>,
        })}
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t("space.intro", { brand: brand.name })}</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {on.has("progress") && project && project.progress.total > 0 && (
          <Highlight href="#progress" icon={<Route className="size-4" aria-hidden />}>
            {t("space.highlights.phases", { done: project.progress.done, total: project.progress.total })}
          </Highlight>
        )}
        {on.has("documents") && toPay > 0 && (
          <Highlight href="#documents" tone="warning" icon={<Receipt className="size-4" aria-hidden />}>
            {t("space.highlights.toPay", { count: toPay })}
          </Highlight>
        )}
        {on.has("documents") && toPay === 0 && hasInvoices && (
          <Highlight href="#documents" tone="success" icon={<CircleCheck className="size-4" aria-hidden />}>
            {t("space.highlights.allPaid")}
          </Highlight>
        )}
        {on.has("documents") && openQuotes > 0 && (
          <Highlight href="#documents" icon={<FileSignature className="size-4" aria-hidden />}>
            {t("space.highlights.quotes", { count: openQuotes })}
          </Highlight>
        )}
        {on.has("services") && activeServices > 0 && (
          <Highlight href="#services" icon={<Layers className="size-4" aria-hidden />}>
            {t("space.highlights.services", { count: activeServices })}
          </Highlight>
        )}
      </div>
    </header>
  );
}

/** Índice de secciones: píldoras con anclas, sin JavaScript. */
export function SpaceNav({ data }: { data: SpaceData }) {
  const t = portalCopy(data.locale);
  if (data.sections.length < 2) return null;
  return (
    <nav aria-label={t("space.nav")} className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2">
        {data.sections.map((key) => {
          const Icon = SPACE_SECTION_ICONS[key];
          return (
            <li key={key}>
              <a
                href={`#${key}`}
                className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3.5 py-1.5 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Icon className="size-4" aria-hidden />
                {t(`space.sections.${key}.title`)}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
