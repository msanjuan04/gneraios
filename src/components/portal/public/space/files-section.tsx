import { Download, ExternalLink, FileText, Link2, PackageOpen } from "lucide-react";
import type { SpaceData } from "@/components/portal/types";
import { formatBytes, portalIntlLocale } from "@/domain/portal";
import { portalCopy } from "@/server/portal/copy";
import { civil, EmptyState, pillClass, SectionCard } from "../ui";
import { SPACE_SECTION_ICONS } from "./icons";

/** «Entregables y material»: ficheros (descarga con el token) y enlaces que ha dejado el equipo. */
export function FilesSection({ data, token }: { data: SpaceData; token: string }) {
  const t = portalCopy(data.locale);
  const files = data.files ?? [];
  return (
    <SectionCard id="files" icon={SPACE_SECTION_ICONS.files} title={t("space.sections.files.title")} subtitle={t("space.sections.files.subtitle")}>
      {files.length === 0 ? (
        <EmptyState icon={PackageOpen}>{t("space.sections.files.empty")}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {files.map((file) => {
            const isLink = file.kind === "link";
            const meta = [
              isLink ? t("space.sections.files.link") : file.fileName,
              !isLink && file.sizeBytes !== null ? formatBytes(file.sizeBytes, portalIntlLocale(data.locale)) : null,
              civil(file.addedOn, data.locale, "medium"),
            ].filter(Boolean);
            return (
              <li key={file.id} className="flex items-center gap-3.5 rounded-2xl border bg-background/50 p-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-primary">
                  {isLink ? <Link2 className="size-5" aria-hidden /> : <FileText className="size-5" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{file.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
                  {file.contractTitle && <p className="truncate text-xs text-muted-foreground">{file.contractTitle}</p>}
                </div>
                {isLink && file.url ? (
                  <a href={file.url} target="_blank" rel="noopener noreferrer" className={pillClass("secondary")} aria-label={`${t("space.sections.files.open")}: ${file.title}`}>
                    <ExternalLink aria-hidden />
                    <span className="hidden sm:inline">{t("space.sections.files.open")}</span>
                  </a>
                ) : (
                  <a
                    href={`/api/public/c/${token}/files/${file.id}`}
                    className={pillClass("secondary")}
                    aria-label={`${t("space.sections.files.download")}: ${file.title}`}
                  >
                    <Download aria-hidden />
                    <span className="hidden sm:inline">{t("space.sections.files.download")}</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
