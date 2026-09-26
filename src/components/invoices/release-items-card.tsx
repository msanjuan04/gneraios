"use client";

import { HandCoins, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { releaseInvoiceItems } from "@/app/[org]/invoices/actions";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineConfirm } from "./inline-confirm";

/**
 * Tras anular una factura con una rectificativa, sus conceptos del contrato (periodos, usos,
 * hitos) siguen asociados a ella. Aquí se decide: volver a facturarlos o condonarlos.
 */
export function ReleaseItemsCard({ slug, invoiceId, count }: { slug: string; invoiceId: string; count: number }) {
  const t = useTranslations("invoices.release");
  const [choice, setChoice] = useState<"rebill" | "waive" | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const confirm = () =>
    startTransition(async () => {
      const waive = choice === "waive";
      const result = await releaseInvoiceItems(slug, invoiceId, { waive, reason });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t(waive ? "waivedToast" : "rebilledToast", { count: result.count }));
      setChoice(null);
    });

  return (
    <SettingsCard title={t("title")} className="border-warning/30">
      <p className="text-muted-foreground">{t("body", { count })}</p>
      {choice === null ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setChoice("rebill")} title={t("rebillHint")}>
            <RotateCcw data-icon="inline-start" />
            {t("rebill")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setChoice("waive")} title={t("waiveHint")}>
            <HandCoins data-icon="inline-start" />
            {t("waive")}
          </Button>
        </div>
      ) : (
        <InlineConfirm
          className="mt-4"
          tone={choice === "waive" ? "destructive" : "default"}
          confirmLabel={t(choice === "waive" ? "waive" : "rebill")}
          onConfirm={confirm}
          onCancel={() => setChoice(null)}
          pending={pending}
        >
          <p>{t(choice === "waive" ? "confirmWaive" : "confirmRebill", { count })}</p>
          {choice === "waive" && (
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder={t("reasonPlaceholder")}
              aria-label={t("reasonPlaceholder")}
              className="mt-2 bg-background"
            />
          )}
        </InlineConfirm>
      )}
    </SettingsCard>
  );
}
