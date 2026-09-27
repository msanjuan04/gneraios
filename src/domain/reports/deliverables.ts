// Entregables del mes: lo que se ha compartido con el cliente en su portal (client_files). Un
// fichero cuenta el día en que se confirmó su subida; un enlace, el día en que se añadió. Es la
// misma fecha que enseña el portal.

import { compareCivil } from "../dates/civil-date";
import { dateInZone } from "../dates/zoned-time";
import type { Month } from "../metrics/months";
import { isSafeUrl } from "../portal/files";
import { inMonth } from "./month";
import type { ReportDeliverable, ReportFileFact } from "./types";

export function monthDeliverables(files: readonly ReportFileFact[], month: Month, timeZone: string): ReportDeliverable[] {
  return files
    .flatMap((file): ReportDeliverable[] => {
      const sharedAt = file.kind === "file" ? file.uploadedAt : file.createdAt;
      if (!sharedAt) return [];
      const sharedOn = dateInZone(new Date(sharedAt), timeZone);
      if (!inMonth(sharedOn, month)) return [];
      const url = file.kind === "link" && file.url && isSafeUrl(file.url) ? file.url.trim() : null;
      return [
        {
          id: file.id,
          kind: file.kind,
          title: file.title.trim(),
          fileName: file.kind === "file" ? (file.fileName?.trim() || null) : null,
          url,
          sharedOn,
        },
      ];
    })
    .sort((a, b) => compareCivil(a.sharedOn, b.sharedOn) || a.title.localeCompare(b.title, "es") || a.id.localeCompare(b.id));
}
