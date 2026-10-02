import type { Enums } from "@/lib/supabase/database.types";

export type BoardStage = {
  id: string;
  name: string;
  kind: Enums<"stage_kind">;
  position: number;
  defaultProbabilityBps: number;
};

export type BoardOption = { id: string; name: string };
export type BoardMember = { id: string; fullName: string; initials: string };

/** Un deal tal y como lo pinta el tablero (derivado de la vista `deals_board`). */
export type BoardDeal = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  stageId: string;
  estOneOffCents: number;
  estMrrCents: number;
  /** Probabilidad efectiva: la del deal o, si no tiene, la de su etapa. */
  probabilityBps: number;
  probabilityOverrideBps: number | null;
  sourceId: string | null;
  broughtById: string | null;
  ownerId: string | null;
  ownerInitials: string | null;
  nextAction: string | null;
  nextActionOn: string | null;
  nextActionOverdue: boolean;
  daysInStage: number;
  /** Último correo, llamada o reunión del deal (derivado de las actividades); null si no hay ninguno. */
  lastContactDaysAgo: number | null;
  /** Sentido de ese último contacto si fue un correo: `outgoing` = esperamos respuesta, `incoming` = nos toca. */
  lastContactDirection: "incoming" | "outgoing" | "internal" | null;
  lossReasonId: string | null;
  lossNote: string | null;
};
