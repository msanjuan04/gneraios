"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  IdCard,
  MapPin,
  Megaphone,
  NotebookPen,
  Pencil,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";
import { setClientArchived } from "@/app/[org]/clients/actions";
import { clientFormDefaults } from "@/app/[org]/clients/schema";
import { ConfirmDialog } from "@/components/settings/confirm-dialog";
import { DetailItem, ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatMoney } from "@/domain/money";
import { ClientMandateCard } from "@/components/collections/client-mandate-card";
import { ClientContractsCard } from "@/components/contracts/client-contracts-card";
import { ClientRebillCard } from "@/components/finance/client-rebill-card";
import { InvoiceImportButton } from "@/components/invoice-import/invoice-import-button";
import { ClientInvoicesCard } from "@/components/invoices/client-invoices-card";
import { CreateQuoteButton } from "@/components/quotes/create-quote-button";
import { ClientPortalCard } from "@/components/portal/client-portal-card";
import { ClientProjectsCard } from "@/components/projects/client-projects-card";
import { ClientRequestsPanel } from "./client-requests-panel";
import { HealthPanel } from "./health-badge";
import { ClientSeoCard } from "@/components/seo/client-seo-card";
import { ClientSitesCard } from "@/components/sites/client-sites-card";
import { ClientVendorsCard } from "@/components/vendors/client-vendors-card";
import { ActivityCard } from "./activity-card";
import { ClientCollectionsCard } from "./collections-card";
import { RecordExpenseButton } from "./record-expense-button";
import { ActivitySheet } from "./activity-sheet";
import { ClientSheet } from "./client-sheet";
import { ClientStatusBadge } from "./client-status-badge";
import { ClientStatusControl } from "./client-status-control";
import { ClientProfitabilityCard } from "@/components/profitability/client-profitability-card";
import { ClientReportCard } from "@/components/reports/client-report-card";
import { ContactsCard } from "./contacts-card";
import { DealsCard } from "./deals-card";
import { MemberAvatar } from "./member-avatar";
import type { ClientDetailData } from "./types";
import { toDateTimeLocal } from "@/domain/dates/zoned-time";

