import type { PaymentMethod } from "@/domain/dataio/values";
import type { ImportSetup } from "@/domain/invoice-import/match";
import type { ExtractedInvoice } from "@/domain/invoice-import/types";
import type { Enums } from "@/lib/supabase/database.types";

// Lo que se cruzan el panel de «Importar facturas emitidas» y el servidor (rutas y acciones de
// src/app/api/invoice-import y src/server/invoice-import).

export type ExtractionEngine = "claude" | "text";

/** Estado de una fila del panel: leyendo, error, lista, a revisar, ya estaba (con cobro pendiente o no), guardada. */
export const ROW_STATUSES = ["reading", "error", "ready", "review", "payment", "existing", "saving", "saved"] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

/** Lo que se ha hecho con una fila guardada. */
export const SAVED_KINDS = ["imported", "payment", "attached"] as const;

/** Una factura que ya está en la org con el mismo emisor y número (o con el mismo PDF). */
export type ExistingInvoice = {
  id: string;
  number: string;
  issuerId: string;
  clientId: string;
  clientName: string;
  /** import: una histórica importada antes; app: emitida desde GNERAI OS. */
  source: Enums<"invoice_source">;
  status: Enums<"invoice_status">;
  issuedOn: string | null;
  netTotalCents: number;
  paidCents: number;
  outstandingCents: number;
  paymentMethod: PaymentMethod;
  hasOriginal: boolean;
  matchedBy: "number" | "file";
};

export type ExtractResponse =
  | { ok: true; engine: ExtractionEngine; extraction: ExtractedInvoice; sha256: string; existing: ExistingInvoice | null }
  | { ok: false; error: string };

export type SaveResponse =
  | { ok: true; invoiceId: string; number: string; clientId: string; attached: boolean }
  | { ok: false; error: string; code: string; existing?: ExistingInvoice };

export type AttachResponse = { ok: true } | { ok: false; error: string };

export type ImportSetupData = {
  setup: ImportSetup;
  lockedClient: { id: string; name: string } | null;
  /** Hay clave de Claude: también se leen los PDF escaneados. */
  claude: boolean;
};

export type CreatedClient = { key: string; clientId: string; name: string; created: boolean } | { key: string; error: string };
