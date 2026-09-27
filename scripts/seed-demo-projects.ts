/**
 * Proyectos de la org demo: 4 plantillas (web, SEO mensual, campaña de Ads y branding), 8 proyectos
 * de los clientes de la demo enlazados a sus contratos, tareas en todos los estados y los últimos 3
 * meses de horas de los socios de la demo.
 *
 *   pnpm exec tsx --env-file-if-exists=.env.local scripts/seed-demo-projects.ts
 *
 * Necesita la org `demo` de `pnpm db:seed:demo` (y se vuelve a ejecutar después de recrearla).
 * Las horas de cada proyecto se calibran con lo que de verdad ha facturado su contrato (vista
 * project_contract_revenue) para que salgan todos los colores de la tarifa efectiva: muy rentables,
 * cerca del objetivo, por debajo y pasados de presupuesto.
 *
 * Es determinista (misma semilla y mismo día → mismos datos) y re-ejecutable: borra los proyectos de
 * la demo (y los restos de demos anteriores) y los vuelve a crear. Solo contra la base local: se
 * niega a conectarse a cualquier otro host.
 */
import postgres from "postgres";
import { addDays, compareCivil, parseCivilDate, type CivilDate } from "../src/domain/dates/civil-date";
import { projectEconomics } from "../src/domain/projects/economics";
import { POSITION_STEP } from "../src/domain/projects/ordering";
import type { ProjectKind, ProjectStatus, TaskPriority, TaskStatus } from "../src/domain/projects/types";
import { nowInZone } from "../src/lib/clock";

const DATABASE_URL = process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const LOCAL = ["127.0.0.1", "localhost", "::1"];
for (const target of [DATABASE_URL, API_URL]) {
  const host = target ? new URL(target).hostname : "";
  if (!LOCAL.includes(host)) {
    console.error(`Solo se siembra la base local; «${host || "sin URL"}» no lo es (¿falta .env.local?).`);
    process.exit(1);
  }
}

// PRNG determinista (mulberry32).
let seed = 20260928;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)]!;
const chance = (p: number) => rand() < p;

/** Últimos 3 meses de horas. */
const WINDOW_DAYS = 91;
const TARGET_CENTS = 6000; // el objetivo por defecto de la org demo (orgs.settings no lo cambia)

type TemplateTaskSeed = { title: string; hours?: number; day?: number; visible?: boolean };
type TemplateSeed = { name: string; kind: ProjectKind; tasks: TemplateTaskSeed[] };

const TEMPLATES: TemplateSeed[] = [
  {
    name: "Web corporativa",
    kind: "web",
    tasks: [
      { title: "Briefing y kick-off", hours: 2, day: 0, visible: true },
      { title: "Arquitectura y wireframes", hours: 6, day: 5, visible: true },
      { title: "Diseño de la home y plantillas", hours: 16, day: 14, visible: true },
      { title: "Maquetación y desarrollo", hours: 30, day: 28 },
      { title: "Contenidos y SEO on-page", hours: 8, day: 35 },
      { title: "Revisión con el cliente", hours: 3, day: 40, visible: true },
      { title: "Lanzamiento y formación", hours: 4, day: 45, visible: true },
    ],
  },
  {
    name: "SEO mensual",
    kind: "seo",
    tasks: [
      { title: "Auditoría técnica", hours: 4, day: 0, visible: true },
      { title: "Investigación de palabras clave", hours: 4, day: 3 },
      { title: "Optimización on-page", hours: 6, day: 7, visible: true },
      { title: "Dos artículos para el blog", hours: 6, day: 14, visible: true },
      { title: "Link building local", hours: 4, day: 21 },
      { title: "Informe mensual", hours: 2, day: 28, visible: true },
    ],
  },
  {
    name: "Campaña Ads",
    kind: "ads",
    tasks: [
      { title: "Briefing y objetivos", hours: 1, day: 0, visible: true },
      { title: "Configurar conversiones y píxel", hours: 3, day: 2 },
      { title: "Creatividades y copys", hours: 6, day: 5, visible: true },
      { title: "Lanzamiento de la campaña", hours: 2, day: 7, visible: true },
      { title: "Optimización semanal", hours: 4, day: 14 },
      { title: "Informe de resultados", hours: 2, day: 30, visible: true },
    ],
  },
  {
    name: "Branding",
    kind: "branding",
    tasks: [
      { title: "Workshop de marca", hours: 3, day: 0, visible: true },
      { title: "Moodboard y territorios", hours: 6, day: 7, visible: true },
      { title: "Propuestas de logotipo", hours: 12, day: 14, visible: true },
      { title: "Ajustes y versión final", hours: 6, day: 24 },
      { title: "Manual de marca", hours: 8, day: 30, visible: true },
      { title: "Papelería y aplicaciones", hours: 6, day: 35 },
    ],
  },
];

