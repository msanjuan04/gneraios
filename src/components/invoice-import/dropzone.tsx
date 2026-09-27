"use client";

import { FileUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Zona para soltar (o elegir) uno o muchos PDF. Lo que no es un PDF se descarta y se avisa. */
export function PdfDropzone({
  onFiles,
  compact = false,
  disabled = false,
}: {
  onFiles: (files: File[], rejected: number) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("invoiceImport.drop");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])];
    const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (files.length > 0) onFiles(pdfs, files.length - pdfs.length);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        compact ? "px-4 py-3 text-sm" : "flex-col px-6 py-10",
        over ? "border-primary bg-primary/5" : "border-border bg-muted/30 hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <FileUp className={cn("text-muted-foreground", compact ? "size-4" : "size-6")} aria-hidden />
      <div>
        <p className="font-semibold">{compact ? t("more") : t("title")}</p>
        {!compact && <p className="mt-1 text-sm text-muted-foreground">{t("hint")}</p>}
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
