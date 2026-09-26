"use client";

import { ArrowLeft, ArrowRightLeft, Building2, FileSignature, Landmark, Pencil, Plus, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { signContract } from "@/app/[org]/contracts/actions";
import { type BillingType, isCivilDate } from "@/app/[org]/contracts/schema";
import { useShell } from "@/components/app-shell/shell-context";
import { useHotkeys } from "@/components/app-shell/use-hotkeys";
import { DetailItem, ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { useContractFormat } from "./format";
import { InvoicesCard } from "./invoices-card";
import { type LineActionKind, LineActionSheet } from "./line-action-sheet";
import { LineSheet, type LineSheetMode } from "./line-sheet";
import { type LineAction, LinesCard } from "./lines-card";
import { MilestonesCard, MilestonesSheet } from "./milestones-card";
import { PendingCard } from "./pending-card";
import { ContractStatusBadge } from "./status-badges";
import { IssuerSheet, TermsSheet } from "./terms-sheet";
import type { ContractDetailData } from "./types";

const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
// Ventana de tinykeys para las secuencias "g …".
const SEQUENCE_MS = 1000;

type LineSheetState = { open: boolean; mode: LineSheetMode; lineId: string | null; type: BillingType };
type ActionSheetState = { open: boolean; kind: LineActionKind; lineId: string | null };

/**
 * Ficha de un contrato: cabecera con cliente, firma y emisor; KPIs; líneas, hitos y
 * pendiente de facturar; condiciones y facturas. Todo se edita en paneles laterales y las
 * confirmaciones van en línea: nunca un modal encima de otro.
 */
export function ContractDetail({ data }: { data: ContractDetailData }) {
  const t = useTranslations("contracts.detail");
  const { commandOpen, shortcutsOpen } = useShell();
  const { contract, canEdit } = data;

  // La línea se conserva al cerrar para que el título no cambie durante la animación de salida.
  const [lineSheet, setLineSheet] = useState<LineSheetState>({ open: false, mode: "create", lineId: null, type: "monthly" });
  const [actionSheet, setActionSheet] = useState<ActionSheetState>({ open: false, kind: "pause", lineId: null });
  const [termsOpen, setTermsOpen] = useState(false);
  const [issuerOpen, setIssuerOpen] = useState(false);
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const anySheet = lineSheet.open || actionSheet.open || termsOpen || issuerOpen || milestonesOpen;

  const lineById = (id: string | null) => (id ? (data.lines.find((l) => l.id === id) ?? null) : null);
  const openNewLine = () => setLineSheet({ open: true, mode: "create", lineId: null, type: "monthly" });
  const onLineAction = (action: LineAction, line: { id: string }) => {
    if (action === "edit" || action === "version") setLineSheet({ open: true, mode: action, lineId: line.id, type: "monthly" });
    else setActionSheet({ open: true, kind: action, lineId: line.id });
  };

  // «C» añade una línea (crear en contexto), salvo con un panel o un menú abiertos, o si es
  // la «c» de «g c» (ir a clientes).
  const lastG = useRef(Number.NEGATIVE_INFINITY);
  useHotkeys({
    g: (event) => {
      lastG.current = event.timeStamp;
    },
    c: (event) => {
      if (!canEdit || anySheet || commandOpen || shortcutsOpen || event.timeStamp - lastG.current < SEQUENCE_MS) return;
      if (event.target instanceof Element && event.target.closest(OVERLAY)) return;
      event.preventDefault();
      openNewLine();
    },
  });

  const hasOneOff = data.lines.some((l) => l.billingType === "one_off");

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={`${data.basePath}/contracts`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>

      <Header data={data} onAddLine={openNewLine} onEditTerms={() => setTermsOpen(true)} onChangeIssuer={() => setIssuerOpen(true)} />
      {!data.canEdit && (
        <ReadOnlyNotice className="mb-6">{contract.archived ? t("archivedReadOnly") : t("readOnly")}</ReadOnlyNotice>
      )}

      <Kpis data={data} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <LinesCard data={data} onAction={onLineAction} onAdd={openNewLine} />
          {(hasOneOff || data.milestones.length > 0) && <MilestonesCard data={data} onEdit={() => setMilestonesOpen(true)} />}
          <PendingCard data={data} />
        </div>
        <div className="min-w-0 space-y-6">
          <TermsCard data={data} onEdit={() => setTermsOpen(true)} onChangeIssuer={() => setIssuerOpen(true)} />
          <InvoicesCard data={data} />
        </div>
      </div>

      {canEdit && (
        <>
          <LineSheet
            slug={data.slug}
            contractId={contract.id}
            open={lineSheet.open}
            onOpenChange={(open) => setLineSheet((s) => ({ ...s, open }))}
            mode={lineSheet.mode}
            line={lineById(lineSheet.lineId)}
            createType={lineSheet.type}
            options={data.options}
            today={data.today}
            onModeChange={(mode) => setLineSheet((s) => ({ ...s, mode }))}
          />
          <LineActionSheet
            slug={data.slug}
            open={actionSheet.open}
            onOpenChange={(open) => setActionSheet((s) => ({ ...s, open }))}
            kind={actionSheet.kind}
            line={lineById(actionSheet.lineId)}
            today={data.today}
            signed={contract.signedOn !== null}
          />
          <TermsSheet data={data} open={termsOpen} onOpenChange={setTermsOpen} />
          <IssuerSheet data={data} open={issuerOpen} onOpenChange={setIssuerOpen} />
          <MilestonesSheet data={data} open={milestonesOpen} onOpenChange={setMilestonesOpen} />
        </>
      )}
    </div>
  );
}

function Header({
  data,
  onAddLine,
  onEditTerms,
  onChangeIssuer,
}: {
  data: ContractDetailData;
  onAddLine: () => void;
  onEditTerms: () => void;
  onChangeIssuer: () => void;
}) {
  const t = useTranslations("contracts.detail");
  const fmt = useContractFormat();
  const { contract, canEdit } = data;

  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="min-w-0 text-3xl font-extrabold break-words heading-tight md:text-4xl">{contract.title}</h2>
          <ContractStatusBadge status={contract.status} />
          {contract.archived && (
            <Badge variant="outline" className="text-muted-foreground">
              {t("archivedBadge")}
            </Badge>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <Link
            href={`${data.basePath}/clients/${contract.clientId}`}
            className="inline-flex items-center gap-1.5 font-semibold text-foreground hover:text-primary"
          >
            <Building2 className="size-3.5" />
            {contract.clientName}
          </Link>
          <span className="inline-flex items-center gap-1.5">
            <FileSignature className="size-3.5" />
            {contract.signedOn ? t("signedOn", { date: fmt.date(contract.signedOn, "long") }) : t("unsigned")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Landmark className="size-3.5" />
            {data.issuer ? t("issuedBy", { name: data.issuer.name }) : t("noIssuer")}
            {canEdit && (
              <button type="button" onClick={onChangeIssuer} className="ml-1 text-xs font-semibold text-primary hover:underline">
                {t("changeIssuer")}
              </button>
            )}
          </span>
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {!contract.signedOn && <SignInline data={data} />}
          <Button variant={contract.signedOn ? "default" : "outline"} onClick={onAddLine}>
            <Plus data-icon="inline-start" />
            {t("addLine")}
            <Kbd className={contract.signedOn ? "ml-1 hidden bg-primary-foreground/15 text-primary-foreground sm:inline-flex" : "ml-1 hidden sm:inline-flex"}>C</Kbd>
          </Button>
          <Button variant="outline" onClick={onEditTerms}>
            <Pencil data-icon="inline-start" />
            {t("editTerms")}
          </Button>
        </div>
      )}
    </header>
  );
}

/** «Firmar contrato» en línea: la fecha (hoy por defecto) y confirmar, sin abrir ningún modal. */
function SignInline({ data }: { data: ContractDetailData }) {
  const t = useTranslations("contracts.sign");
  const fmt = useContractFormat();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(data.today);
  const [pending, startTransition] = useTransition();
  const valid = isCivilDate(date) && date <= data.today;

  const sign = () =>
    startTransition(async () => {
      const result = await signContract(data.slug, data.contract.id, { signed_on: date });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("toast", { date: fmt.date(date) }), { description: t("toastBody") });
      setEditing(false);
    });

  if (!editing) {
    return (
      <Button onClick={() => setEditing(true)}>
        <FileSignature data-icon="inline-start" />
        {t("action")}
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-1.5 rounded-full border bg-card p-1 pl-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) sign();
      }}
    >
      <label htmlFor="sign-date" className="text-xs font-semibold text-muted-foreground">
        {t("date")}
      </label>
      <Input
        id="sign-date"
        type="date"
        value={date}
        max={data.today}
        onChange={(e) => setDate(e.target.value)}
        className="h-7 w-36"
        autoFocus
      />
      <Button type="submit" size="sm" disabled={!valid || pending}>
        {pending ? t("signing") : t("confirm")}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("cancel")} onClick={() => setEditing(false)} disabled={pending}>
        <X />
      </Button>
    </form>
  );
}

