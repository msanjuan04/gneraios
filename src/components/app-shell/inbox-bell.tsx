"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCheck,
  CircleCheck,
  CircleX,
  Globe,
  LockKeyhole,
  Mail,
  MessageSquarePlus,
  ServerCrash,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatMoney } from "@/domain/money";
import { notificationMessageKey, notificationValues } from "@/domain/notifications/text";
import { cn } from "@/lib/utils";
import { getInbox, type InboxItem, markInboxRead } from "@/server/notifications";
import { useShell } from "./shell-context";
import { notAfter } from "@/lib/relative-time";

const ICONS: Record<InboxItem["kind"], { icon: LucideIcon; tone: string }> = {
  renewal: { icon: CalendarClock, tone: "text-primary" },
  reminder_ready: { icon: Mail, tone: "text-warning" },
  job_failed: { icon: AlertTriangle, tone: "text-destructive" },
  verifactu_deadline: { icon: ShieldAlert, tone: "text-warning" },
  // Portal del cliente (src/server/portal): aceptado o rechazado online y peticiones.
  quote_accepted: { icon: CircleCheck, tone: "text-success" },
  quote_rejected: { icon: CircleX, tone: "text-muted-foreground" },
  portal_request: { icon: MessageSquarePlus, tone: "text-primary" },
  // Un socio ha entrado desde un dispositivo nuevo (entrada con código).
  new_device: { icon: ShieldAlert, tone: "text-warning" },
  // Webs (src/server/sites): caída, vuelta, certificado SSL y dominio a punto de caducar.
  site_down: { icon: ServerCrash, tone: "text-destructive" },
  site_up: { icon: Activity, tone: "text-success" },
  ssl_expiring: { icon: LockKeyhole, tone: "text-warning" },
  domain_expiring: { icon: Globe, tone: "text-warning" },
  subscription_renewal: { icon: CalendarClock, tone: "text-warning" },
};

const REFRESH_MS = 60_000;

/** Avisos in-app: renovaciones, recordatorios por aprobar, fallos del cron y Verifactu. */
export function InboxBell() {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const now = useNow({ updateInterval: REFRESH_MS });
  const router = useRouter();
  const { org, basePath, preview } = useShell();
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState<{ items: InboxItem[]; unread: number }>({ items: [], unread: 0 });
  const [, startTransition] = useTransition();

  const refresh = useCallback(() => {
    if (preview) return;
    void getInbox(org.slug).then(setInbox);
  }, [org.slug, preview]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const text = (item: InboxItem) => {
    const values = notificationValues(item.params, {
      date: (civil) => format.dateTime(new Date(`${civil}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }),
      money: (cents) => formatMoney(cents),
    });
    return t(`kinds.${notificationMessageKey(item.kind, item.params)}`, values);
  };

  const openItem = (item: InboxItem) => {
    setOpen(false);
    startTransition(async () => {
      if (!item.read) await markInboxRead(org.slug, [item.id]);
      refresh();
    });
    if (item.href) router.push(`${basePath}${item.href}`);
  };

  const markAll = () =>
    startTransition(async () => {
      await markInboxRead(org.slug);
      refresh();
    });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("open")} className="relative">
          <Bell />
          {inbox.unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground tabular">
              {inbox.unread > 9 ? "9+" : inbox.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 glass">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{t("title")}</p>
            {inbox.unread > 0 && <p className="text-xs text-muted-foreground">{t("unread", { count: inbox.unread })}</p>}
          </div>
          {inbox.unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAll}>
              <CheckCheck data-icon="inline-start" />
              {t("markAll")}
            </Button>
          )}
        </div>
        {inbox.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {inbox.items.map((item) => {
              const { icon: Icon, tone } = ICONS[item.kind];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-accent",
                      item.read && "opacity-60",
                    )}
                  >
                    <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug">{text(item)}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {format.relativeTime(notAfter(new Date(item.createdAt), now), now)}
                      </span>
                    </span>
                    {!item.read && <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
