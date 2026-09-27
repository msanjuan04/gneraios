"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addRebillsToInvoice } from "@/app/[org]/finance/actions";

/**
 * «Añadir a factura» desde cualquier pantalla: repercute al cliente lo que tenga pendiente y
 * avisa con un enlace a su borrador. `busyClientId` es el cliente que se está repercutiendo.
 */
export function useAddRebills(slug: string) {
  const t = useTranslations("finance.rebill");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const add = (clientId: string, clientName: string, expenseIds: string[] | null = null) => {
    setBusy(clientId);
    startTransition(async () => {
      const result = await addRebillsToInvoice(slug, clientId, expenseIds);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const href = `/${slug}/invoices/${result.invoiceId}`;
      toast.success(t(result.appended ? "appendedToast" : "addedToast", { count: result.count, client: clientName }), {
        action: { label: t("viewDraft"), onClick: () => router.push(href) },
      });
    });
  };

  return { add, busyClientId: isPending ? busy : null, isPending };
}
