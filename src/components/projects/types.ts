import type { CivilDate } from "@/domain/dates/civil-date";
import type {
  Burn,
  MonthPoint,
  Progress,
  ProjectKind,
  ProjectStatus,
  RateStanding,
  TaskPriority,
  TaskStatus,
  TemplateSummary,
  TemplateTask,
  WeekPoint,
} from "@/domain/projects";

/** Un miembro tal y como se pinta (avatar con sus iniciales y su color). */
export type MemberRef = { id: string; fullName: string; initials: string; color: string | null; active: boolean };

export type Option = { id: string; name: string };

/** Una fila del listado de proyectos, con todo lo que se deriva ya calculado (src/domain/projects). */
export type ProjectListItem = {
  id: string;
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  clientId: string | null;
  clientName: string | null;
  contractId: string | null;
  contractTitle: string | null;
  ownerId: string | null;
  startsOn: CivilDate | null;
  dueOn: CivilDate | null;
  overdue: boolean;
  archived: boolean;
  portalVisible: boolean;
  progress: Progress;
  tasksOverdue: number;
  loggedMinutes: number;
  budgetMinutes: number | null;
  burn: Burn;
  /** Lo facturado que le toca (null sin contrato). */
  revenueCents: number | null;
  /** Tarifa efectiva en céntimos por hora (null sin horas o sin contrato). */
  rateCents: number | null;
  standing: RateStanding;
  sharedContract: boolean;
  nextTask: { id: string; title: string; dueOn: CivilDate | null } | null;
  /** Lo lleva el usuario o tiene tareas suyas. */
  mine: boolean;
  runningTimers: number;
  lastWorkedOn: CivilDate | null;
};

export type ContractOption = { id: string; title: string; clientId: string; signed: boolean };

export type TemplateOption = {
  id: string;
  name: string;
  kind: ProjectKind;
  summary: TemplateSummary;
};

export type ProjectFormOptions = {
  clients: Option[];
  contracts: ContractOption[];
  members: MemberRef[];
  templates: TemplateOption[];
};

export type MemberHours = { memberId: string; minutes: number };

export type ProjectTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  dueOn: CivilDate | null;
  priority: TaskPriority;
  estimateMinutes: number | null;
  position: number;
  clientVisible: boolean;
  completedAt: string | null;
  /** Horas registradas en la tarea (sin el temporizador en marcha). */
  loggedMinutes: number;
};

export type TimeEntry = {
  id: string;
  memberId: string;
  taskId: string | null;
  workedOn: CivilDate;
  /** null mientras el temporizador está en marcha. */
  minutes: number | null;
  startedAt: string | null;
  note: string | null;
  billable: boolean;
};

export type ProjectDetailData = {
  project: ProjectListItem & {
    notes: string | null;
    contractMinutes: number;
    contractProjects: number;
    contractRevenueCents: number;
    billableMinutes: number;
  };
  tasks: ProjectTask[];
  entries: TimeEntry[];
  members: MemberRef[];
  /** Otros proyectos con el mismo contrato (con los que se reparte lo facturado). */
  siblings: Option[];
  weekly: WeekPoint[];
  monthly: MonthPoint[];
  targetCents: number;
};

export type ProjectViewer = {
  slug: string;
  basePath: string;
  memberId: string;
  canEdit: boolean;
  isOwner: boolean;
  today: CivilDate;
};

export type MyTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueOn: CivilDate | null;
  projectId: string;
  projectName: string;
  clientName: string | null;
};

export type TemplateItem = {
  id: string;
  name: string;
  kind: ProjectKind;
  tasks: TemplateTask[];
  summary: TemplateSummary;
  updatedAt: string;
};

/** El temporizador de un miembro (el que enseña la barra superior). */
export type RunningTimer = {
  entryId: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  startedAt: string;
};

export type TimerProjectOption = { id: string; name: string; clientName: string | null };
export type TimerTaskOption = { id: string; title: string; status: TaskStatus };

/** De `getClientProjects` (src/server/projects/cards.ts), para la ficha del cliente. */
export type ClientProjectsData = {
  projects: ProjectListItem[];
  members: MemberRef[];
  /** Rentabilidad del cliente: cada contrato una vez, entre todas las horas de sus proyectos. */
  totals: { revenueCents: number; minutes: number; rateCents: number | null; standing: RateStanding };
  targetCents: number;
};

/** De `getMyTasksCard` (src/server/projects/cards.ts), para el dashboard ("Hoy"). */
export type MyTasksCardData = {
  tasks: MyTask[];
  counts: { overdue: number; today: number; thisWeek: number; open: number };
  today: CivilDate;
};
