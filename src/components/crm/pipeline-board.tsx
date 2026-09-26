"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Plus, SquareKanban } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { moveDeal } from "@/app/[org]/pipeline/actions";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { BoardDeal, BoardMember, BoardOption, BoardStage } from "./board-types";
import { DealCard } from "./deal-card";
import { DealSheet } from "./deal-sheet";
import { LossReasonDialog } from "./loss-reason-dialog";

type Props = {
  slug: string;
  stages: BoardStage[];
  deals: BoardDeal[];
  clients: BoardOption[];
  sources: BoardOption[];
  lossReasons: BoardOption[];
  members: BoardMember[];
  currentMemberId: string;
  canEdit: boolean;
  /** Lo que piden los enlaces: ?new=1&client=… o ?deal=… */
  initial: { newDeal: boolean; clientId?: string; dealId?: string };
};

type SheetState = { open: false } | { open: true; dealId: string | null; clientId?: string; stageId?: string };
type Move = { dealId: string; stageId: string };

export function PipelineBoard(props: Props) {
  const { slug, stages, canEdit } = props;
  const t = useTranslations("pipeline");
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [deals, applyMove] = useOptimistic(props.deals, (state, move: Move) =>
    state.map((d) => (d.id === move.dealId ? { ...d, stageId: move.stageId, daysInStage: 0 } : d)),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingLoss, setPendingLoss] = useState<Move | null>(null);
  const [sheet, setSheet] = useState<SheetState>(() =>
    props.initial.dealId
      ? { open: true, dealId: props.initial.dealId }
      : props.initial.newDeal
        ? { open: true, dealId: null, clientId: props.initial.clientId }
        : { open: false },
  );

  const sensors = useSensors(
    // Un clic abre la tarjeta; arrastrar empieza a partir de 6 px.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] } }),
  );

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const openSheet = (next: SheetState) => {
    setSheet(next);
    // Al cerrar, limpia ?new / ?deal para que recargar no vuelva a abrirlo.
    if (!next.open && window.location.search) router.replace(pathname, { scroll: false });
  };

  function commitMove(move: Move, loss?: { reasonId: string; note: string }) {
    const stage = stageById.get(move.stageId);
    startTransition(async () => {
      applyMove(move);
      const result = await moveDeal(slug, {
        deal_id: move.dealId,
        stage_id: move.stageId,
        ...(loss && { loss_reason_id: loss.reasonId, loss_note: loss.note }),
      });
      if (result.ok) toast.success(t("moved", { stage: stage?.name ?? "" }));
      else toast.error(result.error);
    });
  }

  function requestMove(dealId: string, stageId: string) {
    const deal = deals.find((d) => d.id === dealId);
    if (!canEdit || !deal || deal.stageId === stageId) return;
    // Perder exige motivo: primero se pregunta, luego se mueve.
    if (stageById.get(stageId)?.kind === "lost") setPendingLoss({ dealId, stageId });
    else commitMove({ dealId, stageId });
  }

  function moveBy(deal: BoardDeal, direction: -1 | 1) {
    const index = stages.findIndex((s) => s.id === deal.stageId);
    const target = stages[index + direction];
    if (target) requestMove(deal.id, target.id);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (e.over) requestMove(String(e.active.id), String(e.over.id));
  }

  useHotkeys({
    n: () => canEdit && openSheet({ open: true, dealId: null }),
    c: () => canEdit && openSheet({ open: true, dealId: null }),
  });

  const activeDeal = activeId ? deals.find((d) => d.id === activeId) : undefined;
  const editing = sheet.open && sheet.dealId ? deals.find((d) => d.id === sheet.dealId) ?? null : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("column.count", { count: deals.length })}</p>
        {canEdit && (
          <Button onClick={() => openSheet({ open: true, dealId: null })}>
            <Plus data-icon="inline-start" />
            {t("newDeal")}
          </Button>
        )}
      </div>

      {deals.length === 0 ? (
        <EmptyBoard canEdit={canEdit} onCreate={() => openSheet({ open: true, dealId: null })} />
      ) : (
        <DndContext id="pipeline-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className="-mx-4 flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                deals={deals.filter((d) => d.stageId === stage.id)}
                activeId={activeId}
                canEdit={canEdit}
                onOpen={(deal) => openSheet({ open: true, dealId: deal.id })}
                onMove={moveBy}
              />
            ))}
          </div>
          <DragOverlay>{activeDeal ? <DealCard deal={activeDeal} overlay /> : null}</DragOverlay>
        </DndContext>
      )}

      <LossReasonDialog
        key={pendingLoss?.dealId ?? "none"}
        open={pendingLoss !== null}
        reasons={props.lossReasons}
        onCancel={() => setPendingLoss(null)}
        onConfirm={(reasonId, note) => {
          if (pendingLoss) commitMove(pendingLoss, { reasonId, note });
          setPendingLoss(null);
        }}
      />

      <DealSheet
        slug={slug}
        open={sheet.open && (sheet.dealId === null || editing !== null)}
        onOpenChange={(open) => !open && openSheet({ open: false })}
        deal={editing}
        defaults={{ clientId: sheet.open ? sheet.clientId : undefined, stageId: sheet.open ? sheet.stageId : undefined }}
        stages={stages}
        clients={props.clients}
        sources={props.sources}
        lossReasons={props.lossReasons}
        members={props.members}
        currentMemberId={props.currentMemberId}
        canEdit={canEdit}
      />
    </div>
  );
}

