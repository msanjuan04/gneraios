// Informe mensual de un cliente: lo que se ha hecho, lo que viene y los datos del mes, con
// palabras neutras y sin promesas. Aquí solo hay tipos; las reglas viven en cada módulo de
// src/domain/reports y el PDF (src/pdf/report-*.ts) solo le pone texto y maqueta.

import type { CivilDate } from "../dates/civil-date";
import type { Month } from "../metrics/months";
import type { ClientInvoiceStatus, InvoiceStatus } from "../portal/payment";
import type { ProjectKind, ProjectStatus, TaskStatus } from "../projects/types";
import type { TrafficChannel } from "../seo/channels";
import type { SearchDay, WebDay } from "../seo/metrics";
import type { QueryStat } from "../seo/opportunities";
import type { DataSpan, DayRange } from "../seo/period";

export type ReportLocale = "es" | "ca" | "en";
export type ReportBillingType = "one_off" | "monthly" | "yearly" | "usage";
export type ReportActivityKind = "call" | "meeting" | "email" | "note";
export type ReportOpenTaskStatus = Exclude<TaskStatus, "done">;

// ---------------------------------------------------------------------------
// Hechos de entrada (lo que carga src/server/reports/load.ts, sin interpretar)
// ---------------------------------------------------------------------------

/** Un contrato firmado del cliente con sus líneas. Nada de notas: son internas. */
export type ReportContractFact = {
  id: string;
  title: string;
  signedOn: CivilDate | null;
  archived: boolean;
  lines: ReportLineFact[];
};

export type ReportLineFact = {
  id: string;
  position: number;
  description: string;
  billingType: ReportBillingType;
  startsOn: CivilDate | null;
  /** Último día de servicio (una baja ya lo fija). */
  endsOn: CivilDate | null;
  /** La línea anterior a la que sustituye (un cambio de precio cierra una línea y abre otra). */
  replacesLineId: string | null;
  /** Pausas (solo cuentan en las mensuales y anuales). */
  pauses: { startsOn: CivilDate; endsOn: CivilDate | null }[];
  /**
   * Puntual: un valor por hito del contrato, el día en que se facturó a esta línea (null si aún
   * no). Vacío si el contrato no tiene hitos.
   */
  milestonesBilledOn: (CivilDate | null)[];
};

/** Un proyecto que el cliente puede ver, con solo sus tareas visibles (en el orden del tablero). */
export type ReportProjectFact = {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  tasks: ReportTaskFact[];
};

export type ReportTaskFact = {
  id: string;
  title: string;
  status: TaskStatus;
  dueOn: CivilDate | null;
  /** Instante en que pasó a hecha (ISO); null si no está hecha. */
  completedAt: string | null;
};

/** Una actividad que un socio ha marcado como visible para el cliente. */
export type ReportActivityFact = {
  id: string;
  kind: ReportActivityKind;
  title: string;
  body: string | null;
  occurredAt: string;
};

/** Un entregable del portal (fichero subido o enlace). */
export type ReportFileFact = {
  id: string;
  kind: "file" | "link";
  title: string;
  fileName: string | null;
  url: string | null;
  /** Un fichero no cuenta hasta que su subida se confirma. */
  uploadedAt: string | null;
  createdAt: string;
};

/** Una factura emitida del cliente (invoices_overview), con su estado de hoy. */
export type ReportInvoiceFact = {
  id: string;
  number: string | null;
  kind: "ordinary" | "rectifying";
  status: InvoiceStatus;
  issuedOn: CivilDate | null;
  dueOn: CivilDate | null;
  totalCents: number;
  outstandingCents: number;
};

/** Horas registradas en un proyecto del cliente. */
export type ReportTimeFact = { projectId: string; workedOn: CivilDate; minutes: number };

/** Un proyecto del cliente para repartir las horas: los que no ve el cliente no se nombran. */
export type ReportHoursProject = { id: string; name: string; visible: boolean };

/** Por qué el informe lleva, o no, el bloque de la web (para quien lo prepara). */
export type ReportWebStatus = "included" | "no_data" | "section_off" | "no_property";

/**
 * Si al cliente se le enseñan datos de su web: hace falta una web conectada a su ficha y la sección
 * «Datos de tu web» de su portal encendida (apagada por defecto: lo decide un socio).
 */
export type ReportWebGate = "eligible" | "section_off" | "no_property";

/** Lo medido de la web principal del cliente, del mes anterior y del mes. */
export type ReportWebFacts = {
  /** "clinicamarblau.com" */
  site: string;
  source: "gsc" | "ga4" | "demo" | null;
  /** Días que cubren los datos de Search Console y de GA4 (un día sin fila es un día a cero). */
  searchSpan: DataSpan;
  webSpan: DataSpan;
  searchDays: SearchDay[];
  /** Total del día (canal "all"). */
  webAll: WebDay[];
  webByChannel: ReadonlyMap<TrafficChannel, readonly WebDay[]>;
  /** Consultas del mes por clics (con el mes anterior, si se pidió), de más a menos. */
  topQueries: QueryStat[];
};

