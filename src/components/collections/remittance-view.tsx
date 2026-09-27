"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Banknote, CircleCheck, Download, Info, RotateCcw, Send, Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  markRemittanceSent,
  returnRemittanceItem,
  revertRemittanceToDraft,
  settleRemittance,
  undoRemittanceReturn,
} from "@/app/[org]/invoices/remittances/actions";
import { RETURN_CODES, type ReturnFormInput, returnFormSchema } from "@/app/[org]/invoices/remittances/schema";
import { useInvoiceFormat } from "@/components/invoices/format";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { FormField } from "@/components/settings/form-field";
import { DetailItem, ReadOnlyNotice, SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet, SheetForm } from "@/components/settings/settings-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatCreditorId } from "@/domain/collections";
import { minCivil } from "@/domain/dates/civil-date";
import { formatIban } from "@/domain/tax-id";
import { cn } from "@/lib/utils";
import { ItemStateBadge, RemittanceStatusBadge, SequenceBadge, useCollectionsValidationMessage } from "./shared";
import type { RemittanceViewData, RemittanceViewItem } from "./types";

type Pending = "sent" | "draft" | "settle" | null;

/**
 * Remesa con su fichero: descargarlo para el banco, marcarla enviada y, cuando el banco abona,
 * cobrarla de una vez. Las devoluciones se registran recibo a recibo (antes o después del abono)
 * y dejan su factura pendiente con el motivo.
 */
