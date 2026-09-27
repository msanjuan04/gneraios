"use client";

import { FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Justificante de un gasto (PDF o foto). Se sube a la ruta del servidor, que comprueba que el
 * gasto es de la org y que quien sube es socio antes de guardarlo en Storage.
 */
export function AttachmentField({ expenseId, hasAttachment, canEdit }: { expenseId: string; hasAttachment: boolean; canEdit: boolean }) {
  const t = useTranslations("finance.attachment");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const href = `/api/finance/expenses/${expenseId}/attachment`;

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error(t("tooLarge"));
      return;
    }
    setBusy("upload");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(href, { method: "POST", body });
      const result = (await response.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        toast.error(result?.error ?? t("uploadFailed"));
        return;
      }
      toast.success(t("uploaded"));
      router.refresh();
    } catch {
      toast.error(t("uploadFailed"));
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      const response = await fetch(href, { method: "DELETE" });
      const result = (await response.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        toast.error(result?.error ?? t("removeFailed"));
        return;
      }
      toast.success(t("removed"));
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-3">
      <Paperclip aria-hidden className="size-4 text-muted-foreground" />
      {hasAttachment ? (
        <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <FileText className="size-4" />
          {t("open")}
        </a>
      ) : (
        <span className="text-sm text-muted-foreground">{t("none")}</span>
      )}
      {canEdit && (
        <div className="ml-auto flex gap-1">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label={t("choose")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy !== null}>
            <Upload data-icon="inline-start" />
            {busy === "upload" ? t("uploading") : hasAttachment ? t("replace") : t("upload")}
          </Button>
          {hasAttachment && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("remove")} onClick={() => void remove()} disabled={busy !== null}>
              <Trash2 />
            </Button>
          )}
        </div>
      )}
      <p className="basis-full text-xs text-muted-foreground">{t("hint")}</p>
    </div>
  );
}
