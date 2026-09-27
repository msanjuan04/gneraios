"use client";

import { AlertTriangle, Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { CreditorIssue, ItemIssue, RemittanceIssue, RemittanceItemState, RemittanceStatus, RemittanceWarning, SequenceType } from "./types";

/** Traduce un error de Zod de los formularios de cobros: primero `collections.validation.*`, luego `validation.*`. */
export function useCollectionsValidationMessage() {
  const t = useTranslations("collections.validation");
  const tCommon = useTranslations("validation");
  return (message: string | undefined): string | undefined => {
    if (!message) return undefined;
    if (t.has(message)) return t(message);
    return tCommon.has(message) ? tCommon(message) : tCommon("invalid");
  };
}

const STATUS_STYLES: Record<RemittanceStatus, string> = {
  draft: "border-border bg-transparent text-foreground",
  generated: "bg-primary/15 text-primary",
  sent: "bg-warning/15 text-warning",
  settled: "bg-success/15 text-success",
};

/** Estado de una remesa: borrador, generada, enviada al banco o cobrada. */
export function RemittanceStatusBadge({ status, className }: { status: RemittanceStatus; className?: string }) {
  const t = useTranslations("collections.status");
  return <Badge className={cn(STATUS_STYLES[status], className)}>{t(status)}</Badge>;
}

const STATE_STYLES: Record<RemittanceItemState, string> = {
  pending: "bg-secondary text-secondary-foreground",
  collected: "bg-success/15 text-success",
  returned: "bg-destructive/15 text-destructive",
};

/** Estado derivado de un recibo: pendiente, cobrado o devuelto. */
export function ItemStateBadge({ state, className }: { state: RemittanceItemState; className?: string }) {
  const t = useTranslations("collections.itemState");
  return <Badge className={cn(STATE_STYLES[state], className)}>{t(state)}</Badge>;
}

/** FRST (primer adeudo del mandato) o RCUR (recurrente), con su explicación. */
export function SequenceBadge({ sequence }: { sequence: SequenceType }) {
  const t = useTranslations("collections.sequence");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant="outline" className="cursor-help font-mono text-[10px] text-muted-foreground">
            {sequence}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{t(sequence)}</TooltipContent>
    </Tooltip>
  );
}

/** Copia un texto al portapapeles, con confirmación en el propio botón. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const t = useTranslations("collections.copy");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("failed"));
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" onClick={copy} aria-label={label} className={className}>
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? t("done") : label}</TooltipContent>
    </Tooltip>
  );
}

type AnyIssue = CreditorIssue | RemittanceIssue | RemittanceWarning | ItemIssue;

/** Lista de avisos traducidos (`collections.issues.*`), en rojo si impiden generar. */
export function IssueList({
  issues,
  tone = "destructive",
  className,
  children,
}: {
  issues: readonly AnyIssue[];
  tone?: "destructive" | "warning";
  className?: string;
  children?: ReactNode;
}) {
  const t = useTranslations("collections.issues");
  if (issues.length === 0 && !children) return null;
  return (
    <ul className={cn("space-y-1 text-xs", tone === "destructive" ? "text-destructive" : "text-warning", className)}>
      {issues.map((issue) => (
        <li key={issue} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>{t(issue)}</span>
        </li>
      ))}
      {children}
    </ul>
  );
}