export type ClientMonthReportInput = {
  month: Month;
  /** Hoy en la zona de la org. */
  today: CivilDate;
  timeZone: string;
  locale: ReportLocale;
  clientName: string;
  senderName: string;
  contracts: ReportContractFact[];
  projects: ReportProjectFact[];
  activities: ReportActivityFact[];
  files: ReportFileFact[];
  webGate: ReportWebGate;
  /** Solo si `webGate` es "eligible" (y la web tiene algún dato). */
  web: ReportWebFacts | null;
  invoices: ReportInvoiceFact[];
  /** Solo si se piden las horas. */
  hours: { entries: ReportTimeFact[]; projects: ReportHoursProject[] } | null;
};

// ---------------------------------------------------------------------------
// El informe
// ---------------------------------------------------------------------------

export type ReportService = {
  id: string;
  description: string;
  billingType: ReportBillingType;
  contractTitle: string;
  /** Desde cuándo presta servicio (la línea o, si no lo dice, la firma del contrato). */
  startsOn: CivilDate;
  endsOn: CivilDate | null;
  /** Mensual o anual con algún día del mes en pausa. */
  pausedInMonth: boolean;
};

export type ReportDoneTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectKind: ProjectKind;
  completedOn: CivilDate;
};

export type ReportActivity = {
  id: string;
  kind: ReportActivityKind;
  title: string;
  body: string | null;
  occurredOn: CivilDate;
};

/** Un próximo paso. Sin fecha a propósito: es lo que viene, no una promesa de cuándo. */
export type ReportNextStep = {
  id: string;
  title: string;
  projectName: string;
  status: ReportOpenTaskStatus;
};

export type ReportDeliverable = {
  id: string;
  kind: "file" | "link";
  title: string;
  fileName: string | null;
  /** Solo en los enlaces http(s). */
  url: string | null;
  sharedOn: CivilDate;
};

/** Una cifra del mes con la del mes anterior, si se puede comparar. */
export type ReportMetric = {
  value: number;
  previous: number | null;
  /** Variación relativa (0,12 = +12 %); null sin base con la que comparar. */
  change: number | null;
};

/** Posición media: más baja es más arriba. `gain` positivo es subir (de la 8 a la 5 son +3). */
export type ReportPosition = { value: number | null; previous: number | null; gain: number | null };

export type ReportChannel = {
  channel: TrafficChannel;
  paid: boolean;
  sessions: number;
  previous: number | null;
  change: number | null;
  /** Peso en las visitas del mes (0..1). */
  share: number;
};

export type ReportQuery = {
  query: string;
  clicks: number;
  impressions: number;
  position: number | null;
  /** Clics del mes anterior, si se puede comparar. */
  previousClicks: number | null;
};

export type ReportSearchBlock = {
  /** Días del mes con datos. */
  range: DayRange;
  /** Hay datos del mes entero. */
  complete: boolean;
  /** Hay datos de los dos meses enteros: las cifras llevan la del mes anterior. */
  compared: boolean;
  clicks: ReportMetric;
  impressions: ReportMetric;
  position: ReportPosition;
};

export type ReportVisitsBlock = {
  range: DayRange;
  complete: boolean;
  compared: boolean;
  sessions: ReportMetric;
  /** Visitas por canal, de más a menos; null si GA4 aún no da el desglose. */
  channels: ReportChannel[] | null;
};

export type ReportWeb = {
  site: string;
  source: "gsc" | "ga4" | "demo" | null;
  search: ReportSearchBlock | null;
  visits: ReportVisitsBlock | null;
  topQueries: ReportQuery[];
};

export type ReportInvoice = {
  id: string;
  number: string;
  issuedOn: CivilDate;
  dueOn: CivilDate | null;
  totalCents: number;
  outstandingCents: number;
  status: ClientInvoiceStatus;
};

export type ReportHours = {
  totalMinutes: number;
  /** Por proyecto, de más a menos; `name` null agrupa los proyectos que el cliente no ve. */
  projects: { name: string | null; minutes: number }[];
};

export type ClientMonthReport = {
  locale: ReportLocale;
  month: Month;
  /** El día en que se genera (los estados de las facturas son de ese día). */
  generatedOn: CivilDate;
  /** El mes aún no ha terminado. */
  inProgress: boolean;
  clientName: string;
  senderName: string;
  services: { recurring: ReportService[]; oneOff: ReportService[] };
  workDone: { tasks: ReportDoneTask[]; activities: ReportActivity[] };
  nextSteps: { items: ReportNextStep[]; more: number };
  deliverables: ReportDeliverable[];
  web: ReportWeb | null;
  webStatus: ReportWebStatus;
  invoices: { issued: ReportInvoice[]; pending: ReportInvoice[]; pendingTotalCents: number };
  hours: ReportHours | null;
};

/** Lo que se enseña antes de generarlo (la tarjeta de la ficha del cliente). */
export type ClientMonthReportCounts = {
  tasksDone: number;
  activities: number;
  nextSteps: number;
  deliverables: number;
  services: number;
  invoices: number;
  webStatus: ReportWebStatus;
  hoursMinutes: number | null;
};
