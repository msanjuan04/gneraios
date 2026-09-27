import {
  BellRing,
  BrainCircuit,
  ChevronRight,
  CircleCheck,
  FilePen,
  FileText,
  HandCoins,
  HeartPulse,
  Landmark,
  Hourglass,
  type LucideIcon,
  ReceiptEuro,
  SquareKanban,
  TrendingDown,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import type { ActionQueueItem, ActionQueueKey } from "@/server/metrics/action-queue";
import { money } from "./format";
import type { MoneyFormat } from "./types";

const ICONS: Record<ActionQueueKey, LucideIcon> = {
  drafts: FilePen,
  reminders: BellRing,
  expiringQuotes: Hourglass,
  waitingQuotes: FileText,
  staleDeals: SquareKanban,
  overdueExpenses: ReceiptEuro,
  dueExpenses: Wallet,
  rebills: HandCoins,
  clientsAtRisk: HeartPulse,
  bankPending: Landmark,
  recommendations: BrainCircuit,
  profitability: TrendingDown,
};

const TONES: Record<ActionQueueItem["tone"], string> = {
  default: "bg-primary/10 text-primary",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

/** "Por hacer": lo que espera a que un socio haga algo, con un clic hasta donde se hace. */
export async function ActionQueueCard({ items, money: fmt, className }: { items: ActionQueueItem[]; money: MoneyFormat; className?: string }) {
  const t = await getTranslations("dashboard.actionQueue");
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className={cn("flex flex-col rounded-2xl border bg-card text-sm", className)}>
      <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-bold">{t("title")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("description")}</p>
        </div>
        {total > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular">{total}</span>
        )}
      </header>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center text-muted-foreground">
          <CircleCheck aria-hidden className="size-6 text-success" />
          <p className="font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="text-xs">{t("empty")}</p>
        </div>
      ) : (
        <ul className="flex-1 space-y-0.5 p-2">
          {items.map((item) => {
            const Icon = ICONS[item.key];
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONES[item.tone])}>
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium leading-snug">{t(`items.${item.key}.title`, { count: item.count })}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="line-clamp-1">{t(`items.${item.key}.hint`)}</span>
                      {item.amountCents !== null && item.amountCents > 0 && (
                        <span className="font-semibold text-foreground tabular">{money(item.amountCents, fmt)}</span>
                      )}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
