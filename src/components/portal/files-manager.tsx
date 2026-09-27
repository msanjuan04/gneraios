"use client";

import { FileText, Link2, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { InlineConfirm } from "@/components/quotes/inline-confirm";
import { FormField } from "@/components/settings/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CLIENT_FILE_MAX_BYTES, formatBytes } from "@/domain/portal";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { addClientLinkFile, confirmClientFileUpload, deleteClientFile, prepareClientFileUpload } from "@/server/portal/actions";
import type { PortalFileItem } from "./types";

const NO_CONTRACT = "__none__";
const BUCKET = "client-files";

/**
 * Entregables y material del portal: subir un fichero (el navegador lo sube directamente a
 * Storage con una URL firmada y el servidor confirma la subida) o compartir un enlace.
 */
export function FilesManager({
  slug,
  clientId,
  files,
  contracts,
  canEdit,
}: {
  slug: string;
  clientId: string;
  files: PortalFileItem[];
  contracts: { id: string; title: string }[];
  canEdit: boolean;
}) {
  const t = useTranslations("portal.files");
  const tErrors = useTranslations("portal.errors");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "link">("file");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [contractId, setContractId] = useState(NO_CONTRACT);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle("");
    setUrl("");
    if (fileInput.current) fileInput.current.value = "";
  };
  const contract = contractId === NO_CONTRACT ? null : contractId;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || pending) return;
    startTransition(async () => {
      if (mode === "link") {
        const result = await addClientLinkFile(slug, clientId, { title, url, contractId: contract });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(t("added"));
        reset();
        router.refresh();
        return;
      }
      const file = fileInput.current?.files?.[0];
      if (!file) return;
      const prepared = await prepareClientFileUpload(slug, clientId, {
        title: title.trim() || file.name,
        fileName: file.name,
        sizeBytes: file.size,
        contentType: file.type || null,
        contractId: contract,
      });
      if (!prepared.ok) {
        toast.error(prepared.error);
        return;
      }
      const { error } = await createClient().storage.from(BUCKET).uploadToSignedUrl(prepared.path, prepared.token, file, {
        contentType: file.type || "application/octet-stream",
      });
      if (error) {
        await deleteClientFile(slug, clientId, prepared.fileId);
        toast.error(tErrors("uploadFailed"));
        return;
      }
      const confirmed = await confirmClientFileUpload(slug, clientId, prepared.fileId);
      if (!confirmed.ok) {
        toast.error(confirmed.error);
        return;
      }
      toast.success(t("uploaded"));
      reset();
      router.refresh();
    });
  };

  const remove = (fileId: string) =>
    startTransition(async () => {
      const result = await deleteClientFile(slug, clientId, fileId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRemoving(null);
      toast.success(t("removed"));
      router.refresh();
    });

  return (
    <div className="space-y-5">
      {canEdit && (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-muted/30 p-4">
          <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-xl border bg-muted/40 p-1">
            {(["file", "link"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  mode === m && "bg-background text-foreground shadow-sm",
                )}
              >
                {m === "file" ? <Upload className="size-3.5" /> : <Link2 className="size-3.5" />}
                {m === "file" ? t("addFile") : t("addLink")}
              </button>
            ))}
          </div>
          <FormField id="portal-file-title" label={t("fileTitle")} optional={mode === "file"}>
            <Input id="portal-file-title" value={title} maxLength={200} placeholder={t("fileTitlePlaceholder")} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          {mode === "file" ? (
            <FormField id="portal-file-input" label={t("file")} description={t("fileHint")}>
              <Input
                id="portal-file-input"
                ref={fileInput}
                type="file"
                required
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.size > CLIENT_FILE_MAX_BYTES) {
                    e.target.value = "";
                    toast.error(tErrors("fileTooLarge"));
                  }
                }}
              />
            </FormField>
          ) : (
            <FormField id="portal-file-url" label={t("url")}>
              <Input id="portal-file-url" type="url" required value={url} maxLength={2000} placeholder={t("urlPlaceholder")} onChange={(e) => setUrl(e.target.value)} />
            </FormField>
          )}
          {contracts.length > 0 && (
            <FormField id="portal-file-contract" label={t("contract")} optional>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger id="portal-file-contract" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CONTRACT}>{t("noContract")}</SelectItem>
                  {contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending || (mode === "link" && (!title.trim() || !url.trim()))}>
              {pending ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : mode === "file" ? <Upload data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}
              {mode === "file" ? (pending ? t("uploading") : t("upload")) : pending ? t("adding") : t("add")}
            </Button>
          </div>
        </form>
      )}

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-2xl border">
          {files.map((file) => (
            <li key={file.id} className="space-y-2 p-3">
              <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                  {file.kind === "link" ? <Link2 className="size-4" /> : <FileText className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{file.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      file.kind === "link" ? file.url : file.fileName,
                      file.sizeBytes !== null && file.kind === "file" ? formatBytes(file.sizeBytes, locale) : null,
                      format.dateTime(new Date(`${file.addedOn}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }),
                      file.contractTitle,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("remove")}
                    onClick={() => setRemoving(file.id)}
                    disabled={pending}
                    className="hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              {removing === file.id && (
                <InlineConfirm
                  tone="destructive"
                  icon={<Trash2 className="text-destructive" />}
                  confirmLabel={t("removeAction")}
                  onConfirm={() => remove(file.id)}
                  onCancel={() => setRemoving(null)}
                  pending={pending}
                >
                  {t("removeConfirm")}
                </InlineConfirm>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