function Stat({ label, value, hint, muted }: { label: ReactNode; value: ReactNode; hint: ReactNode; muted?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <dt className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={muted ? "mt-1 truncate text-xl font-bold text-muted-foreground tabular heading-tight" : "mt-1 truncate text-xl font-bold tabular heading-tight"}>
        {value}
      </dd>
      <dd className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

/** MRR y ARR (recurrente), lo puntual, lo facturado y lo pendiente: nunca un total que los mezcle. */
function Kpis({ data }: { data: ContractDetailData }) {
  const t = useTranslations("contracts.kpis");
  const fmt = useContractFormat();
  const { kpis } = data;
  const signed = data.contract.signedOn !== null;
  const upcoming = kpis.mrrCents === 0 ? kpis.upcomingMrr : null;
  const mrr = upcoming ? upcoming.cents : kpis.mrrCents;

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat
        label={t("mrr")}
        value={fmt.perCycle(mrr, "monthly", true)}
        muted={!signed || upcoming !== null}
        hint={
          !signed
            ? t("mrrUnsigned")
            : upcoming
              ? t("mrrFrom", { date: fmt.date(upcoming.from) })
              : kpis.mrrCents > 0
                ? t("mrrHint")
                : t("mrrNone")
        }
      />
      <Stat
        label={t("arr")}
        value={fmt.whole(mrr * 12)}
        muted={!signed || upcoming !== null}
        hint={t("arrHint")}
      />
      <Stat
        label={t("oneOff")}
        value={kpis.oneOffCents > 0 ? fmt.whole(kpis.oneOffCents) : "—"}
        hint={
          kpis.oneOffCents === 0
            ? t("oneOffNone")
            : data.milestones.length === 0
              ? t("oneOffNoMilestones")
              : kpis.oneOffPendingCents > 0
                ? t("oneOffPending", { amount: fmt.whole(kpis.oneOffPendingCents) })
                : t("oneOffDone")
        }
      />
      <Stat
        label={t("billed")}
        value={fmt.whole(kpis.billedCents)}
        hint={kpis.issuedInvoices > 0 ? t("billedHint", { count: kpis.issuedInvoices }) : t("billedNone")}
      />
      <Stat
        label={t("pending")}
        value={fmt.whole(kpis.pendingCents)}
        hint={
          kpis.draftedCents > 0
            ? t("pendingDrafted", { amount: fmt.whole(kpis.draftedCents) })
            : kpis.pendingCents > 0
              ? t("pendingHint")
              : t("pendingNone")
        }
      />
    </dl>
  );
}

/** Condiciones de cobro, emisor y notas. */
function TermsCard({ data, onEdit, onChangeIssuer }: { data: ContractDetailData; onEdit: () => void; onChangeIssuer: () => void }) {
  const t = useTranslations("contracts.terms");
  const tMethod = useTranslations("billing.paymentMethod");
  const tGrouping = useTranslations("billing.invoiceGrouping");
  const tCommon = useTranslations("common");
  const fmt = useContractFormat();
  const { contract, paymentTerms, canEdit } = data;
  const scheduled = data.issuerHistory.filter((r) => r.scheduled);

  return (
    <SettingsCard
      title={t("cardTitle")}
      actions={
        canEdit ? (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil data-icon="inline-start" />
            {tCommon("edit")}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <DetailItem label={t("issuer")} className="col-span-2">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{data.issuer?.name ?? "—"}</span>
            {canEdit && (
              <button type="button" onClick={onChangeIssuer} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <ArrowRightLeft className="size-3" />
                {t("changeIssuer")}
              </button>
            )}
          </span>
          {scheduled.map((row) => (
            <span key={row.id} className="mt-0.5 block text-xs text-muted-foreground">
              {t("issuerScheduled", { name: row.issuerName, date: fmt.date(row.validFrom) })}
            </span>
          ))}
        </DetailItem>
        <DetailItem label={t("paymentTerms")}>
          <span className="tabular">{t("days", { days: paymentTerms.days })}</span>
          {paymentTerms.source !== "contract" && (
            <span className="block text-xs text-muted-foreground">{t(`termsSource.${paymentTerms.source}`)}</span>
          )}
        </DetailItem>
        <DetailItem label={t("paymentMethod")}>{tMethod(contract.paymentMethod)}</DetailItem>
        <DetailItem label={t("grouping")} className="col-span-2">
          {tGrouping(contract.invoiceGrouping)}
        </DetailItem>
        <DetailItem label={t("signed")} className="col-span-2">
          {contract.signedOn ? fmt.date(contract.signedOn, "long") : <span className="text-muted-foreground">{t("unsigned")}</span>}
        </DetailItem>
        {contract.notes && (
          <DetailItem label={t("notes")} className="col-span-2 whitespace-pre-line">
            {contract.notes}
          </DetailItem>
        )}
      </dl>
    </SettingsCard>
  );
}