function StageColumn({
  stage,
  deals,
  activeId,
  canEdit,
  onOpen,
  onMove,
}: {
  stage: BoardStage;
  deals: BoardDeal[];
  activeId: string | null;
  canEdit: boolean;
  onOpen: (deal: BoardDeal) => void;
  onMove: (deal: BoardDeal, direction: -1 | 1) => void;
}) {
  const t = useTranslations("pipeline.column");
  const tCrm = useTranslations("crm");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: !canEdit });

  // Abiertas: ponderado (importe × probabilidad). Ganadas y perdidas: total real.
  const weighted = stage.kind === "open";
  const sum = (pick: (d: BoardDeal) => number) =>
    deals.reduce((acc, d) => acc + (weighted ? Math.round((pick(d) * d.probabilityBps) / 10_000) : pick(d)), 0);
  // En la cabecera basta el euro: el ponderado es una estimación.
  const toEuros = (cents: number) => Math.round(cents / 100) * 100;
  const oneOff = toEuros(sum((d) => d.estOneOffCents));
  const mrr = toEuros(sum((d) => d.estMrrCents));

  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border bg-muted/30 transition-colors",
        isOver && "border-primary/60 bg-primary/5",
        stage.kind === "lost" && "bg-muted/15",
      )}
    >
      <header className="border-b px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <span
              className={cn(
                "size-2 rounded-full",
                stage.kind === "open" && "bg-primary",
                stage.kind === "won" && "bg-success",
                stage.kind === "lost" && "bg-destructive",
              )}
            />
            {stage.name}
          </h3>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular">{deals.length}</span>
        </div>
        {(oneOff > 0 || mrr > 0) && (
          <p className="mt-1 text-xs text-muted-foreground tabular">
            {weighted ? t("weighted") : t("total")}: {oneOff > 0 && formatMoney(oneOff, { wholeUnits: true })}
            {oneOff > 0 && mrr > 0 && " · "}
            {mrr > 0 && tCrm("amount.perMonth", { amount: formatMoney(mrr, { wholeUnits: true }) })}
          </p>
        )}
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {deals.map((deal) => (
          <DraggableCard
            key={deal.id}
            deal={deal}
            dragging={deal.id === activeId}
            disabled={!canEdit}
            onOpen={() => onOpen(deal)}
            onMove={(direction) => onMove(deal, direction)}
          />
        ))}
        {deals.length === 0 && (
          <p className="m-auto py-6 text-xs text-muted-foreground/70">{t("empty")}</p>
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  deal,
  dragging,
  disabled,
  onOpen,
  onMove,
}: {
  deal: BoardDeal;
  dragging: boolean;
  disabled: boolean;
  onOpen: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id: deal.id, disabled });
  return (
    <DealCard
      ref={setNodeRef}
      deal={deal}
      dragging={dragging}
      onOpen={onOpen}
      onMove={onMove}
      {...attributes}
      {...listeners}
    />
  );
}

function EmptyBoard({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  const t = useTranslations("pipeline");
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-3xl border bg-card/50 px-8 py-14 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-[0_10px_40px_rgb(46_128_255/0.35)]">
        <SquareKanban className="size-6" />
      </div>
      <h2 className="mt-6 text-2xl font-extrabold heading-tight">{t("emptyTitle")}</h2>
      <p className="mt-3 text-muted-foreground">{t("emptyBody")}</p>
      {canEdit && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <Button onClick={onCreate}>
            <Plus data-icon="inline-start" />
            {t("newDeal")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("emptyShortcut")}</span>
        </div>
      )}
    </div>
  );
}
