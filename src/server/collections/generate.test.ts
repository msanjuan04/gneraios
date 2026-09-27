import { describe, expect, it } from "vitest";
import type { DraftMandate } from "@/components/collections/types";
import { composeRemittanceFile, localDateTime, remittanceFilePath } from "./generate";

const mandate = (id: string, reference: string, nextSequence: "FRST" | "RCUR"): DraftMandate => ({
  id,
  reference,
  debtorName: "Port Mataró SL",
  iban: "ES79 2100 0813 6101 2345 6789",
  bic: null,
  signedOn: "2026-01-15",
  nextSequence,
});

describe("composeRemittanceFile", () => {
  it("ordena por número de factura, usa la secuencia del mandato y devuelve lo que se congela", () => {
    const file = composeRemittanceFile({
      remittanceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      collectionOn: "2026-10-05",
      createdAt: "2026-09-26T10:15:30",
      creditor: { creditorId: "es11 000 b12345674", name: "GNERAI SL", iban: "ES91 2100 0418 4502 0005 1332", bic: "caixesbbxxx" },
      items: [
        { itemId: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", invoiceNumber: "2026-0041", amountCents: 12_345, mandate: mandate("m2", "PEREZ-1", "RCUR") },
        { itemId: "0f8fad5b-d9cb-469f-a165-70867728950e", invoiceNumber: "2026-0038", amountCents: 95_400, mandate: mandate("m1", "PORT-1", "FRST") },
      ],
      remittanceInfo: (number) => `Factura ${number}`,
    });

    expect(file.messageId).toBe("REM-20260926101530-7C9E6679");
    expect(file.creditor).toEqual({ creditorId: "ES11000B12345674", name: "GNERAI SL", iban: "ES9121000418450200051332", bic: "CAIXESBBXXX" });
    expect(file.items).toEqual([
      { id: "0f8fad5b-d9cb-469f-a165-70867728950e", mandate_id: "m1", amount_cents: 95_400, sequence_type: "FRST", end_to_end_id: "2026-0038-0F8FAD5B" },
      { id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", mandate_id: "m2", amount_cents: 12_345, sequence_type: "RCUR", end_to_end_id: "2026-0041-1B4E28BA" },
    ]);
    expect(file.totalCents).toBe(107_745);
    expect(file.xml).toContain("<CtrlSum>1077.45</CtrlSum>");
    expect(file.xml).toContain("<Ustrd>Factura 2026-0038</Ustrd>");
    expect(file.xml.indexOf("2026-0038-0F8FAD5B")).toBeLessThan(file.xml.indexOf("2026-0041-1B4E28BA"));
  });
});

describe("utilidades", () => {
  it("la hora del fichero es la de pared en la zona de la org", () => {
    // 10:15:30 UTC es 12:15:30 en Madrid en verano y 11:15:30 en invierno.
    expect(localDateTime(new Date("2026-09-26T10:15:30Z"), "Europe/Madrid")).toBe("2026-09-26T12:15:30");
    expect(localDateTime(new Date("2026-12-31T23:30:00Z"), "Europe/Madrid")).toBe("2027-01-01T00:30:00");
  });

  it("cada fichero va en la carpeta de su org y su remesa", () => {
    expect(remittanceFilePath("org", "rem", "REM-1")).toBe("org/rem/REM-1.xml");
  });
});
