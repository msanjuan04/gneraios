import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { CivilDate } from "@/domain/dates/civil-date";
import { formatMoney } from "@/domain/money";
import { formatPortalDate, type PortalLocale, portalIntlLocale } from "@/domain/portal";
import { cn } from "@/lib/utils";

export { pillClass } from "./pill";

// Piezas de las páginas públicas: servidor puro (sin JS en el navegador) y solo con tokens de
// marca, para que sigan el tema del sistema del cliente (theme.ts).

export const money = (cents: number, locale: PortalLocale) => formatMoney(cents, { locale: portalIntlLocale(locale) });

export const civil = (date: CivilDate, locale: PortalLocale, style: "long" | "medium" | "short" = "long") =>
  formatPortalDate(date, locale, style);

export function SectionCard({
  id,
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "portal-rise rounded-3xl border bg-card/80 p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur-sm sm:p-7",
        className,
      )}
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]">
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={headingId} className="text-xl font-extrabold heading-tight sm:text-2xl">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/12 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/12 text-destructive",
} as const;

export function Chip({ tone = "neutral", children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Etiqueta pequeña en mayúsculas espaciadas, como las del PDF. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase", className)}>{children}</p>;
}
