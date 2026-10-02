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
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { loadStageDeals, moveDeal } from "@/app/[org]/pipeline/actions";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import { BOARD_PAGE_SIZE, type BoardColumn, type BoardDeal, type BoardMember, type BoardOption, type BoardStage } from "./board-types";
import { DealCard } from "./deal-card";
import { DealSheet } from "./deal-sheet";
import { LossReasonDialog } from "./loss-reason-dialog";


type Props = {
  slug: string;
  stages: BoardStage[];
  /** Cada columna llega con su primera página y su total; el resto se pide con «Ver más». */
  columns: BoardColumn[];
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
  // Páginas pedidas con «Ver más», por etapa. Lo que llega del servidor manda sobre lo ya cargado.
  const [more, setMore] = useState<Record<string, BoardDeal[]>>({});
  const [loadingStage, setLoadingStage] = useState<string | null>(null);
  const baseDeals = useMemo(() => {
    const byId = new Map<string, BoardDeal>();
    for (const list of Object.values(more)) for (const deal of list) byId.set(deal.id, deal);
    for (const column of props.columns) for (const deal of column.deals) byId.set(deal.id, deal);
    return [...byId.values()];
  }, [props.columns, more]);
  const [deals, applyMove] = useOptimistic(baseDeals, (state, move: Move) =>
    state.map((d) => (d.id === move.dealId ? { ...d, stageId: move.stageId, daysInStage: 0 } : d)),
  );
  // Total real de cada etapa: el del servidor más lo que ha entrado o salido moviendo tarjetas.
  const totals = new Map(props.columns.map((column) => [column.stageId, column.total]));
  const countFor = (stageId: string) => {
    const base = baseDeals.filter((d) => d.stageId === stageId).length;
    const current = deals.filter((d) => d.stageId === stageId).length;
    return (totals.get(stageId) ?? base) + (current - base);
  };
  const totalAll = props.columns.reduce((sum, column) => sum + column.total, 0);

  function loadMore(stageId: string) {
    const offset = baseDeals.filter((d) => d.stageId === stageId).length;
    setLoadingStage(stageId);
    startTransition(async () => {
      const result = await loadStageDeals(slug, stageId, offset);
      setLoadingStage(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setMore((current) => ({ ...current, [stageId]: [...(current[stageId] ?? []), ...result.deals] }));
    });
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingLoss, setPendingLoss] = useState<Move | null>(null);
  // El deal recién guardado: se salta a su columna y se resalta un momento.
  const [highlight, setHighlight] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Solo en horizontal, dentro del tablero: la página no se mueve.
  const scrollToStage = (stageId: string) => {
    const board = boardRef.current;
    const column = board?.querySelector<HTMLElement>(`[data-stage-id="${stageId}"]`);
    if (!board || !column) return;
    const padding = Number.parseFloat(getComputedStyle(board).paddingLeft) || 0;
    board.scrollTo({ left: column.offsetLeft - board.offsetLeft - padding, behavior: "smooth" });
  };

  useEffect(() => {
    if (!highlight) return;
    const deal = baseDeals.find((d) => d.id === highlight);
    if (!deal) return; // aún no ha llegado del servidor
    scrollToStage(deal.stageId);
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [highlight, baseDeals]);
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
        <p className="text-sm text-muted-foreground">{t("column.count", { count: totalAll })}</p>
        {canEdit && (
          <Button onClick={() => openSheet({ open: true, dealId: null })}>
            <Plus data-icon="inline-start" />
            {t("newDeal")}
          </Button>
        )}
      </div>

      {totalAll === 0 && deals.length === 0 ? (
        <EmptyBoard canEdit={canEdit} onCreate={() => openSheet({ open: true, dealId: null })} />
      ) : (
        <DndContext id="pipeline-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          {/* Todas las etapas de un vistazo: en pantallas estrechas no caben y así se salta a cualquiera. */}
          <nav aria-label={t("stagesNav")} className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 md:-mx-8 md:px-8">
            {stages.map((stage) => {
              const count = countFor(stage.id);
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => scrollToStage(stage.id)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:text-foreground",
                    count > 0 ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full",
                      stage.kind === "open" && "bg-primary",
                      stage.kind === "won" && "bg-success",
                      stage.kind === "lost" && "bg-destructive",
                    )}
                  />
                  {stage.name}
                  <span className="tabular opacity-70">{count}</span>
                </button>
              );
            })}
          </nav>
          <div ref={boardRef} className="-mx-4 flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:snap-none md:px-8">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                slug={slug}
                stage={stage}
                deals={deals.filter((d) => d.stageId === stage.id)}
                total={countFor(stage.id)}
                loading={loadingStage === stage.id}
                activeId={activeId}
                highlightId={highlight}
                canEdit={canEdit}
                onOpen={(deal) => openSheet({ open: true, dealId: deal.id })}
                onMove={moveBy}
                onLoadMore={() => loadMore(stage.id)}
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
        onSaved={(dealId) => setHighlight(dealId)}
      />
    </div>
  );
}

function StageColumn({
  slug,
  stage,
  deals,
  total,
  loading,
  activeId,
  highlightId,
  canEdit,
  onOpen,
  onMove,
  onLoadMore,
}: {
  slug: string;
  stage: BoardStage;
  /** Las tarjetas ya cargadas de la etapa. */
  deals: BoardDeal[];
  /** Cuántos deals hay en la etapa en total (los que faltan se piden con «Ver más»). */
  total: number;
  loading: boolean;
  activeId: string | null;
  highlightId: string | null;
  canEdit: boolean;
  onOpen: (deal: BoardDeal) => void;
  onMove: (deal: BoardDeal, direction: -1 | 1) => void;
  onLoadMore: () => void;
}) {
  const t = useTranslations("pipeline.column");
  const tCrm = useTranslations("crm");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: !canEdit });

  // Lo que falta por pedir al servidor. La cabecera y el ponderado hablan de lo cargado.
  const hidden = Math.max(0, total - deals.length);

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
      data-stage-id={stage.id}
      className={cn(
        "flex w-72 shrink-0 snap-start flex-col rounded-2xl border bg-muted/30 transition-colors",
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
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular">{total}</span>
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
            clientHref={`/${slug}/clients/${deal.clientId}`}
            highlighted={deal.id === highlightId}
            dragging={deal.id === activeId}
            disabled={!canEdit}
            onOpen={() => onOpen(deal)}
            onMove={(direction) => onMove(deal, direction)}
          />
        ))}
        {deals.length === 0 && (
          <p className="m-auto py-6 text-xs text-muted-foreground/70">{t("empty")}</p>
        )}
        {hidden > 0 && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="mt-1 min-h-9 rounded-lg border border-dashed text-xs font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            {loading ? t("loading") : t("showMore", { count: Math.min(hidden, BOARD_PAGE_SIZE), hidden })}
          </button>
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  deal,
  clientHref,
  highlighted,
  dragging,
  disabled,
  onOpen,
  onMove,
}: {
  deal: BoardDeal;
  clientHref: string;
  highlighted: boolean;
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
      data-deal-id={deal.id}
      clientHref={clientHref}
      highlighted={highlighted}
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
