"use client";

import { ReceiptEuro } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { loadExpenseSheetContext } from "@/app/[org]/clients/expense-actions";
import { ExpenseSheet } from "@/components/finance/expense-sheet";
import type { FinanceConfig } from "@/components/finance/types";
import { Button } from "@/components/ui/button";

/**
 * «Registrar gasto» en la ficha del cliente: el panel de gastos de Finanzas con el gasto ya
 * asignado a este cliente (un freelance, un dominio, publicidad…). Sus datos se piden al pulsar.
 */
export function RecordExpenseButton({ slug, clientId }: { slug: string; clientId: string }) {
  const t = useTranslations("clients.expenses");
  const [context, setContext] = useState<{ config: FinanceConfig; today: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const openSheet = () =>
    startTransition(async () => {
      if (!context) {
        const result = await loadExpenseSheetContext(slug);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setContext({ config: result.config, today: result.today });
      }
      setOpen(true);
    });

  return (
    <>
      <Button variant="outline" size="sm" onClick={openSheet} disabled={pending}>
        <ReceiptEuro data-icon="inline-start" />
        {t("button")}
      </Button>
      {context && (
        <ExpenseSheet
          slug={slug}
          open={open}
          onOpenChange={setOpen}
          expense={null}
          config={context.config}
          canEdit
          today={context.today}
          initial={{ allocation: "client", clientId }}
        />
      )}
    </>
  );
}
