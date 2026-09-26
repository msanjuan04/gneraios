"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { BoardOption } from "./board-types";

/** Motivo obligatorio al pasar un deal a "Perdido" (la base de datos también lo exige). */
export function LossReasonDialog({
  open,
  reasons,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  reasons: BoardOption[];
  onCancel: () => void;
  onConfirm: (reasonId: string, note: string) => void;
}) {
  const t = useTranslations("pipeline.loss");
  const tCommon = useTranslations("common");
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>{t("reason")}</FieldLabel>
          <Select value={reasonId} onValueChange={setReasonId}>
            <SelectTrigger className="w-full" autoFocus>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {reasons.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="loss-note">{t("note")}</FieldLabel>
          <Textarea id="loss-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button variant="destructive" disabled={!reasonId} onClick={() => onConfirm(reasonId, note)}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
