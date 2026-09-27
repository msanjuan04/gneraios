"use client";

import { Globe, LockKeyhole, Server } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { MouseEvent } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SiteFormat } from "./format";
import { CheckNowButton, SiteActionsMenu } from "./site-actions";
import { StatusDot } from "./status-dot";
import type { SiteExpiry, SiteListItem } from "./types";

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

const SEVERITY_TEXT = { ok: "text-muted-foreground", warning: "font-semibold text-warning", expired: "font-semibold text-destructive" } as const;

/** Días que le quedan al certificado o al dominio, en corto, con el aviso si toca. */
export function ExpiryValue({ expiry, fmt, kind }: { expiry: SiteExpiry | null; fmt: SiteFormat; kind: "ssl" | "domain" }) {
  const t = useTranslations("sites.list");
  if (!expiry) return <span className="text-muted-foreground/60">—</span>;
  const Icon = kind === "ssl" ? LockKeyhole : Globe;
  const text = expiry.expired ? t("expired") : fmt.daysShort(expiry.daysLeft);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex items-center gap-1 tabular", SEVERITY_TEXT[expiry.severity])}>
          {expiry.severity !== "ok" && <Icon aria-hidden className="size-3" />}
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t(kind === "ssl" ? "sslUntil" : "domainUntil", { date: fmt.date(expiry.expiresOn) })}</TooltipContent>
    </Tooltip>
  );
}

/** Lo que se lee debajo del nombre cuando algo no va bien. */
export function StatusLine({ site, fmt, className }: { site: SiteListItem; fmt: SiteFormat; className?: string }) {
  const t = useTranslations("sites.list");
  let text: string | null = null;
  if (site.status === "down") {
    const reason = fmt.error(site.lastError, site.lastStatusCode);
    text = site.failingSince ? t("downSince", { reason, since: fmt.relative(site.failingSince) }) : reason;
    if (!site.confirmed) text = `${text} · ${t("unconfirmed")}`;
  } else if (site.status === "slow") text = t("slowLine");
  else if (site.status === "unknown") text = site.lastCheckedAt ? t("stale") : t("neverChecked");
  else if (site.status === "paused") text = t("pausedLine");
  if (!text) return null;
  return (
    <p className={cn("truncate text-xs", site.status === "down" ? "text-destructive" : site.status === "slow" ? "text-warning" : "text-muted-foreground", className)}>
      {text}
    </p>
  );
}

type Props = {
  slug: string;
  basePath: string;
  sites: SiteListItem[];
  fmt: SiteFormat;
  slowMs: number;
  canEdit: boolean;
  checkingId: string | null;
  onCheck: (site: SiteListItem) => void;
  onEdit: (site: SiteListItem) => void;
};

/**
 * La lista densa: estado, nombre y URL, cliente, respuesta, uptime de 7 días, días de SSL y de
 * dominio y cuándo se comprobó. Toda la fila abre la ficha.
 */
export function SitesTable({ slug, basePath, sites, fmt, slowMs, canEdit, checkingId, onCheck, onEdit }: Props) {
  const t = useTranslations("sites.list");
  const router = useRouter();
  const href = (id: string) => `${basePath}/sites/${id}`;

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    // Los clics del menú y de la confirmación (portales) también llegan aquí por React: solo cuenta la fila.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (closest(event.target, "a, button")) return;
    if (event.metaKey || event.ctrlKey) window.open(href(id), "_blank", "noopener");
    else router.push(href(id));
  };

  const head = "h-9 text-xs text-muted-foreground";
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(head, "pl-5")}>{t("columns.site")}</TableHead>
            <TableHead className={cn(head, "hidden lg:table-cell")}>{t("columns.client")}</TableHead>
            <TableHead className={cn(head, "text-right")}>{t("columns.response")}</TableHead>
            <TableHead className={cn(head, "hidden text-right sm:table-cell")}>{t("columns.uptime")}</TableHead>
            <TableHead className={cn(head, "hidden text-right md:table-cell")}>{t("columns.ssl")}</TableHead>
            <TableHead className={cn(head, "hidden text-right md:table-cell")}>{t("columns.domain")}</TableHead>
            <TableHead className={cn(head, "hidden text-right xl:table-cell")}>{t("columns.checked")}</TableHead>
            <TableHead className={cn(head, "w-0 pr-3")}>
              <span className="sr-only">{t("columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sites.map((site) => {
            const muted = site.status === "paused";
            const slow = site.lastResponseMs !== null && site.lastResponseMs >= slowMs;
            return (
              <TableRow
                key={site.id}
                onClick={(e) => onRowClick(e, site.id)}
                className={cn("group cursor-pointer", muted && "text-muted-foreground")}
              >
                <TableCell className="max-w-0 py-2 pl-5 lg:w-[34%]">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StatusDot status={site.status} />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Link
                          href={href(site.id)}
                          className="truncate font-semibold outline-none hover:text-primary focus-visible:text-primary focus-visible:underline"
                        >
                          {site.name}
                        </Link>
                        {site.hostedByUs && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Server aria-label={t("hostedByUs")} className="size-3 shrink-0 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>{t("hostedByUs")}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {site.label ? <p className="truncate font-mono text-[11px] text-muted-foreground">{site.displayUrl}</p> : null}
                      <StatusLine site={site} fmt={fmt} />
                      <p className="truncate text-xs text-muted-foreground lg:hidden">{site.clientName ?? ""}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden max-w-0 lg:table-cell lg:w-[18%]">
                  {site.clientId ? (
                    <Link href={`${basePath}/clients/${site.clientId}`} className="block truncate text-muted-foreground hover:text-primary">
                      {site.clientName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground/70">{t("noClient")}</span>
                  )}
                </TableCell>
                <TableCell className={cn("text-right text-xs tabular", slow ? "font-semibold text-warning" : "text-muted-foreground")}>
                  {site.status === "down" || site.lastResponseMs === null ? <span className="text-muted-foreground/60">—</span> : fmt.ms(site.lastResponseMs)}
                </TableCell>
                <TableCell className="hidden text-right text-xs tabular sm:table-cell">
                  {site.uptime.week === null ? <span className="text-muted-foreground/60">—</span> : fmt.uptime(site.uptime.week)}
                </TableCell>
                <TableCell className="hidden text-right text-xs md:table-cell">
                  <ExpiryValue expiry={site.ssl} fmt={fmt} kind="ssl" />
                </TableCell>
                <TableCell className="hidden text-right text-xs md:table-cell">
                  <ExpiryValue expiry={site.domain} fmt={fmt} kind="domain" />
                </TableCell>
                <TableCell className="hidden text-right text-xs whitespace-nowrap text-muted-foreground xl:table-cell">
                  {site.lastCheckedAt ? (
                    <time dateTime={site.lastCheckedAt} title={fmt.dateTime(site.lastCheckedAt)}>
                      {fmt.relative(site.lastCheckedAt)}
                    </time>
                  ) : (
                    <span className="text-muted-foreground/60">{t("never")}</span>
                  )}
                </TableCell>
                <TableCell className="pr-3">
                  {canEdit && (
                    <div className="flex items-center justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <CheckNowButton onClick={() => onCheck(site)} pending={checkingId === site.id} />
                      <SiteActionsMenu slug={slug} site={site} onEdit={() => onEdit(site)} />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
