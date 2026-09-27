"use client";

import {
  ArrowRightLeft,
  Banknote,
  CirclePlus,
  CircleX,
  FileSignature,
  type LucideIcon,
  NotebookPen,
  Plus,
  Receipt,
  ReceiptText,
  SquareKanban,
  Trash2,
  Trophy,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteActivity } from "@/app/[org]/clients/actions";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import { ACTIVITY_ICONS } from "./activity-icons";
import { MemberAvatar } from "./member-avatar";
import type { TimelineEntry } from "./types";

type ActivityEntry = Extract<TimelineEntry, { type: "activity" }>;

type Props = {
  slug: string;
  basePath: string;
  clientId: string;
  timeline: TimelineEntry[];
  truncated: boolean;
  timeZone: string;
  now: number;
  canEdit: boolean;
  onLogActivity: () => void;
};

function stageIcon(entry: Extract<TimelineEntry, { type: "stage" }>): { icon: LucideIcon; tone: string } {
  if (entry.toKind === "won") return { icon: Trophy, tone: "border-success/30 bg-success/10 text-success" };
  if (entry.toKind === "lost") return { icon: CircleX, tone: "border-destructive/30 bg-destructive/10 text-destructive" };
  if (entry.kind === "deal_created") return { icon: CirclePlus, tone: "border-primary/30 bg-primary/10 text-primary" };
  return { icon: ArrowRightLeft, tone: "text-muted-foreground" };
}

type BillingEntry = Extract<TimelineEntry, { type: "billing" }>;

const BILLING_ICONS: Record<BillingEntry["kind"], { icon: LucideIcon; tone: string; key: string }> = {
  contract_signed: { icon: FileSignature, tone: "border-primary/30 bg-primary/10 text-primary", key: "contractSigned" },
  invoice_issued: { icon: Receipt, tone: "text-foreground", key: "invoiceIssued" },
  invoice_rectifying: { icon: ReceiptText, tone: "border-warning/30 bg-warning/10 text-warning", key: "invoiceRectifying" },
  payment: { icon: Banknote, tone: "border-success/30 bg-success/10 text-success", key: "payment" },
};

/** Timeline 360: la actividad humana, los cambios de etapa y la facturación, de lo más reciente a lo más antiguo. */
/** Eventos que se ven al abrir la ficha; el resto, con «Ver toda la actividad». */
const INITIAL_ENTRIES = 15;
const TIMELINE_FILTERS = ["all", "activity", "billing", "stage"] as const;
type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

