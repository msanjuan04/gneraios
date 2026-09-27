"use client";

import { Banknote, Receipt, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteClientReceipt } from "@/app/[org]/clients/receipt-actions";
import { useInvoiceFormat } from "@/components/invoices/format";
import { InlineConfirm } from "@/components/invoices/inline-confirm";
import { RecordPaymentButton } from "@/components/invoices/record-payment-sheet";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ClientCollectionItem, ClientCollectionsData } from "@/server/clients/collections";
import { ReceiptForm } from "./receipt-form";

/**
 * «Cobros» en la ficha: todo lo que ha pagado el cliente, de sus facturas y sin factura, con lo
 * cobrado de siempre y del año. Un socio registra cobros (con o sin factura) y corrige o borra
 * los que no tienen factura; los de una factura se tocan en la factura.
 */
export function ClientCollectionsCard({
  slug,
  basePath,
  clientId,
  clientName,
  data,
  projects,
  today,
  canEdit,
}: {
  slug: string;
  basePath: string;
  clientId: string;
  clientName: string;
  data: ClientCollectionsData;
  projects: { id: string; name: string }[];
  today: string;
  canEdit: boolean;
}) {
  const t = useTranslations("clients.collections");
  const tMethod = useTranslations("billing.paymentMethod");
  const { money, date } = useInvoiceFormat();
  const [editing, setEditing] = useState<ClientCollectionItem | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { summary, items } = data;

  const remove = (item: ClientCollectionItem) =>
    startTransition(async () => {
      const result = await deleteClientReceipt(slug, clientId, item.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("deletedToast", { amount: money(item.amountCents) }));
      setDeleting(null);
    });

  return (
    <SettingsCard
      title={t("title")}
      description={
        summary.count === 0
          ? t("emptyShort")
          : t("summary", { total: money(summary.totalCents), year: money(summary.thisYearCents), count: summary.count })
      }
      actions={canEdit ? <RecordPaymentButton slug={slug} clientId={clientId} clientName={clientName} /> : undefined}
      bodyClassName={items.length > 0 ? "p-0" : undefined}
      footer={
        summary.count > 0 ? (
          <>
            <span className="mr-auto text-xs text-muted-foreground tabular">
              {summary.receiptsCents !== 0 && summary.invoicePaymentsCents !== 0
                ? t("split", { receipts: money(summary.receiptsCents), invoices: money(summary.invoicePaymentsCents) })
                : summary.lastOn
                  ? t("last", { date: date(summary.lastOn) })
                  : null}
            </span>
            <Button asChild variant="ghost" size="sm">
              <Link href={`${basePath}/invoices/history?client=${clientId}`}>{t("history", { count: summary.count })}</Link>
            </Button>
          </>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <div className="text-center">
          <Banknote className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const isReceipt = item.kind === "receipt";
            const label = isReceipt ? item.concept : t("invoicePayment", { number: item.invoiceNumber ?? "—" });
            const meta = [date(item.on), tMethod(item.method), item.projectName, item.reference].filter(Boolean).join(" · ");
            const body = (
              <>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className={cn("truncate font-semibold", !isReceipt && "font-mono")}>{label}</span>
                    {!isReceipt && <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px]">{t("fromInvoice")}</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground tabular">{meta}</p>
                </div>
                <p className={cn("shrink-0 font-semibold tabular", item.amountCents < 0 && "text-destructive")}>{money(item.amountCents)}</p>
              </>
            );
            return (
              <li key={`${item.kind}-${item.id}`} className="group">
                <div className="flex items-center gap-2 px-5 py-2.5">
                  {isReceipt ? (
                    canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing(item)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
                    )
                  ) : (
                    <Link
                      href={`${basePath}/invoices/${item.invoiceId}`}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {body}
                    </Link>
                  )}
                  {isReceipt && canEdit && deleting !== item.id && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("delete")}
                          onClick={() => setDeleting(item.id)}
                          className="opacity-100 transition-opacity hover:text-destructive md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
                        >
                          <Trash2 />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("delete")}</TooltipContent>
                    </Tooltip>
                  )}
                  {!isReceipt && <Receipt aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
                </div>
                {deleting === item.id && (
                  <InlineConfirm
                    tone="destructive"
                    className="mx-5 mb-2.5"
                    confirmLabel={t("deleteConfirmAction")}
                    onConfirm={() => remove(item)}
                    onCancel={() => setDeleting(null)}
                    pending={pending}
                  >
                    {t("deleteConfirm", { amount: money(item.amountCents), date: date(item.on) })}
                  </InlineConfirm>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <SettingsSheet
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          title={t("editTitle")}
          description={t("editDescription", { client: clientName })}
        >
          {editing && (
            <ReceiptForm
              slug={slug}
              clientId={clientId}
              projects={projects}
              today={today}
              initial={{
                id: editing.id,
                on: editing.on,
                amountCents: editing.amountCents,
                method: editing.method,
                concept: editing.concept,
                reference: editing.reference,
                projectId: editing.projectId,
                notes: editing.notes,
              }}
              onDone={() => setEditing(null)}
            />
          )}
        </SettingsSheet>
      )}
    </SettingsCard>
  );
}