type TaskSeed = {
  title: string;
  status: TaskStatus;
  /** Días desde hoy (negativo = pasado). */
  due?: number;
  hours?: number;
  priority?: TaskPriority;
  visible?: boolean;
  /** Índice en la lista de socios de la demo (los ficticios primero). */
  who?: number;
  description?: string;
};

type ProjectSeed = {
  name: string;
  /** Cliente por su nombre comercial; sin él, proyecto interno. */
  client?: string;
  /** Contrato del cliente por su título. */
  contract?: string;
  kind: ProjectKind;
  status: ProjectStatus;
  /** Días desde hoy. */
  starts: number;
  due?: number;
  budgetHours?: number;
  portal?: boolean;
  owner: number;
  notes?: string;
  /**
   * Tarifa efectiva a la que se calibran las horas (€/h): con lo facturado del contrato, las horas
   * salen solas. Sin contrato (o sin nada facturado), `hours` fijas.
   */
  rateEuros?: number;
  hours?: number;
  /** Reparto de las horas de un contrato compartido (esta parte / el total). */
  share?: number;
  /** Hasta cuántos días antes de hoy hay horas (un proyecto hecho deja de tenerlas). */
  endsDaysAgo?: number;
  /** Desde cuándo hay horas (días desde hoy), si no es el inicio: el trabajo previo de un proyecto planificado. */
  workFrom?: number;
  /** Quién registra horas (índices) y con qué peso. */
  crew: [number, number][];
  tasks: TaskSeed[];
};

