import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { civil } from "./meta";

/** Los informes anteriores de un tipo, para abrir cualquiera. */
export async function ReportHistory({
  items,
  activeId,
  href,
  kind,
}: {
  items: { id: string; periodStart: string; periodEnd: string; status: string }[];
  activeId: string | null;
  href: (id: string) => string;
  kind: "weekly_briefing" | "monthly_close";
}) {
  const t = await getTranslations("council.history");
  const format = await getFormatter();
  if (items.length <= 1) return null;
  const label = (item: (typeof items)[number]) =>
    kind === "monthly_close"
      ? format.dateTime(civil(item.periodStart), { month: "long", year: "numeric" })
      : `${format.dateTime(civil(item.periodStart), { day: "numeric", month: "short" })} – ${format.dateTime(civil(item.periodEnd), { day: "numeric", month: "short" })}`;
  return (
    <nav aria-label={t("label")} className="rounded-2xl border bg-card">
      <h3 className="border-b px-4 py-3 text-sm font-bold">{t(kind)}</h3>
      <ul className="max-h-80 overflow-y-auto py-1">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={href(item.id)}
              aria-current={item.id === activeId ? "page" : undefined}
              className={cn("flex items-center justify-between gap-2 px-4 py-1.5 text-sm hover:bg-muted/50", item.id === activeId && "font-semibold text-primary")}
            >
              <span className="first-letter:uppercase">{label(item)}</span>
              {item.status === "accepted" && <span className="text-[11px] text-success">{t("accepted")}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
