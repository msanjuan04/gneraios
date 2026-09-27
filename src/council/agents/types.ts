// Definición de un agente del consejo: qué tools puede usar, cuándo trabaja y qué hace cuando un
// socio pulsa "Ejecutar ahora". El prompt vive al lado, en prompt.md.

import type { ToolName } from "../tools/registry";
import type { AgentName, Task } from "../types";

export type Schedule =
  | { kind: "daily"; hour: number }
  /** weekday: 1 = lunes … 7 = domingo (ISO). */
  | { kind: "weekly"; weekday: number; hour: number }
  | { kind: "monthly"; day: number; hour: number };

export type ScheduledTask = {
  task: Task;
  /** Cómo se llama el disparador en la cola (agent_jobs.trigger). */
  trigger: string;
  /** En la zona horaria de la org. */
  schedule: Schedule;
};

export type AgentDefinition = {
  name: AgentName;
  /** Carpeta de src/council/agents con su prompt.md. */
  dir: string;
  /** Tools que puede usar; el resto se le deniega. Vacío = las del agente que revisa (abogado del diablo). */
  tools: readonly ToolName[];
  /** Lo que hace con "Ejecutar ahora" (null: no se lanza a mano). */
  manualTask: Task | null;
  schedules: readonly ScheduledTask[];
  /** Disparadores por eventos del diseño (CONSEJO.md §6), para cuando haya triggers en Postgres. */
  events: readonly string[];
};