/** "gnerai.com/es" para leer; con https:// para el enlace. */
function websiteParts(website: string): { href: string; label: string } {
  const href = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  return { href, label: website.replace(/^https?:\/\//i, "").replace(/\/$/, "") };
}

/** Ficha 360 del cliente: cabecera con acciones, métricas, deals, actividad, resumen fiscal y contactos. */
export function ClientDetail({ data }: { data: ClientDetailData }) {
  const t = useTranslations("clients.detail");
  const tCrm = useTranslations("crm");
  const format = useFormatter();
  const locale = useLocale();
  const { client, basePath, slug } = data;
  const archived = client.archived_at !== null;
  const canEdit = data.isPartner && !archived;
  // LTV: lo facturado (base sin IVA) más lo cobrado sin factura, desde lo primero de los dos.
  const receiptsCents = data.collections.summary.receiptsCents;
  const ltvCents = data.billedNetCents + receiptsCents;
  const ltvFrom = [data.firstInvoiceOn, receiptsCents !== 0 ? data.collections.summary.firstOn : null].filter((d): d is string => Boolean(d)).sort()[0] ?? null;

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activity, setActivity] = useState({ open: false, occurredAt: "" });
  const [pending, startTransition] = useTransition();

  // La hora por defecto es "ahora" en la zona de la org, calculada al abrir (no al pintar).
  const openActivity = () => setActivity({ open: true, occurredAt: toDateTimeLocal(new Date(), data.timeZone) });

  const setArchived = (next: boolean) =>
    startTransition(async () => {
      const result = await setClientArchived(slug, client.id, next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const name = client.display_name;
      if (next) toast.success(t("archivedToast", { name }), { action: { label: t("undo"), onClick: () => setArchived(false) } });
      else toast.success(t("restoredToast", { name }));
      setArchiveOpen(false);
    });

  const openDeals = data.deals.filter((d) => d.stageKind === "open");
  const newDealHref = `${basePath}/pipeline?new=1&client=${client.id}`;
  const money = (cents: number) => formatMoney(cents, { locale, wholeUnits: true });
  const openOneOff = openDeals.reduce((sum, d) => sum + d.oneOffCents, 0);
  const openMrr = openDeals.reduce((sum, d) => sum + d.mrrCents, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={`${basePath}/clients`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="min-w-0 text-3xl font-extrabold break-words heading-tight md:text-4xl">{client.display_name}</h2>
            {data.isPartner ? (
              <ClientStatusControl
                slug={slug}
                clientId={client.id}
                status={data.status}
                manual={data.manualStatus}
                manualAt={data.manualStatusAt}
                disabled={archived}
              />
            ) : (
              <ClientStatusBadge status={data.status} manual={data.manualStatus} />
            )}
            {archived && (
              <Badge variant="outline" className="text-muted-foreground">
                {t("archivedBadge")}
              </Badge>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              {data.owner ? (
                <>
                  <MemberAvatar member={data.owner} size="xs" />
                  {data.owner.fullName ?? data.owner.initials}
                </>
              ) : (
                tCrm("noOwner")
              )}
            </span>
            <span className="inline-flex items-center gap-1.5" title={t("source")}>
              <Megaphone className="size-3.5" />
              {data.sourceName ?? tCrm("unknownSource")}
            </span>
            {client.tax_id && (
              <span className="inline-flex items-center gap-1.5" title={t("taxId")}>
                <IdCard className="size-3.5" />
                <span className="font-mono">{client.tax_id}</span>
              </span>
            )}
            {client.city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {client.city}
              </span>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={openActivity}>
              <NotebookPen data-icon="inline-start" />
              {t("logActivity")}
            </Button>
            <Button asChild variant="outline">
              <Link href={newDealHref}>
                <Plus data-icon="inline-start" />
                {t("newDeal")}
              </Link>
            </Button>
            <CreateQuoteButton slug={slug} clientId={client.id} size="default" />
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil data-icon="inline-start" />
              {t("edit")}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t("archive")} onClick={() => setArchiveOpen(true)}>
                  <Archive />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("archive")}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </header>

      {archived && client.archived_at && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          <Archive className="size-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1">
            {t("archivedBanner", {
              date: format.dateTime(new Date(client.archived_at), { dateStyle: "long", timeZone: data.timeZone }),
            })}
          </p>
          {data.isPartner && (
            <Button variant="outline" size="sm" onClick={() => setArchived(false)} disabled={pending}>
              <ArchiveRestore data-icon="inline-start" />
              {t("restore")}
            </Button>
          )}
        </div>
      )}
      {!data.isPartner && <ReadOnlyNotice className="mb-6">{t("readOnly")}</ReadOnlyNotice>}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("stats.ltv")}
          value={ltvCents !== 0 ? money(ltvCents) : "—"}
          hint={
            ltvFrom
              ? t(receiptsCents === 0 ? "stats.ltvSince" : data.billedNetCents === 0 ? "stats.ltvSinceReceipts" : "stats.ltvSinceMixed", {
                  date: format.dateTime(new Date(`${ltvFrom}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }),
                })
              : t("stats.ltvHint")
          }
        />
        <Stat
          label={t("stats.since")}
          value={
            data.clientSince
              ? format.dateTime(new Date(data.clientSince), { dateStyle: "medium", timeZone: data.timeZone })
              : "—"
          }
          hint={data.clientSince ? format.relativeTime(new Date(data.clientSince), data.now) : t("stats.sinceNone")}
        />
        <Stat
          label={t("stats.openDeals")}
          value={String(openDeals.length)}
          hint={
            openDeals.length === 0
              ? t("stats.noOpenDeals")
              : [
                  openOneOff > 0 ? money(openOneOff) : null,
                  openMrr > 0 ? tCrm("amount.perMonth", { amount: money(openMrr) }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || t("stats.noAmount")
          }
        />
        <Stat
          label={t("stats.lastActivity")}
          value={data.lastActivityAt ? format.relativeTime(new Date(data.lastActivityAt), data.now) : "—"}
          hint={
            data.lastActivityAt
              ? format.dateTime(new Date(data.lastActivityAt), { dateStyle: "medium", timeStyle: "short", timeZone: data.timeZone })
              : t("stats.noActivity")
          }
        />
      </dl>

      {data.health.level !== "good" && (
        <div className="mt-6">
          <HealthPanel health={data.health} />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ClientContractsCard basePath={basePath} clientId={client.id} contracts={data.contracts} canEdit={canEdit} />
          <ClientCollectionsCard
            slug={slug}
            basePath={basePath}
            clientId={client.id}
            clientName={client.display_name}
            data={data.collections}
            projects={data.projects.projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name }))}
            today={data.today}
            // Un cliente archivado también puede pagar lo que debía: el cobro no depende de archivarlo.
            canEdit={data.isPartner}
          />
          <ClientVendorsCard
            basePath={basePath}
            clientId={client.id}
            data={data.vendors}
            actions={canEdit ? <RecordExpenseButton slug={slug} clientId={client.id} /> : undefined}
          />
          <ClientInvoicesCard
            basePath={basePath}
            clientId={client.id}
            data={data.invoices}
            canEdit={canEdit}
            extraActions={canEdit ? <InvoiceImportButton slug={slug} clientId={client.id} size="sm" /> : undefined}
          />
          <ClientRebillCard slug={slug} clientId={client.id} clientName={client.display_name} data={data.rebills} canEdit={canEdit} />
          <ClientProjectsCard slug={slug} basePath={basePath} clientId={client.id} data={data.projects} canEdit={canEdit} />
          <ClientRequestsPanel slug={slug} clientId={client.id} requests={data.requests} files={data.requestFiles} projects={data.projects.projects.filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name }))} canEdit={canEdit} />
          <DealsCard basePath={basePath} clientId={client.id} deals={data.deals} canEdit={canEdit} />
          <ActivityCard
            slug={slug}
            basePath={basePath}
            clientId={client.id}
            timeline={data.timeline}
            truncated={data.timelineTruncated}
            timeZone={data.timeZone}
            now={data.now}
            canEdit={canEdit}
            onLogActivity={openActivity}
          />
        </div>
        <div className="min-w-0 space-y-6">
          <SummaryCard data={data} />
          <ContactsCard slug={slug} clientId={client.id} contacts={data.contacts} canEdit={canEdit} />
          <ClientPortalCard slug={slug} clientName={client.display_name} data={data.portal} canEdit={data.isPartner} />
          <ClientMandateCard slug={slug} basePath={basePath} clientId={client.id} data={data.mandates} canEdit={canEdit} />
          <ClientSeoCard summary={data.seo} basePath={basePath} clientId={client.id} canManage={data.isPartner} />
          <ClientSitesCard basePath={basePath} clientId={client.id} data={data.sites} canEdit={canEdit} />
          {data.isPartner && <ClientProfitabilityCard slug={slug} clientId={client.id} />}
          {data.isPartner && <ClientReportCard slug={slug} clientId={client.id} timeZone={data.timeZone} />}
        </div>
      </div>

      {canEdit && (
        <>
          <ClientSheet
            slug={slug}
            open={editOpen}
            onOpenChange={setEditOpen}
            clientId={client.id}
            defaults={clientFormDefaults(client)}
            members={data.ownerOptions}
            defaultPaymentTerms={data.defaultPaymentTerms}
          />
          <ActivitySheet
            slug={slug}
            clientId={client.id}
            open={activity.open}
            onOpenChange={(open) => setActivity((a) => ({ ...a, open }))}
            defaultOccurredAt={activity.occurredAt}
            deals={data.deals.map((d) => ({ id: d.id, label: `${d.title} · ${d.stageName}` }))}
            contacts={data.contacts.map((c) => ({ id: c.id, label: c.role ? `${c.full_name} · ${c.role}` : c.full_name }))}
          />
        </>
      )}
      {data.isPartner && !archived && (
        <ConfirmDialog
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          title={t("archiveTitle", { name: client.display_name })}
          description={
            <>
              {t("archiveBody")}
              {openDeals.length > 0 && <span className="mt-2 block">{t("archiveOpenDeals", { count: openDeals.length })}</span>}
            </>
          }
          confirmLabel={t("archive")}
          onConfirm={() => setArchived(true)}
          pending={pending}
        />
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 truncate text-xl font-bold tabular heading-tight">{value}</dd>
      <dd className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

function SummaryCard({ data }: { data: ClientDetailData }) {
  const t = useTranslations("clients.summary");
  const tKind = useTranslations("crm.taxIdKind");
  const { client } = data;
  const none = <span className="text-muted-foreground">—</span>;
  const street = [client.address_line, [client.postal_code, client.city].filter(Boolean).join(" "), client.province]
    .filter(Boolean)
    .join(", ");
  const website = client.website ? websiteParts(client.website) : null;

  return (
    <SettingsCard title={t("title")}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <DetailItem label={t("legalName")} className="col-span-2">
          {client.legal_name ?? none}
        </DetailItem>
        <DetailItem label={t("taxId")} className="col-span-2">
          {client.tax_id ? (
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono">{client.tax_id}</span>
              <span className="text-xs text-muted-foreground">{tKind(client.tax_id_kind)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{t("noTaxId")}</span>
          )}
        </DetailItem>
        <DetailItem label={t("address")} className="col-span-2">
          {street || none}
        </DetailItem>
        <DetailItem label={t("country")}>{data.countryName}</DetailItem>
        <DetailItem label={t("type")}>{client.is_business ? t("business") : t("individual")}</DetailItem>
        <DetailItem label={t("language")}>{data.languageName}</DetailItem>
        <DetailItem label={t("paymentTerms")}>
          <span className="tabular">{t("paymentTermsDays", { days: data.paymentTerms.days })}</span>
          {data.paymentTerms.isDefault && <span className="block text-xs text-muted-foreground">{t("paymentTermsDefault")}</span>}
        </DetailItem>
        <DetailItem label={t("sector")}>{client.sector ?? none}</DetailItem>
        <DetailItem label={t("website")}>
          {website ? (
            <a href={website.href} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
              {website.label}
            </a>
          ) : (
            none
          )}
        </DetailItem>
        {client.notes && (
          <DetailItem label={t("notes")} className="col-span-2 whitespace-pre-line">
            {client.notes}
          </DetailItem>
        )}
      </dl>
    </SettingsCard>
  );
}