const PROJECTS: ProjectSeed[] = [
  {
    name: "Tienda online: catálogo B2B y fichas",
    client: "Celler Turó d'Alella",
    contract: "Tienda online",
    kind: "web",
    status: "active",
    starts: -88,
    due: 12,
    budgetHours: 150,
    portal: true,
    owner: 0,
    notes: "Fase 2 de la tienda: área para distribuidores con tarifas propias, fichas técnicas y envíos por palés.",
    rateEuros: 36,
    crew: [
      [0, 5],
      [1, 3],
      [2, 1],
    ],
    tasks: [
      { title: "Workshop con el equipo comercial", status: "done", due: -84, hours: 3, visible: true, who: 0 },
      { title: "Estructura de categorías y filtros", status: "done", due: -70, hours: 10, visible: true, who: 0 },
      { title: "Importar el catálogo desde el ERP", status: "done", due: -55, hours: 24, priority: "high", who: 1 },
      { title: "Tarifas por distribuidor (B2B)", status: "doing", due: -6, hours: 30, priority: "urgent", who: 1, description: "Precios por grupo de cliente y mínimos por pedido. Pendiente de la lista de distribuidores." },
      { title: "Fichas técnicas descargables", status: "review", due: -2, hours: 12, visible: true, who: 0 },
      { title: "Envíos por palés y transportista", status: "doing", due: 4, hours: 16, priority: "high", who: 2 },
      { title: "Fotografía de producto (lote 2)", status: "todo", due: 7, hours: 6, visible: true, who: 0 },
      { title: "Formación al equipo del celler", status: "todo", due: 11, hours: 3, visible: true },
    ],
  },
  {
    name: "SEO local mensual",
    client: "Clínica Dental Mar Blau",
    contract: "SEO local y campañas",
    kind: "seo",
    status: "active",
    starts: -120,
    budgetHours: 110,
    portal: true,
    owner: 1,
    notes: "SEO local para Mataró y el Maresme. Informe el día 5 de cada mes.",
    rateEuros: 105,
    share: 0.6,
    crew: [
      [1, 5],
      [0, 2],
    ],
    tasks: [
      { title: "Auditoría técnica de septiembre", status: "done", due: -20, hours: 4, visible: true, who: 1 },
      { title: "Fichas de Google Business por tratamiento", status: "done", due: -40, hours: 6, visible: true, who: 1 },
      { title: "Artículo: precio de un implante dental", status: "review", due: -1, hours: 4, visible: true, who: 0 },
      { title: "Artículo: ortodoncia invisible en Mataró", status: "doing", due: 5, hours: 4, visible: true, who: 0 },
      { title: "Link building con medios locales", status: "doing", due: 12, hours: 6, who: 1 },
      { title: "Informe mensual de septiembre", status: "todo", due: 9, hours: 2, visible: true, who: 1, priority: "high" },
      { title: "Revisar reseñas y responder", status: "todo", hours: 1, priority: "low", who: 1 },
    ],
  },
  {
    name: "Campañas Google y Meta Ads",
    client: "Clínica Dental Mar Blau",
    contract: "SEO local y campañas",
    kind: "ads",
    status: "active",
    starts: -120,
    budgetHours: 70,
    owner: 2,
    rateEuros: 105,
    share: 0.4,
    crew: [
      [2, 4],
      [1, 1],
    ],
    tasks: [
      { title: "Campaña de blanqueamiento (septiembre)", status: "done", due: -18, hours: 5, visible: true, who: 2 },
      { title: "Configurar conversiones de llamadas", status: "done", due: -60, hours: 3, who: 2 },
      { title: "Creatividades de otoño", status: "review", due: 2, hours: 6, visible: true, who: 2 },
      { title: "Optimización de pujas por zona", status: "doing", due: 3, hours: 4, who: 1 },
      { title: "Campaña de urgencias dentales", status: "todo", due: 14, hours: 4, visible: true, who: 2 },
    ],
  },
  {
    name: "SEO para hoteles",
    client: "Hotel Llevant Calella",
    contract: "SEO y analítica",
    kind: "seo",
    status: "active",
    starts: -110,
    budgetHours: 90,
    portal: true,
    owner: 0,
    notes: "Temporada alta cubierta. En otoño: contenidos para escapadas y mercado francés.",
    rateEuros: 160,
    crew: [
      [0, 3],
      [3, 1],
    ],
    tasks: [
      { title: "Landing de ofertas de temporada", status: "done", due: -75, hours: 6, visible: true, who: 0 },
      { title: "Versión en francés de habitaciones", status: "done", due: -30, hours: 8, visible: true, who: 0 },
      { title: "Datos estructurados de hotel y ofertas", status: "done", due: -12, hours: 3, who: 3 },
      { title: "Contenido: qué ver en Calella en otoño", status: "doing", due: 6, hours: 4, visible: true, who: 0 },
      { title: "Informe de temporada alta", status: "review", due: 1, hours: 3, visible: true, who: 3, priority: "high" },
      { title: "Auditoría de velocidad (Core Web Vitals)", status: "todo", due: 20, hours: 4, who: 3 },
    ],
  },
  {
    name: "Redes sociales",
    client: "Immobiliària Costa Nord",
    contract: "Redes sociales y hosting",
    kind: "social",
    status: "paused",
    starts: -150,
    // En pausa y con la entrega pasada: cuenta como retraso (en pausa aún pide trabajo).
    due: -10,
    budgetHours: 100,
    owner: 1,
    notes: "En pausa desde verano a petición del cliente; retomamos cuando confirmen el calendario de captación.",
    rateEuros: 52,
    endsDaysAgo: 18,
    crew: [
      [1, 3],
      [2, 2],
    ],
    tasks: [
      { title: "Calendario editorial de julio", status: "done", due: -80, hours: 4, who: 1 },
      { title: "Reels de pisos en primera línea", status: "done", due: -60, hours: 10, visible: true, who: 2 },
      { title: "Campaña de alquiler de temporada", status: "done", due: -45, hours: 8, who: 1 },
      { title: "Calendario editorial de octubre", status: "todo", due: -3, hours: 4, priority: "high", who: 1 },
      { title: "Sesión de fotos en la oficina de Premià", status: "todo", due: 15, hours: 5, visible: true, who: 2 },
    ],
  },
  {
    name: "Web corporativa",
    client: "Tallers Rius",
    contract: "Web y mantenimiento",
    kind: "web",
    status: "done",
    starts: -85,
    due: -20,
    budgetHours: 40,
    portal: true,
    owner: 2,
    rateEuros: 50,
    endsDaysAgo: 19,
    crew: [
      [2, 3],
      [0, 1],
    ],
    tasks: [
      { title: "Briefing y kick-off", status: "done", due: -84, hours: 2, visible: true, who: 2 },
      { title: "Arquitectura y wireframes", status: "done", due: -75, hours: 5, visible: true, who: 2 },
      { title: "Diseño de la home y servicios", status: "done", due: -62, hours: 10, visible: true, who: 0 },
      { title: "Maquetación y desarrollo", status: "done", due: -40, hours: 16, who: 2 },
      { title: "Reserva de cita online", status: "done", due: -30, hours: 5, visible: true, who: 2 },
      { title: "Lanzamiento y formación", status: "done", due: -21, hours: 3, visible: true, who: 2 },
    ],
  },
  {
    name: "Lanzamiento de redes y SEO",
    client: "Acadèmia Babel",
    contract: "Marketing para la academia",
    kind: "social",
    status: "active",
    starts: -12,
    due: 45,
    budgetHours: 30,
    owner: 3,
    // Recién empezado: aún no se ha facturado nada (la primera mensualidad sale el día 1).
    hours: 14,
    crew: [
      [3, 2],
      [1, 1],
    ],
    tasks: [
      { title: "Briefing con dirección", status: "done", due: -10, hours: 2, visible: true, who: 3 },
      { title: "Auditoría de perfiles y web", status: "done", due: -6, hours: 3, who: 1 },
      { title: "Plan de contenidos de octubre", status: "review", due: 0, hours: 3, visible: true, who: 3 },
      { title: "Diseño de plantillas para Instagram", status: "doing", due: 3, hours: 5, visible: true, who: 1 },
      { title: "Campaña de matrícula (Meta Ads)", status: "todo", due: 10, hours: 4, priority: "high", who: 3 },
      { title: "SEO: fichas de cursos", status: "todo", due: 21, hours: 6, visible: true },
    ],
  },
  {
    name: "Rediseño de la web de GNERAI",
    kind: "internal",
    status: "planned",
    starts: 14,
    due: 75,
    owner: 0,
    notes: "Nuevo portfolio con casos reales y páginas por servicio.",
    hours: 18,
    workFrom: -30,
    crew: [
      [0, 2],
      [3, 1],
    ],
    tasks: [
      { title: "Recopilar casos de éxito", status: "doing", due: 7, hours: 6, who: 0 },
      { title: "Benchmark de agencias", status: "done", due: -15, hours: 4, who: 3 },
      { title: "Estructura de páginas por servicio", status: "todo", due: 20, hours: 8, who: 0 },
      { title: "Sesión de fotos del equipo", status: "todo", hours: 3, priority: "low" },
    ],
  },
];

