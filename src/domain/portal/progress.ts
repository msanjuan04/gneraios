import { compareCivil, type CivilDate } from "@/domain/dates/civil-date";

/**
 * «En qué estamos»: las fases de un proyecto son los hitos de su contrato. Una fase está hecha
 * cuando su hito ya se ha facturado (tiene su pendiente, como en el motor); la primera sin hacer
 * es la que está en curso, y las demás vienen después, con su fecha prevista si la tienen.
 * El estado se deriva: nada de esto se guarda.
 */

export type PhaseState = "done" | "current" | "upcoming";

export type MilestoneInput = {
  id: string;
  position: number;
  label: string;
  plannedOn: CivilDate | null;
};

export type ProjectPhase = {
  id: string;
  label: string;
  state: PhaseState;
  plannedOn: CivilDate | null;
};

export type PhaseProgress = { done: number; total: number; /** 0…1 */ ratio: number };

export function projectPhases(milestones: readonly MilestoneInput[], billedIds: ReadonlySet<string>): ProjectPhase[] {
  const ordered = [...milestones].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  let currentTaken = false;
  return ordered.map((m) => {
    let state: PhaseState;
    if (billedIds.has(m.id)) state = "done";
    else if (!currentTaken) {
      state = "current";
      currentTaken = true;
    } else state = "upcoming";
    return { id: m.id, label: m.label.trim(), state, plannedOn: m.plannedOn };
  });
}

export function phaseProgress(phases: readonly ProjectPhase[]): PhaseProgress {
  const done = phases.filter((p) => p.state === "done").length;
  return { done, total: phases.length, ratio: phases.length === 0 ? 0 : done / phases.length };
}

/** La próxima fecha prevista entre las fases sin hacer, si hay alguna. */
export function nextPlannedOn(phases: readonly ProjectPhase[]): CivilDate | null {
  const dates = phases.filter((p) => p.state !== "done" && p.plannedOn).map((p) => p.plannedOn as CivilDate);
  return dates.sort(compareCivil)[0] ?? null;
}
