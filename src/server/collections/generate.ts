// Sin "server-only": no lee secretos ni la base de datos (es la composición pura del fichero y se
// prueba con Vitest). Solo se importa desde código de servidor.
import type { DraftMandate, SequenceType } from "@/components/collections/types";
import { buildPain008, endToEndId, normalizeBic, normalizeCreditorId, remittanceMessageId, sumCents } from "@/domain/collections";
import type { CivilDate } from "@/domain/dates/civil-date";
import { normalizeIban } from "@/domain/tax-id";

/** Ruta del fichero en el bucket privado `remittances`: uno por generación, dentro de la carpeta de la org. */
export const remittanceFilePath = (orgId: string, remittanceId: string, messageId: string) =>
  `${orgId}/${remittanceId}/${messageId}.xml`;

const wallClock = new Map<string, Intl.DateTimeFormat>();

/** "2026-09-26T10:15:30": la hora de pared en la zona de la org (el CreDtTm del fichero). */
export function localDateTime(now: Date, timeZone: string): string {
  let fmt = wallClock.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    wallClock.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

export type FileCreditor = { creditorId: string; name: string; iban: string; bic: string | null };

/** Un recibo listo para el fichero: su id (para la referencia del adeudo), su factura y su mandato. */
export type FileItem = {
  itemId: string;
  invoiceNumber: string;
  amountCents: number;
  mandate: DraftMandate;
};

export type FrozenItem = {
  id: string;
  mandate_id: string;
  amount_cents: number;
  sequence_type: SequenceType;
  end_to_end_id: string;
};

/**
 * El fichero pain.008 de una remesa y lo que se congela de cada recibo. Los adeudos van en orden de
 * número de factura; la secuencia es la derivada del mandato (FRST hasta su primer adeudo generado).
 */
export function composeRemittanceFile(opts: {
  remittanceId: string;
  collectionOn: CivilDate;
  createdAt: string;
  creditor: FileCreditor;
  items: readonly FileItem[];
  remittanceInfo: (invoiceNumber: string) => string;
}): { xml: string; messageId: string; creditor: FileCreditor; items: FrozenItem[]; totalCents: number } {
  const creditor: FileCreditor = {
    creditorId: normalizeCreditorId(opts.creditor.creditorId),
    name: opts.creditor.name,
    iban: normalizeIban(opts.creditor.iban),
    bic: opts.creditor.bic ? normalizeBic(opts.creditor.bic) : null,
  };
  const messageId = remittanceMessageId(opts.createdAt, opts.remittanceId);
  const items = [...opts.items]
    .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber) || a.itemId.localeCompare(b.itemId))
    .map((item) => ({ item, e2e: endToEndId(item.invoiceNumber, item.itemId) }));

  const xml = buildPain008({
    messageId,
    createdAt: opts.createdAt,
    collectionOn: opts.collectionOn,
    creditor,
    transactions: items.map(({ item, e2e }) => ({
      endToEndId: e2e,
      amountCents: item.amountCents,
      sequenceType: item.mandate.nextSequence,
      mandateId: item.mandate.reference,
      mandateSignedOn: item.mandate.signedOn,
      debtorName: item.mandate.debtorName,
      debtorIban: item.mandate.iban,
      debtorBic: item.mandate.bic,
      remittanceInfo: opts.remittanceInfo(item.invoiceNumber),
    })),
  });

  return {
    xml,
    messageId,
    creditor,
    items: items.map(({ item, e2e }) => ({
      id: item.itemId,
      mandate_id: item.mandate.id,
      amount_cents: item.amountCents,
      sequence_type: item.mandate.nextSequence,
      end_to_end_id: e2e,
    })),
    totalCents: sumCents(items.map(({ item }) => item.amountCents)),
  };
}
