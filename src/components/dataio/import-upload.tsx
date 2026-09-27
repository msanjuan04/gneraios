"use client";

import { FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type DragEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ImportKind } from "@/domain/dataio/fields";
import { cn } from "@/lib/utils";

/**
 * Subir el fichero de una importación (clic o arrastrar). Se envía a la ruta de subida (no a una
 * Server Action: admiten como mucho 1 MB) y se abre la importación, ya con el mapeo automático.
 */
export function ImportUpload({ slug, kind, disabled }: { slug: string; kind: ImportKind; disabled?: boolean }) {
  const t = useTranslations("dataio.upload");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function send(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const res = await fetch(`/api/dataio/${slug}/imports`, { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { ok: boolean; jobId?: string; error?: string } | null;
      if (!body?.ok || !body.jobId) {
        toast.error(body?.error ?? t("errors.generic"));
        return;
      }
      router.push(`/${slug}/settings/data/imports/${body.jobId}`);
    } catch {
      toast.error(t("errors.generic"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled && !busy) void send(file);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "bg-muted/30",
        disabled && "opacity-60",
      )}
    >
      <FileSpreadsheet className="size-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <input
        ref={input}
        type="file"
        accept=".csv,.txt,.json,text/csv,text/plain,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void send(file);
        }}
      />
      <Button type="button" size="sm" onClick={() => input.current?.click()} disabled={disabled || busy}>
        {busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
        {busy ? t("uploading") : t("choose")}
      </Button>
    </div>
  );
}
