// Expediente de la sociedad (sin I/O): categorías, estados y la forma de un documento.
// Las etiquetas salen de i18n (finance.company.categories.* y finance.company.statuses.*).

export const ORG_DOCUMENT_CATEGORIES = ["constitution", "statutes", "registry", "tax", "social_security", "partner_agreement", "bank", "other"] as const;
export type OrgDocumentCategory = (typeof ORG_DOCUMENT_CATEGORIES)[number];

export const ORG_DOCUMENT_STATUSES = ["draft", "pending_signature", "signed", "filed", "registered", "superseded"] as const;
export type OrgDocumentStatus = (typeof ORG_DOCUMENT_STATUSES)[number];

/** Tamaño máximo de un documento del expediente. */
export const ORG_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

/** Tipos admitidos → extensión con la que se guarda. */
export const ORG_DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "image/jpeg": "jpg",
  "image/png": "png",
  "text/markdown": "md",
  "text/plain": "txt",
};

export type OrgDocumentItem = {
  id: string;
  category: OrgDocumentCategory;
  status: OrgDocumentStatus;
  title: string;
  description: string | null;
  effectiveOn: string | null;
  memberId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

/** Un estado que ya no pide nada (firmado, presentado, inscrito o sustituido). */
export function isSettledStatus(status: OrgDocumentStatus): boolean {
  return status === "signed" || status === "filed" || status === "registered" || status === "superseded";
}