export function RemittanceView({
  slug,
  basePath,
  timeZone,
  data,
  canEdit,
}: {
  slug: string;
  basePath: string;
  /** Zona horaria de la org, para las horas de generación y envío. */
  timeZone: string;
  data: RemittanceViewData;
  canEdit: boolean;
}) {
  const t = useTranslations("collections.view");
  const tRoot = useTranslations("collections");
  const { money, date, instant } = useInvoiceFormat();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busy, setBusy] = useState<Pending | "undo">(null);
  const [settledOn, setSettledOn] = useState(minCivil(data.collectionOn, data.today));
  const [returning, setReturning] = useState<RemittanceViewItem | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const pendingItems = data.items.filter((i) => i.state !== "returned");
  const toCollect = pendingItems.reduce((sum, i) => sum + i.amountCents, 0);
  const collectedCents = data.status === "settled" ? data.totals.totalCents - data.totals.returnedCents : 0;
  const fileHref = `${basePath}/invoices/remittances/${data.id}/xml`;
  const canReturn = canEdit && (data.status === "sent" || data.status === "settled");

  const run = (kind: Exclude<Pending, null>, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    setBusy(kind);
    startTransition(async () => {
      const result = await action();
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirm(null);
      toast.success(success);
    });
  };

  const undo = (item: RemittanceViewItem) => {
    setBusy("undo");
    startTransition(async () => {
      const result = await undoRemittanceReturn(slug, item.id);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setUndoing(null);
      toast.success(t("undoneToast", { number: item.invoiceNumber ?? "" }));
    });
  };

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        href={`${basePath}/invoices/remittances`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {tRoot("back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-3xl font-extrabold heading-tight md:text-4xl">{t("title", { date: date(data.collectionOn) })}</h2>
            <RemittanceStatusBadge status={data.status} />
          </div>
          <p className="mt-2 text-muted-foreground">
            {data.issuer.name}
            {data.messageId && <span className="ml-2 font-mono text-xs">{data.messageId}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.hasFile && (
            <Button asChild variant={data.status === "generated" ? "default" : "outline"}>
              <a href={fileHref} download>
                <Download data-icon="inline-start" />
                {t("download")}
              </a>
            </Button>
          )}
          {canEdit && data.status === "generated" && (
            <>
              <Button variant="outline" onClick={() => setConfirm("sent")} disabled={busy !== null}>
                <Send data-icon="inline-start" />
                {t("markSent")}
              </Button>
              <Button variant="ghost" onClick={() => setConfirm("draft")} disabled={busy !== null}>
                <RotateCcw data-icon="inline-start" />
                {t("revert")}
              </Button>
            </>
          )}
          {canEdit && data.status === "sent" && (
            <Button onClick={() => setConfirm("settle")} disabled={busy !== null}>
              <Banknote data-icon="inline-start" />
              {t("settle")}
            </Button>
          )}
        </div>
      </header>

      <div className="mb-6 space-y-3 empty:hidden">
        {!canEdit && <ReadOnlyNotice>{tRoot("readOnly")}</ReadOnlyNotice>}
        {confirm === "sent" && (
          <InlineConfirm
            icon={<Send className="text-primary" />}
            confirmLabel={busy === "sent" ? t("working") : t("markSentAction")}
            onConfirm={() => run("sent", () => markRemittanceSent(slug, data.id), t("sentToast"))}
            onCancel={() => setConfirm(null)}
            pending={busy === "sent"}
          >
            {t("markSentConfirm")}
          </InlineConfirm>
        )}
        {confirm === "draft" && (
          <InlineConfirm
            tone="warning"
            icon={<RotateCcw className="text-warning" />}
            confirmLabel={busy === "draft" ? t("working") : t("revertAction")}
            onConfirm={() => run("draft", () => revertRemittanceToDraft(slug, data.id), t("revertedToast"))}
            onCancel={() => setConfirm(null)}
            pending={busy === "draft"}
          >
            {t("revertConfirm")}
          </InlineConfirm>
        )}
        {confirm === "settle" && (
          <InlineConfirm
            icon={<Banknote className="text-primary" />}
            confirmLabel={busy === "settle" ? t("working") : t("settleAction", { count: pendingItems.length })}
            onConfirm={() =>
              run(
                "settle",
                async () => {
                  const result = await settleRemittance(slug, data.id, { settled_on: settledOn });
                  return result.ok ? { ok: true } : result;
                },
                t("settledToast", { count: pendingItems.length }),
              )
            }
            onCancel={() => setConfirm(null)}
            pending={busy === "settle"}
          >
            <p>{t("settleConfirm", { count: pendingItems.length, amount: money(toCollect) })}</p>
            <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {t("settledOn")}
              <Input
                type="date"
                value={settledOn}
                max={data.today}
                onChange={(e) => setSettledOn(e.target.value)}
                className="h-7 w-40 tabular"
              />
            </label>
          </InlineConfirm>
        )}
        <StatusBanner data={data} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label={t("stats.items")} value={String(data.totals.count)} />
        <Stat label={t("stats.total")} value={money(data.totals.totalCents)} />
        <Stat
          label={t("stats.returned")}
          value={data.totals.returnedCount > 0 ? money(data.totals.returnedCents) : "—"}
          hint={data.totals.returnedCount > 0 ? t("stats.returnedCount", { count: data.totals.returnedCount }) : undefined}
          tone={data.totals.returnedCount > 0 ? "destructive" : undefined}
        />
        <Stat
          label={t("stats.collected")}
          value={data.status === "settled" ? money(collectedCents) : "—"}
          hint={data.settledOn ? t("stats.settledOn", { date: date(data.settledOn) }) : t("stats.notYet")}
          tone={data.status === "settled" ? "success" : undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <SettingsCard title={t("itemsTitle")} description={t("itemsDescription")} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5 text-xs text-muted-foreground">{t("columns.invoice")}</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t("columns.debtor")}</TableHead>
                  <TableHead className="hidden text-xs text-muted-foreground lg:table-cell">{t("columns.reference")}</TableHead>
                  <TableHead className="text-right text-xs text-muted-foreground">{t("columns.amount")}</TableHead>
                  <TableHead className="pr-5 text-xs text-muted-foreground">{t("columns.state")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => (
                  <TableRow key={item.id} className="align-top">
                    <TableCell className="py-2.5 pl-5">
                      <Link href={`${basePath}/invoices/${item.invoiceId}`} className="font-mono font-semibold hover:text-primary">
                        {item.invoiceNumber ?? "—"}
                      </Link>
                      <div className="mt-1">
                        <InvoiceStatusBadge status={item.invoiceStatus} />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-64 py-2.5">
                      <Link href={`${basePath}/clients/${item.clientId}`} className="block truncate font-medium hover:text-primary">
                        {item.clientName}
                      </Link>
                      {item.debtorIban && <p className="truncate font-mono text-[11px] text-muted-foreground">{formatIban(item.debtorIban)}</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {item.mandateReference && <span className="font-mono text-[11px] text-muted-foreground">{item.mandateReference}</span>}
                        {item.sequenceType && <SequenceBadge sequence={item.sequenceType} />}
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-2.5 font-mono text-[11px] text-muted-foreground lg:table-cell">{item.endToEndId}</TableCell>
                    <TableCell className="py-2.5 text-right font-semibold tabular">{money(item.amountCents)}</TableCell>
                    <TableCell className="min-w-44 py-2.5 pr-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <ItemStateBadge state={item.state} />
                        {canReturn && item.state !== "returned" && (
                          <Button variant="ghost" size="xs" onClick={() => setReturning(item)} disabled={busy !== null}>
                            <Undo2 data-icon="inline-start" />
                            {t("return")}
                          </Button>
                        )}
                        {canReturn && item.state === "returned" && undoing !== item.id && (
                          <Button variant="ghost" size="xs" onClick={() => setUndoing(item.id)} disabled={busy !== null}>
                            {t("undo")}
                          </Button>
                        )}
                      </div>
                      {item.state === "returned" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[item.returnedOn ? date(item.returnedOn) : null, item.returnCode, item.returnReason].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {undoing === item.id && (
                        <InlineConfirm
                          className="mt-2"
                          confirmLabel={busy === "undo" ? t("working") : t("undoAction")}
                          onConfirm={() => undo(item)}
                          onCancel={() => setUndoing(null)}
                          pending={busy === "undo"}
                        >
                          {data.status === "settled" ? t("undoConfirmSettled") : t("undoConfirm")}
                        </InlineConfirm>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SettingsCard>

        <aside className="min-w-0 space-y-6">
          <SettingsCard title={t("fileTitle")}>
            <dl className="space-y-3">
              {data.creditor && (
                <>
                  <DetailItem label={t("creditorId")}>
                    <span className="font-mono">{formatCreditorId(data.creditor.creditorId)}</span>
                  </DetailItem>
                  <DetailItem label={t("creditor")}>{data.creditor.name}</DetailItem>
                  <DetailItem label={t("creditorIban")}>
                    <span className="font-mono">{formatIban(data.creditor.iban)}</span>
                  </DetailItem>
                </>
              )}
              <Step label={t("steps.generated")} done={data.generatedAt !== null} value={data.generatedAt ? instant(data.generatedAt, timeZone) : null} />
              <Step label={t("steps.sent")} done={data.sentAt !== null} value={data.sentAt ? instant(data.sentAt, timeZone) : null} />
              <Step label={t("steps.settled")} done={data.settledOn !== null} value={data.settledOn ? date(data.settledOn) : null} />
            </dl>
            {data.notes && <p className="mt-4 border-t pt-3 text-xs whitespace-pre-line text-muted-foreground">{data.notes}</p>}
          </SettingsCard>
        </aside>
      </div>

      {canReturn && (
        <SettingsSheet
          open={returning !== null}
          onOpenChange={(open) => !open && setReturning(null)}
          title={t("returnTitle", { number: returning?.invoiceNumber ?? "" })}
          description={data.status === "settled" ? t("returnDescriptionSettled") : t("returnDescription")}
        >
          {returning && (
            <ReturnForm key={returning.id} slug={slug} item={returning} today={data.today} onDone={() => setReturning(null)} />
          )}
        </SettingsSheet>
      )}
    </div>
  );
}

function StatusBanner({ data }: { data: RemittanceViewData }) {
  const t = useTranslations("collections.view.banner");
  const { date } = useInvoiceFormat();
  const text =
    data.status === "generated"
      ? t("generated")
      : data.status === "sent"
        ? t("sent", { date: date(data.collectionOn) })
        : data.status === "settled" && data.settledOn
          ? t("settled", { date: date(data.settledOn) })
          : null;
  if (!text) return null;
  return (
    <div className="flex items-start gap-3 rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <p>{text}</p>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "destructive" | "success" }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card px-4 py-3.5">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-2xl font-bold tabular heading-tight",
          tone === "destructive" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Step({ label, done, value }: { label: string; done: boolean; value: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <CircleCheck className={cn("mt-0.5 size-4 shrink-0", done ? "text-success" : "text-muted-foreground/40")} />
      <div className="min-w-0">
        <p className={cn("text-sm", done ? "font-semibold" : "text-muted-foreground")}>{label}</p>
        {value && <p className="text-xs text-muted-foreground tabular">{value}</p>}
      </div>
    </div>
  );
}

function ReturnForm({ slug, item, today, onDone }: { slug: string; item: RemittanceViewItem; today: string; onDone: () => void }) {
  const t = useTranslations("collections.view");
  const tCodes = useTranslations("collections.returnCodes");
  const tCommon = useTranslations("common");
  const { money } = useInvoiceFormat();
  const message = useCollectionsValidationMessage();
  const schema = useMemo(() => returnFormSchema(today), [today]);
  const form = useForm<ReturnFormInput>({
    resolver: zodResolver(schema),
    defaultValues: { returned_on: today, code: "", reason: "" },
    mode: "onTouched",
  });
  const { control, register, getValues, formState } = form;
  const { errors, isSubmitting } = formState;

  const submit = form.handleSubmit(async () => {
    const result = await returnRemittanceItem(slug, item.id, getValues());
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t("returnedToast", { number: item.invoiceNumber ?? "" }));
    onDone();
  });

  return (
    <SheetForm
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onDone} disabled={isSubmitting}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" variant="destructive" disabled={isSubmitting}>
            {isSubmitting ? tCommon("saving") : t("returnSubmit")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border bg-muted/30 p-3 text-sm">
          <p className="font-semibold">{item.clientName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{item.invoiceNumber}</span> · {money(item.amountCents)}
            {item.endToEndId && <span className="ml-1 font-mono">· {item.endToEndId}</span>}
          </p>
        </div>
        <FormField id="return-date" label={t("returnedOn")} error={message(errors.returned_on?.message)}>
          <Input id="return-date" type="date" max={today} {...register("returned_on")} className="tabular" aria-invalid={Boolean(errors.returned_on)} />
        </FormField>
        <Controller
          control={control}
          name="code"
          render={({ field }) => (
            <FormField id="return-code" label={t("returnCode")} optional description={t("returnCodeHint")}>
              <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                <SelectTrigger id="return-code" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("returnCodeNone")}</SelectItem>
                  {RETURN_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      <span className="font-mono">{code}</span> · {tCodes(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />
        <FormField id="return-reason" label={t("returnReason")} optional error={message(errors.reason?.message)}>
          <Textarea id="return-reason" {...register("reason")} rows={3} placeholder={t("returnReasonPlaceholder")} />
        </FormField>
      </div>
    </SheetForm>
  );
}
