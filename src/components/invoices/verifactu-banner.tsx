"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { verifactuCountdown } from "@/domain/fiscal/verifactu";
import { cn } from "@/lib/utils";
import { useInvoiceFormat } from "./format";

/**
 * Cuenta atrás de Verifactu del emisor (ARCHITECTURE §7.6): aviso desde 90 días antes y
 * bloqueo desde la fecha, mientras emita con el proveedor interno.
 */
export function VerifactuBanner({
  issuer,
  today,
  className,
}: {
  issuer: { name: string; verifactuFrom: string; fiscalProvider: string } | null;
  today: string;
  className?: string;
}) {
  const t = useTranslations("invoices.verifactu");
  const { dateLong } = useInvoiceFormat();
  if (!issuer || issuer.fiscalProvider !== "internal") return null;
  const countdown = verifactuCountdown(issuer.verifactuFrom, today);
  if (countdown.state === "far") return null;
  const required = countdown.state === "required";
  const Icon = required ? ShieldAlert : ShieldCheck;
  const values = { issuer: issuer.name, date: dateLong(issuer.verifactuFrom), days: countdown.daysLeft };

  return (
    <div
      role={required ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm",
        required ? "border-destructive/30 bg-destructive/10" : "border-warning/30 bg-warning/10",
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", required ? "text-destructive" : "text-warning")} />
      <div className="min-w-0">
        <p className="font-semibold">{t(required ? "requiredTitle" : "soonTitle", values)}</p>
        <p className="mt-0.5 text-muted-foreground">{t(required ? "required" : "soon", values)}</p>
      </div>
    </div>
  );
}

/** ¿Este emisor ya no puede emitir desde GNERAI OS hoy? */
export function verifactuBlocks(issuer: { verifactuFrom: string; fiscalProvider: string } | null, today: string): boolean {
  return Boolean(issuer && issuer.fiscalProvider === "internal" && verifactuCountdown(issuer.verifactuFrom, today).state === "required");
}