export function ActivityCard({ slug, basePath, clientId, timeline, truncated, timeZone, now, canEdit, onLogActivity }: Props) {
  const t = useTranslations("clients.activity");
  const tKind = useTranslations("crm.activityKind");
  const tCrm = useTranslations("crm");
  const format = useFormatter();
  const [deleting, setDeleting] = useState<{ open: boolean; entry: ActivityEntry | null }>({ open: false, entry: null });
  const [pending, startTransition] = useTransition();
  // Un cliente con años de historia tiene cientos de eventos: se ven los últimos y el resto a demanda.
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const filtered = filter === "all" ? timeline : timeline.filter((entry) => entry.type === filter);
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_ENTRIES);

  const confirmDelete = () =>
    startTransition(async () => {
      const entry = deleting.entry;
      if (!entry) return;
      const result = await deleteActivity(slug, clientId, entry.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deletedToast"));
      setDeleting((d) => ({ ...d, open: false }));
    });

  const stageText = (entry: Extract<TimelineEntry, { type: "stage" }>) =>
    entry.kind === "deal_created"
      ? tCrm("timeline.dealCreated", { deal: entry.dealTitle, to: entry.to })
      : tCrm("timeline.stageChange", { deal: entry.dealTitle, from: entry.from ?? "—", to: entry.to });

  const when = (iso: string) => {
    const date = new Date(iso);
    return (
      <time
        dateTime={iso}
        title={format.dateTime(date, { dateStyle: "full", timeStyle: "short", timeZone })}
        className="tabular"
      >
        {format.relativeTime(date, now)}
      </time>
    );
  };

  return (
    <SettingsCard
      title={t("title")}
      description={t("description")}
      actions={
        canEdit ? (
          <Button variant="outline" size="sm" onClick={onLogActivity}>
            <Plus data-icon="inline-start" />
            {t("log")}
          </Button>
        ) : undefined
      }
    >
      {timeline.length === 0 ? (
        <div className="py-4 text-center">
          <NotebookPen className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onLogActivity}>
              <Plus data-icon="inline-start" />
              {t("logFirst")}
            </Button>
          )}
        </div>
      ) : (
        <>
        <div role="group" aria-label={t("filterLabel")} className="mb-4 flex flex-wrap gap-1.5">
          {TIMELINE_FILTERS.map((key) => {
            const count = key === "all" ? timeline.length : timeline.filter((entry) => entry.type === key).length;
            if (key !== "all" && count === 0) return null;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key);
                  setShowAll(false);
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === key ? "border-primary/50 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`filters.${key}`)} <span className="tabular opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <ol>
          {visible.map((entry, index) => {
            const last = index === visible.length - 1;
            const { icon: Icon, tone } =
              entry.type === "activity"
                ? { icon: ACTIVITY_ICONS[entry.kind], tone: "text-foreground" }
                : entry.type === "billing"
                  ? BILLING_ICONS[entry.kind]
                  : stageIcon(entry);
            return (
              <li key={`${entry.type}-${entry.id}`} className="group relative flex gap-3 pb-5 last:pb-0">
                {!last && <span aria-hidden className="absolute top-8 bottom-1 left-3.5 w-px bg-border" />}
                <span
                  className={cn(
                    "relative flex size-7 shrink-0 items-center justify-center rounded-full border bg-card",
                    tone,
                  )}
                >
                  <Icon className="size-3.5" />
                </span>

                <div className="min-w-0 flex-1 pt-0.5">
                  {entry.type === "activity" ? (
                    <>
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-semibold">{entry.title}</span>
                        <span className="text-xs text-muted-foreground">{tKind(entry.kind)}</span>
                      </p>
                      {entry.body && <p className="mt-1 whitespace-pre-line break-words text-muted-foreground">{entry.body}</p>}
                    </>
                  ) : entry.type === "billing" ? (
                    <p className="text-muted-foreground">
                      <Link href={`${basePath}${entry.href}`} className="font-medium text-foreground hover:text-primary">
                        {tCrm(`timeline.${BILLING_ICONS[entry.kind].key}`, {
                          title: entry.title,
                          amount: entry.amountCents === null ? "" : formatMoney(entry.amountCents),
                        })}
                      </Link>
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      {entry.dealId ? (
                        <Link
                          href={`${basePath}/pipeline?deal=${entry.dealId}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {stageText(entry)}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">{stageText(entry)}</span>
                      )}
                    </p>
                  )}

                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {entry.author && <MemberAvatar member={entry.author} size="xs" />}
                    {when(entry.at)}
                    {entry.type === "activity" && entry.deal && (
                      <Link
                        href={`${basePath}/pipeline?deal=${entry.deal.id}`}
                        className="inline-flex min-w-0 items-center gap-1 hover:text-primary"
                      >
                        <SquareKanban className="size-3 shrink-0" />
                        <span className="truncate">{entry.deal.title}</span>
                      </Link>
                    )}
                    {entry.type === "activity" && entry.contactName && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <UserRound className="size-3 shrink-0" />
                        <span className="truncate">{entry.contactName}</span>
                      </span>
                    )}
                  </div>
                </div>

                {canEdit && entry.type === "activity" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("delete")}
                        className="shrink-0 text-muted-foreground opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                        onClick={() => setDeleting({ open: true, entry })}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("delete")}</TooltipContent>
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ol>
        {filtered.length > visible.length && (
          <Button variant="ghost" size="sm" className="mt-4 w-full" onClick={() => setShowAll(true)}>
            {t("showAll", { count: filtered.length })}
          </Button>
        )}
        </>
      )}

      {truncated && showAll && <p className="mt-5 text-xs text-muted-foreground">{t("truncated", { count: timeline.length })}</p>}

      {canEdit && (
        <ConfirmDialog
          open={deleting.open}
          onOpenChange={(open) => setDeleting((d) => ({ ...d, open }))}
          title={t("deleteTitle")}
          description={t("deleteBody", { title: deleting.entry?.title ?? "" })}
          confirmLabel={t("delete")}
          onConfirm={confirmDelete}
          pending={pending}
        />
      )}
    </SettingsCard>
  );
}
