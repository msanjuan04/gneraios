import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cache } from "react";
import { z } from "zod";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import { ClientDetail } from "@/components/clients/client-detail";
import type { ClientDeal, ClientDetailData, MemberOption, StageKind, TimelineEntry } from "@/components/clients/types";
import { isClient } from "@/domain/crm";
import { calendarDaysBetween } from "@/domain/dates/zoned-time";
import { localeNames } from "@/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/server/action-utils";
import { loadClientsHealth } from "@/server/clients/health";
import { getClientMandates } from "@/server/collections/mandates";
import { getClientContracts } from "@/server/contracts/queries";
import { nowInZone } from "@/lib/clock";
import { getClientCollections } from "@/server/clients/collections";
import { getClientRebills } from "@/server/finance/rebill";
import { getClientInvoices } from "@/server/invoices/queries";
import { getClientPortalCardData } from "@/server/portal/links";
import { getClientProjects } from "@/server/projects/cards";
import { getClientSeoSummary } from "@/server/seo/queries";
import { getClientSites } from "@/server/sites/queries";
import { getClientVendorCosts } from "@/server/vendors/queries";
import { getCrmConfig } from "@/server/crm/config";
import { getOrgContext, hasRole } from "@/server/session";
import { requestTime, resolveNames } from "../names";
import { ACTIVITY_KINDS, CLIENT_COLUMNS, type ClientRow } from "../schema";

/** Eventos del timeline que se pintan; si hay más, se avisa. */
const TIMELINE_LIMIT = 200;

const STAGE_KIND_ORDER: Record<StageKind, number> = { open: 0, won: 1, lost: 2 };

// `client_timeline.meta` de los cambios de etapa (jsonb_build_object en la vista).
const stageMetaSchema = z.object({
  from: z.string().nullish(),
  to: z.string(),
  to_kind: z.enum(["open", "won", "lost"]).nullish(),
});

// Eventos de facturación de la vista (contratos firmados, facturas emitidas y cobros).
const BILLING_KINDS = ["contract_signed", "invoice_issued", "invoice_rectifying", "payment"] as const;
const billingMetaSchema = z.object({
  contract_id: z.string().nullish(),
  invoice_id: z.string().nullish(),
  total_cents: z.number().nullish(),
  amount_cents: z.number().nullish(),
});

