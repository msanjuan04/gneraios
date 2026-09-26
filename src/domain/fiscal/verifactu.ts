// Utilidades de Verifactu que no dependen del proveedor: la cuenta atrás y la URL de cotejo
// que va en el QR (Orden HAC/1177/2024). El QR lo genera el proveedor certificado; esta URL
// sirve para comprobarlo y para las pruebas.

import { daysBetween, parseCivilDate, type CivilDate } from "../dates/civil-date";
import type { Cents } from "../money";

/** La app muestra la cuenta atrás desde 90 días antes de la obligación. */
export const VERIFACTU_COUNTDOWN_DAYS = 90;

export type VerifactuCountdown =
  | { state: "far"; daysLeft: number }
  | { state: "soon"; daysLeft: number }
  | { state: "required"; daysLeft: 0 };

/** Estado de un emisor con el proveedor interno respecto a su fecha Verifactu. */
export function verifactuCountdown(verifactuFrom: CivilDate, today: CivilDate): VerifactuCountdown {
  const daysLeft = daysBetween(today, verifactuFrom);
  if (daysLeft <= 0) return { state: "required", daysLeft: 0 };
  return daysLeft <= VERIFACTU_COUNTDOWN_DAYS ? { state: "soon", daysLeft } : { state: "far", daysLeft };
}

const AEAT_QR_BASE = "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR";

/** URL de cotejo de la AEAT: nif, número de serie, fecha DD-MM-AAAA e importe total con punto decimal. */
export function aeatQrUrl(input: { nif: string; number: string; issuedOn: CivilDate; totalCents: Cents }): string {
  const { year, month, day } = parseCivilDate(input.issuedOn);
  const pad = (n: number) => String(n).padStart(2, "0");
  const sign = input.totalCents < 0 ? "-" : "";
  const abs = Math.abs(input.totalCents);
  const amount = `${sign}${Math.trunc(abs / 100)}.${pad(abs % 100)}`;
  const params = new URLSearchParams({
    nif: input.nif,
    numserie: input.number,
    fecha: `${pad(day)}-${pad(month)}-${year}`,
    importe: amount,
  });
  return `${AEAT_QR_BASE}?${params.toString()}`;
}
