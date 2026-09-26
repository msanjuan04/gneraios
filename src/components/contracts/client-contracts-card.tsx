"use client";

import { FileSignature, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useContractFormat } from "./format";
import { MrrValue } from "./mrr-value";
import { ContractStatusBadge } from "./status-badges";
import type { ClientContractItem } from "./types";

type Props = {
  /** `/{slug}`: prefijo de las rutas de la org. */
  basePath: string;
  clientId: string;
  /** De `getClientContracts(orgId, clientId)` (src/server/contracts/queries.ts). */
  contracts: ClientContractItem[];
  /** Socio u owner (y cliente sin archivar): puede crear contratos. */
  canEdit: boolean;
};

/**
 * Contratos del cliente en su ficha 360: estado, MRR, lo puntual y la próxima facturación.
 * El MRR del resumen solo suma los firmados: lo que no está firmado no factura.
 */
export function ClientContractsCard({ basePath, clientId, contracts, canEdit }: Props) {
  const t = useTranslations("contracts.client");
  const fmt = useContractFormat();
  const newHref = `${basePath}/contracts?new=1&client=${clientId}`;
  const signedMrr = contracts.filter((c) => c.signedOn).reduce((sum, c) => sum + c.mrrCents, 0);
  const live = contracts.filter((c) => c.status === "active" || c.status === "paused" || c.status === "scheduled").length;

  const summary =
    contracts.length === 0
      ? undefined
      : [t("live", { count: live }), signedMrr > 0 ? t("mrr", { amount: fmt.perCycle(signedMrr, "monthly", true) }) : null]
          .filter(Boolean)
          .join(" · ");

  return (
    <SettingsCard
      title={t("title")}
      description={summary}
      actions={
        canEdit ? (
          <Button asChild variant="outline" size="sm">
            <Link href={newHref}>
              <Plus data-icon="inline-start" />
              {t("new")}
            </Link>
          </Button>
        ) : undefined
      }
      bodyClassName={contracts.length > 0 ? "p-0" : undefined}
    >
      {contracts.length === 0 ? (
        <div className="text-center">
          <FileSignature className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-muted-foreground">{t("empty")}</p>
          {canEdit && (
            <Button asChild variant="secondary" size="sm" className="mt-3">
              <Link href={newHref}>
                <Plus data-icon="inline-start" />
                {t("new")}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="divide-y">
          {contracts.map((contract) => {
            const ended = contract.status === "ended";
            return (
              <li key={contract.id}>
                <Link
                  href={`${basePath}/contracts/${contract.id}`}
                  className="group flex items-center gap-3 px-5 py-3 transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate font-semibold group-hover:text-primary", ended && "text-muted-foreground")}>
                      {contract.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <ContractStatusBadge status={contract.status} />
                      {contract.nextBillingOn && (
                        <span className="tabular">{t("nextBilling", { date: fmt.date(contract.nextBillingOn) })}</span>
                      )}
                      {!contract.signedOn && <span>{t("unsigned")}</span>}
                    </div>
                  </div>
                  <div className={cn("shrink-0 text-right font-semibold tabular", ended && "text-muted-foreground")}>
                    {(contract.mrrCents > 0 || contract.upcomingMrr) && (
                      <p className="text-primary">
                        <MrrValue item={contract} />
                      </p>
                    )}
                    {contract.oneOffCents > 0 && <p title={t("oneOff")}>{fmt.whole(contract.oneOffCents)}</p>}
                    {contract.mrrCents === 0 && !contract.upcomingMrr && contract.oneOffCents === 0 && (
                      <p className="text-muted-foreground">—</p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}
