import "server-only";
import { type ClientHealth, clientHealth, HEALTH_RULES } from "@/domain/clients/health";
import { addDays, type CivilDate } from "@/domain/dates/civil-date";
import { linesInForce, orgMrrCents, upcomingRenewals } from "@/domain/metrics";
import { nowInZone } from "@/lib/clock";
import { type Db, fetchAll } from "@/server/billing/context";
import { loadMetricsLines } from "@/server/metrics/sources";

// La salud de los clientes de una org (src/domain/clients/health.ts), con el cliente que se pase:
// el de la sesión (RLS) en las pantallas. Todo por org_id, en pocas consultas: son decenas de
// clientes, no miles.

/** Por debajo de estos clics en 28 días, una caída es ruido. */
const MIN_SEO_CLICKS = 30;
const MRR_LOOKBACK_DAYS = 90;

export async function loadClientsHealth(db: Db, org: { id: string; timezone: string }, onlyClientId?: string): Promise<Map<string, ClientHealth>> {
  const today: CivilDate = nowInZone(org.timezone).date;
  const seoFrom = addDays(today, -56);
  const seoSplit = addDays(today, -28);

  let clientsQuery = db.from("clients_overview").select("id, status, last_activity_at").eq("org_id", org.id);
  if (onlyClientId) clientsQuery = clientsQuery.eq("id", onlyClientId);
  let overdueQuery = db.from("invoices_overview").select("client_id, due_on, outstanding_cents").eq("org_id", org.id).eq("status", "overdue");
  if (onlyClientId) overdueQuery = overdueQuery.eq("client_id", onlyClientId);
  let propsQuery = db.from("seo_properties").select("id, client_id, is_primary").eq("org_id", org.id).not("client_id", "is", null).is("archived_at", null);
  if (onlyClientId) propsQuery = propsQuery.eq("client_id", onlyClientId);

  const [clients, overdue, lines, props] = await Promise.all([clientsQuery, overdueQuery, loadMetricsLines(db, org.id, org.timezone), propsQuery]);
  if (clients.error) throw clients.error;

  // Vencidas por cliente.
  const overdueBy = new Map<string, { count: number; oldestDueOn: CivilDate; outstandingCents: number }>();
  for (const inv of overdue.data ?? []) {
    if (!inv.client_id || !inv.due_on) continue;
    const current = overdueBy.get(inv.client_id);
    overdueBy.set(inv.client_id, {
      count: (current?.count ?? 0) + 1,
      oldestDueOn: current && current.oldestDueOn < inv.due_on ? current.oldestDueOn : inv.due_on,
      outstandingCents: (current?.outstandingCents ?? 0) + (inv.outstanding_cents ?? 0),
    });
  }

  // Líneas por cliente: su renovación más próxima y su MRR de hoy frente al de hace 90 días.
  const linesBy = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = linesBy.get(line.clientId) ?? [];
    list.push(line);
    linesBy.set(line.clientId, list);
  }
  const before = addDays(today, -MRR_LOOKBACK_DAYS);

  // Clics de la web de cada cliente (su propiedad principal o la primera): 28 días frente a los 28 anteriores.
  const propertyBy = new Map<string, string>();
  for (const p of (props.data ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
    if (p.client_id && !propertyBy.has(p.client_id)) propertyBy.set(p.client_id, p.id);
  }
  const seoRows =
    propertyBy.size === 0
      ? []
      : await fetchAll(
          (from, to) =>
            db
              .from("seo_daily_metrics")
              .select("property_id, metric_on, clicks")
              .eq("org_id", org.id)
              .in("property_id", [...propertyBy.values()])
              .gte("metric_on", seoFrom)
              .lt("metric_on", today)
              .order("property_id")
              .order("metric_on")
              .range(from, to),
          "health.seo",
        );
  const clicksBy = new Map<string, { before: number; now: number }>();
  for (const row of seoRows) {
    const c = clicksBy.get(row.property_id) ?? { before: 0, now: 0 };
    if (row.metric_on < seoSplit) c.before += row.clicks;
    else c.now += row.clicks;
    clicksBy.set(row.property_id, c);
  }

  const result = new Map<string, ClientHealth>();
  for (const client of clients.data ?? []) {
    if (!client.id || !client.status) continue;
    const clientLines = linesBy.get(client.id) ?? [];
    const renewal = upcomingRenewals(linesInForce(clientLines, today), today, HEALTH_RULES.renewalWarningDays)[0];
    const mrrNow = orgMrrCents(clientLines, today);
    const mrrBefore = orgMrrCents(clientLines, before);
    const propertyId = propertyBy.get(client.id);
    const clicks = propertyId ? clicksBy.get(propertyId) : undefined;
    result.set(
      client.id,
      clientHealth(
        {
          status: client.status,
          overdue: overdueBy.get(client.id) ?? null,
          lastActivityOn: client.last_activity_at ? nowInZone(org.timezone, new Date(client.last_activity_at)).date : null,
          renewal: renewal ? { on: renewal.renewsOn, amountCents: renewal.amountCents } : null,
          seoClicksChange: clicks && clicks.before >= MIN_SEO_CLICKS ? (clicks.now - clicks.before) / clicks.before : null,
          mrr: mrrBefore > 0 ? { nowCents: mrrNow, beforeCents: mrrBefore } : null,
        },
        today,
      ),
    );
  }
  return result;
}