/** El cliente, si existe y la RLS deja verlo (una vez por petición: metadatos y página). */
const getClient = cache(async (orgId: string, clientId: string): Promise<ClientRow | null> => {
  if (!idSchema.safeParse(clientId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
});

function regionName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export async function generateMetadata({ params }: PageProps<"/[org]/clients/[clientId]">): Promise<Metadata> {
  const { org: slug, clientId } = await params;
  const { org } = await getOrgContext(slug);
  const client = await getClient(org.id, clientId);
  const t = await getTranslations("nav");
  return { title: client ? `${client.display_name} · ${t("clients")}` : t("clients") };
}

export default async function ClientPage({ params }: PageProps<"/[org]/clients/[clientId]">) {
  const { org: slug, clientId } = await params;
  const { org, member } = await getOrgContext(slug);
  const client = await getClient(org.id, clientId);
  if (!client) notFound();

  const supabase = await createClient();
  // Mientras es un lead, su ficha es la de lead: aquí no hay facturas, proyectos ni webs que enseñar.
  const { data: relationship } = await supabase.from("clients_overview").select("status, manual_status").eq("org_id", org.id).eq("id", clientId).maybeSingle();
  if (relationship && !isClient({ status: relationship.status ?? null, manualStatus: relationship.manual_status ?? null })) {
    redirect(`/${org.slug}/leads/${clientId}`);
  }
  const [
    config,
    overviewRes,
    contactsRes,
    dealsRes,
    timelineRes,
    wonRes,
    activityContactsRes,
    contracts,
    invoices,
    seo,
    portal,
    mandates,
    healthBy,
    projects,
    sites,
    collections,
    rebills,
    vendors,
    clientRequestsRes,
    requestFilesRes,
  ] = await Promise.all([
    getCrmConfig(org.id),
    supabase
      .from("clients_overview")
      .select("status, manual_status, manual_status_at, acquisition_source_id, last_activity_at, billed_net_cents, first_invoice_on")
      .eq("org_id", org.id)
      .eq("id", client.id)
      .maybeSingle(),
    // También los archivados: sus nombres siguen en actividades antiguas.
    supabase
      .from("contacts")
      .select("id, full_name, role, email, phone, is_primary, is_billing, notes, archived_at")
      .eq("org_id", org.id)
      .eq("client_id", client.id)
      .order("is_primary", { ascending: false })
      .order("full_name"),
    supabase
      .from("deals_board")
      .select(
        "id, title, stage_id, stage_kind, stage_position, est_one_off_cents, est_mrr_cents, probability_bps, owner_member_id, owner_initials, stage_entered_at, created_at",
      )
      .eq("org_id", org.id)
      .eq("client_id", client.id),
    supabase
      .from("client_timeline")
      .select("event_id, kind, title, body, at, member_id, deal_id, meta")
      .eq("org_id", org.id)
      .eq("client_id", client.id)
      .order("at", { ascending: false })
      .limit(TIMELINE_LIMIT + 1),
    // Cuándo entró cada deal en una etapa ganada: "cliente desde" es la primera de un deal que sigue ganado.
    supabase
      .from("client_timeline")
      .select("deal_id, at")
      .eq("org_id", org.id)
      .eq("client_id", client.id)
      .in("kind", ["deal_created", "stage_change"])
      .contains("meta", { to_kind: "won" })
      .order("at", { ascending: true }),
    // La vista del timeline no trae el contacto de cada actividad.
    supabase
      .from("activities")
      .select("id, contact_id, direction, channel, counterpart, external_reference")
      .eq("org_id", org.id)
      .eq("client_id", client.id)
      .not("contact_id", "is", null),
    getClientContracts(org.id, client.id),
    getClientInvoices(org.id, client.id),
    getClientSeoSummary(org.id, client.id),
    getClientPortalCardData(org.id, client.id),
    getClientMandates(org, client.id),
    loadClientsHealth(supabase, org, client.id),
    getClientProjects(org, client.id, member.id),
    getClientSites(org, client.id),
    getClientCollections(org, client.id),
    getClientRebills(org.id, client.id),
    getClientVendorCosts(org, client.id),
    supabase.from("client_requests").select("id, kind, status, title, instructions, requested_at, due_on, received_at, response, client_file_id").eq("org_id", org.id).eq("client_id", client.id).order("requested_at", { ascending: false }),
    supabase.from("client_files").select("id, title").eq("org_id", org.id).eq("client_id", client.id).order("created_at", { ascending: false }),
  ]);
  for (const res of [overviewRes, contactsRes, dealsRes, timelineRes, wonRes, activityContactsRes, clientRequestsRes, requestFilesRes]) {
    if (res.error) throw res.error;
  }

  const locale = await getLocale();
  const tCrm = await getTranslations("crm");
  const now = requestTime();
  const timeZone = org.timezone;
  const overview = overviewRes.data;

  const dealRows = (dealsRes.data ?? []).flatMap((d) =>
    d.id && d.title && d.stage_id && d.stage_kind ? [{ ...d, id: d.id, title: d.title, stageId: d.stage_id, kind: d.stage_kind }] : [],
  );
  const timelineRows = (timelineRes.data ?? []).flatMap((r) =>
    r.event_id && r.kind && r.at ? [{ ...r, event_id: r.event_id, kind: r.kind, at: r.at }] : [],
  );

  const names = await resolveNames(supabase, org.id, config, {
    memberIds: [client.owner_member_id, ...dealRows.map((d) => d.owner_member_id), ...timelineRows.map((r) => r.member_id)],
    sourceIds: [overview?.acquisition_source_id],
  });

  const stageNames = new Map(config.stages.map((s) => [s.id, s.name]));
  const deals: ClientDeal[] = dealRows
    .sort(
      (a, b) =>
        STAGE_KIND_ORDER[a.kind] - STAGE_KIND_ORDER[b.kind] ||
        (a.stage_position ?? 0) - (b.stage_position ?? 0) ||
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    )
    .map((d) => ({
      id: d.id,
      title: d.title,
      // Una etapa archivada ya no está en la configuración: se nombra por su tipo.
      stageName: stageNames.get(d.stageId) ?? tCrm(`stageKind.${d.kind}`),
      stageKind: d.kind,
      oneOffCents: d.est_one_off_cents ?? 0,
      mrrCents: d.est_mrr_cents ?? 0,
      probabilityBps: d.probability_bps ?? 0,
      daysInStage: d.stage_entered_at ? calendarDaysBetween(new Date(d.stage_entered_at), new Date(now), timeZone) : 0,
      owner: names.member(d.owner_member_id, d.owner_initials),
    }));
  const dealsById = new Map(deals.map((d) => [d.id, d]));

  const allContacts = contactsRes.data ?? [];
  const requestFiles = (requestFilesRes.data ?? []).map((f) => ({ id: f.id, title: f.title }));
  const filesById = new Map(requestFiles.map((f) => [f.id, f.title]));
  const requests = (clientRequestsRes.data ?? []).map((r) => ({
    id: r.id, kind: r.kind, status: r.status, title: r.title, instructions: r.instructions,
    requestedAt: r.requested_at, dueOn: r.due_on, receivedAt: r.received_at,
    response: r.response, fileId: r.client_file_id, fileTitle: r.client_file_id ? filesById.get(r.client_file_id) ?? null : null,
  }));
  const contacts = allContacts
    .filter((c) => c.archived_at === null)
    .map((c) => ({
      id: c.id,
      full_name: c.full_name,
      role: c.role,
      email: c.email,
      phone: c.phone,
      is_primary: c.is_primary,
      is_billing: c.is_billing,
      notes: c.notes,
    }));
  const contactNames = new Map(allContacts.map((c) => [c.id, c.full_name]));
  const activityContact = new Map((activityContactsRes.data ?? []).map((a) => [a.id, a.contact_id]));
  const activityMessages = new Map((activityContactsRes.data ?? []).map((a) => [a.id, a]));

  const timeline: TimelineEntry[] = timelineRows.slice(0, TIMELINE_LIMIT).flatMap((row): TimelineEntry[] => {
    const author = names.member(row.member_id);
    const activityKind = ACTIVITY_KINDS.find((k) => k === row.kind);
    if (activityKind) {
      const deal = row.deal_id ? dealsById.get(row.deal_id) : undefined;
      const contactId = activityContact.get(row.event_id);
      const message = activityMessages.get(row.event_id);
      return [
        {
          type: "activity",
          id: row.event_id,
          kind: activityKind,
          title: row.title ?? "",
          body: row.body,
          direction: activityKind === "email" ? (message?.direction as "incoming" | "outgoing" | "internal" | null) ?? null : null,
          channel: activityKind === "email" ? (message?.channel as "email" | "whatsapp" | "phone" | "linkedin" | "instagram" | "other" | null) ?? null : null,
          counterpart: activityKind === "email" ? message?.counterpart ?? null : null,
          externalReference: activityKind === "email" ? message?.external_reference ?? null : null,
          at: row.at,
          author,
          deal: deal ? { id: deal.id, title: deal.title } : null,
          contactName: contactId ? (contactNames.get(contactId) ?? null) : null,
        },
      ];
    }
    const billingKind = BILLING_KINDS.find((k) => k === row.kind);
    if (billingKind) {
      const billing = billingMetaSchema.safeParse(row.meta);
      if (!billing.success) return [];
      const href = billing.data.contract_id ? `/contracts/${billing.data.contract_id}` : `/invoices/${billing.data.invoice_id}`;
      return [
        {
          type: "billing",
          id: row.event_id,
          kind: billingKind,
          at: row.at,
          author,
          title: row.title ?? "",
          href,
          amountCents: billing.data.amount_cents ?? billing.data.total_cents ?? null,
        },
      ];
    }
    const meta = stageMetaSchema.safeParse(row.meta);
    if ((row.kind !== "deal_created" && row.kind !== "stage_change") || !meta.success) return [];
    return [
      {
        type: "stage",
        id: row.event_id,
        kind: row.kind,
        at: row.at,
        author,
        dealId: row.deal_id && dealsById.has(row.deal_id) ? row.deal_id : null,
        dealTitle: row.title ?? "",
        from: meta.data.from ?? null,
        to: meta.data.to,
        toKind: meta.data.to_kind ?? null,
      },
    ];
  });

  const wonDeals = new Set(deals.filter((d) => d.stageKind === "won").map((d) => d.id));
  const clientSince = (wonRes.data ?? []).find((e) => e.deal_id && wonDeals.has(e.deal_id))?.at ?? null;

  // Responsable: los socios activos y, si el actual ya no tiene acceso, también él.
  const ownerOptions: MemberOption[] = [...config.members];
  const owner = names.member(client.owner_member_id);
  if (owner && !ownerOptions.some((m) => m.id === owner.id)) {
    ownerOptions.push({ id: owner.id, fullName: owner.fullName ?? owner.initials, initials: owner.initials });
  }

  const defaultPaymentTerms = readOrgSettings(org.settings).payment_terms_days;
  const data: ClientDetailData = {
    slug: org.slug,
    basePath: `/${org.slug}`,
    timeZone,
    now,
    isPartner: hasRole(member.role, "partner"),
    client,
    status: overview?.status ?? "lead",
    manualStatus: overview?.manual_status ?? null,
    manualStatusAt: overview?.manual_status_at ?? null,
    owner,
    sourceName: names.source(overview?.acquisition_source_id),
    countryName: regionName(client.country_code, locale),
    languageName: localeNames[client.preferred_language],
    paymentTerms: {
      days: client.payment_terms_days ?? defaultPaymentTerms,
      isDefault: client.payment_terms_days === null,
    },
    clientSince,
    billedNetCents: overview?.billed_net_cents ?? 0,
    firstInvoiceOn: overview?.first_invoice_on ?? null,
    lastActivityAt: overview?.last_activity_at ?? null,
    contacts,
    requests,
    requestFiles,
    deals,
    timeline,
    timelineTruncated: timelineRows.length > TIMELINE_LIMIT,
    contracts,
    invoices,
    seo,
    health: healthBy.get(client.id) ?? { level: "good", signals: [] },
    projects,
    sites,
    portal,
    mandates,
    collections,
    rebills,
    vendors,
    today: nowInZone(timeZone).date,
    ownerOptions,
    defaultPaymentTerms,
  };

  return <ClientDetail data={data} />;
}