const NOTES: Record<ProjectKind, string[]> = {
  web: ["Maquetación", "Ajustes de diseño", "Reunión de seguimiento", "Pruebas en móvil", "Correcciones del cliente", "Desarrollo", "Revisión interna"],
  seo: ["Optimización on-page", "Redacción", "Informe", "Revisión de rankings", "Link building", "Auditoría técnica"],
  ads: ["Optimización de campañas", "Creatividades", "Informe semanal", "Ajuste de pujas", "Revisión de conversiones"],
  branding: ["Bocetos", "Presentación", "Ajustes"],
  social: ["Contenido", "Programación de publicaciones", "Diseño de piezas", "Community management", "Reunión con el cliente"],
  maintenance: ["Actualizaciones", "Copias de seguridad", "Incidencia"],
  internal: ["Investigación", "Redacción", "Reunión interna"],
  other: ["Trabajo"],
};

const PROJECT_TABLES = ["time_entries", "project_tasks", "projects", "project_templates"] as const;

const sql = postgres(DATABASE_URL, { onnotice: () => {} });

function isWeekday(date: CivilDate): boolean {
  const { year, month, day } = parseCivilDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** Reparte `total` minutos en registros de 30 min a 4 h (en cuartos de hora) por días laborables. */
function spread(total: number, from: CivilDate, to: CivilDate): { workedOn: CivilDate; minutes: number }[] {
  const days: CivilDate[] = [];
  for (let d = from; compareCivil(d, to) <= 0; d = addDays(d, 1)) if (isWeekday(d)) days.push(d);
  if (days.length === 0 || total <= 0) return [];
  const out: { workedOn: CivilDate; minutes: number }[] = [];
  let left = total;
  while (left > 0) {
    const minutes = Math.min(left, int(2, 16) * 15);
    // Más trabajo hacia el final de la ventana (lo reciente pesa más).
    const index = Math.min(days.length - 1, Math.floor(Math.sqrt(rand()) * days.length));
    out.push({ workedOn: days[index]!, minutes: Math.max(15, minutes) });
    left -= minutes;
  }
  return out;
}

async function main() {
  const [org] = await sql`select id, timezone from public.orgs where slug = 'demo'`;
  if (!org) throw new Error("No existe la org demo: ejecuta antes `pnpm db:seed:demo`.");
  const orgId: string = org.id;
  const today = nowInZone(org.timezone).date;
  const windowStart = addDays(today, -WINDOW_DAYS);

  // Socios de la demo: primero los ficticios (Laia y Pau), luego los owners reales que la ven.
  const members = (
    await sql`select id, full_name, role from public.members where org_id = ${orgId} and is_active order by (role = 'partner') desc, created_at`
  ).map((m) => ({ id: m.id as string, name: m.full_name as string }));
  if (members.length === 0) throw new Error("La org demo no tiene socios activos.");
  const member = (index: number | undefined) => (index === undefined ? null : members[index % members.length]!.id);

  const clients = new Map<string, string>(
    (await sql`select id, display_name from public.clients where org_id = ${orgId}`).map((c) => [c.display_name as string, c.id as string]),
  );
  const contracts = await sql`
    select k.id, k.title, k.client_id,
           (select coalesce(sum(r.base_cents), 0) from public.project_contract_revenue r where r.contract_id = k.id)::bigint as revenue
    from public.contracts k where k.org_id = ${orgId}`;
  const contractOf = (clientId: string, title: string) => contracts.find((k) => k.client_id === clientId && k.title === title);
  for (const p of PROJECTS) {
    if (p.client && !clients.has(p.client)) throw new Error(`No existe el cliente «${p.client}» en la demo: ¿cambió scripts/seed-demo.ts?`);
    if (p.client && p.contract && !contractOf(clients.get(p.client)!, p.contract)) {
      throw new Error(`El cliente «${p.client}» no tiene el contrato «${p.contract}»: ¿cambió scripts/seed-demo.ts?`);
    }
  }

  // 0. Fuera los proyectos de la demo y los restos de demos anteriores (`pnpm db:seed:demo` recrea
  //    la org con otro id y deja atrás lo que no conoce). Sin triggers, como los otros seeds.
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const table of PROJECT_TABLES) {
      await tx.unsafe(`delete from public.${table} where org_id = $1 or org_id not in (select id from public.orgs)`, [orgId]);
    }
    await tx`delete from public.audit_log where org_id = ${orgId} and table_name = any(${[...PROJECT_TABLES]})`;
  });

  const totals = { templates: 0, projects: 0, tasks: 0, entries: 0, minutes: 0 };
  const summary: string[] = [];

  await sql.begin(async (tx) => {
    // 1. Plantillas.
    for (const template of TEMPLATES) {
      const tasks = template.tasks.map((t) => ({
        title: t.title,
        estimate_minutes: t.hours ? t.hours * 60 : null,
        offset_days: t.day ?? null,
        client_visible: t.visible === true,
      }));
      await tx`insert into public.project_templates (org_id, name, kind, tasks) values (${orgId}, ${template.name}, ${template.kind}, ${tx.json(tasks)})`;
      totals.templates += 1;
    }

    // 2. Proyectos, con sus tareas y sus horas.
    for (const p of PROJECTS) {
      const clientId = p.client ? clients.get(p.client)! : null;
      const contract = clientId && p.contract ? contractOf(clientId, p.contract) : undefined;
      const [project] = await tx`
        insert into public.projects (org_id, client_id, contract_id, name, kind, status, owner_member_id, starts_on, due_on,
                                     budget_minutes, portal_visible, notes, created_at)
        values (${orgId}, ${clientId}, ${contract?.id ?? null}, ${p.name}, ${p.kind}, ${p.status}, ${member(p.owner)},
                ${addDays(today, p.starts)}, ${p.due === undefined ? null : addDays(today, p.due)},
                ${p.budgetHours ? p.budgetHours * 60 : null}, ${p.portal === true}, ${p.notes ?? null},
                ${new Date(`${addDays(today, Math.min(p.starts, -1))}T09:00:00Z`)})
        returning id`;
      const projectId: string = project!.id;
      totals.projects += 1;

      // Tareas: en su columna y en orden; las hechas, fechadas el día de su fecha (o antes de hoy).
      const columns = new Map<TaskStatus, number>();
      const taskRows: { id: string; status: TaskStatus }[] = [];
      for (const t of p.tasks) {
        const position = (columns.get(t.status) ?? 0) + POSITION_STEP;
        columns.set(t.status, position);
        const dueOn = t.due === undefined ? null : addDays(today, t.due);
        const doneOn = t.status === "done" ? (dueOn && compareCivil(dueOn, today) < 0 ? addDays(dueOn, -int(0, 2)) : addDays(today, -int(1, 5))) : null;
        await tx`select set_config('app.task_completed_at', ${doneOn ? `${doneOn}T${String(int(9, 18)).padStart(2, "0")}:30:00+02:00` : ""}, true)`;
        const [task] = await tx`
          insert into public.project_tasks (org_id, project_id, title, description, status, assignee_member_id, due_on, priority,
                                            estimate_minutes, position, client_visible)
          values (${orgId}, ${projectId}, ${t.title}, ${t.description ?? null}, ${t.status}, ${member(t.who)}, ${dueOn},
                  ${t.priority ?? "normal"}, ${t.hours ? t.hours * 60 : null}, ${position}, ${t.visible === true})
          returning id`;
        taskRows.push({ id: task!.id as string, status: t.status });
        totals.tasks += 1;
      }
      await tx`select set_config('app.task_completed_at', '', true)`;

      // Horas: calibradas con lo facturado para que la tarifa salga donde se quiere.
      const revenueCents = Number(contract?.revenue ?? 0);
      const targetMinutes =
        p.rateEuros && revenueCents > 0
          ? Math.round(((revenueCents * 60) / (p.rateEuros * 100)) * (p.share ?? 1))
          : (p.hours ?? 0) * 60;
      const start = addDays(today, p.workFrom ?? p.starts);
      const from = compareCivil(start, windowStart) > 0 ? start : windowStart;
      const to = addDays(today, -(p.endsDaysAgo ?? 0));
      const weights = p.crew.flatMap(([who, weight]) => Array.from({ length: weight }, () => who));
      // Cada tarea empezada recibe horas hasta un 30 % por encima de su estimación; lo demás es trabajo
      // del proyecto sin tarea (reuniones, gestión, correcciones), como pasa de verdad.
      const capacity = new Map(
        taskRows.flatMap((t, i) => (t.status === "todo" ? [] : [[t.id, Math.round((p.tasks[i]!.hours ?? 2) * 60 * (1 + rand() * 0.3))] as const])),
      );
      for (const entry of spread(targetMinutes, compareCivil(from, to) <= 0 ? from : to, to)) {
        const open = [...capacity].filter(([, left]) => left >= entry.minutes);
        const task = open.length > 0 && chance(0.9) ? { id: pick(open)[0] } : null;
        if (task) capacity.set(task.id, capacity.get(task.id)! - entry.minutes);
        await tx`
          insert into public.time_entries (org_id, member_id, project_id, task_id, worked_on, minutes, note, billable)
          values (${orgId}, ${member(pick(weights))}, ${projectId}, ${task?.id ?? null}, ${entry.workedOn}, ${entry.minutes},
                  ${chance(0.7) ? pick(NOTES[p.kind]) : null}, ${p.kind === "internal" ? false : chance(0.92)})`;
        totals.entries += 1;
        totals.minutes += entry.minutes;
      }
    }
  });

  // 3. Lo que ha salido: la tarifa de cada proyecto con la misma definición que la app.
  const rows = await sql`
    select name, client_name, contract_id, logged_minutes, budget_minutes, revenue_cents, contract_projects, contract_minutes, status
    from public.projects_overview where org_id = ${orgId} order by client_name nulls last, name`;
  for (const r of rows) {
    const e = projectEconomics(
      {
        contractId: r.contract_id,
        contractRevenueCents: Number(r.revenue_cents),
        projectMinutes: r.logged_minutes,
        contractMinutes: r.contract_minutes,
        contractProjects: r.contract_projects,
      },
      TARGET_CENTS,
    );
    const hours = (r.logged_minutes / 60).toFixed(1);
    const budget = r.budget_minutes ? ` / ${(r.budget_minutes / 60).toFixed(0)} h${r.logged_minutes > r.budget_minutes ? " (pasado)" : ""}` : "";
    const rate = e.rateCents === null ? "sin tarifa" : `${Math.round(e.rateCents / 100)} €/h (${e.standing})`;
    summary.push(`  ${r.client_name ?? "Interno"} · ${r.name} [${r.status}]: ${hours} h${budget} · ${rate}`);
  }

  console.log(summary.join("\n"));
  console.log(
    `Proyectos de la demo listos: ${totals.templates} plantillas, ${totals.projects} proyectos, ${totals.tasks} tareas y ` +
      `${totals.entries} registros de horas (${Math.round(totals.minutes / 60)} h) entre el ${windowStart} y el ${today}. ` +
      `Ábrelos en /demo/projects.`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
