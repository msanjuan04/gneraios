// Facturas de ejemplo como las deja la extracción de texto de un PDF (columnas alineadas con
// espacios, como `pdftotext -layout`), con los formatos de las herramientas que usaban los socios:
// la app de facturas, Holded, una plantilla de Word, una factura en catalán, otra en inglés… Todos
// los datos son inventados (NIF de ejemplo con su carácter de control correcto) y cada una lleva lo
// que el lector tiene que sacar de ella. Las usan los tests del lector y el recuento de aciertos.

import type { CivilDate } from "../dates/civil-date";
import type { PaymentMethod } from "../dataio/values";

export type FixtureExpectation = {
  number?: string;
  series?: string;
  issuedOn?: CivilDate;
  dueOn?: CivilDate;
  operationOn?: CivilDate;
  issuerTaxId?: string;
  issuerName?: string;
  recipientTaxId?: string;
  recipientName?: string;
  recipientAddress?: string;
  recipientPostalCode?: string;
  recipientCity?: string;
  recipientCountry?: string;
  baseCents?: number;
  vatBps?: number | null;
  vatCents?: number;
  irpfBps?: number;
  irpfCents?: number;
  totalCents?: number;
  lines?: { description: string; amountCents: number; quantity?: string; unitPriceCents?: number }[];
  paymentMethod?: PaymentMethod;
  paid?: boolean | null;
  paidOn?: CivilDate | null;
};

export type InvoiceFixture = {
  name: string;
  text: string;
  /** Los NIF con los que factura la org (lo que el servidor le pasa al lector). */
  issuerTaxIds?: string[];
  expected: FixtureExpectation;
};

/** La app de facturas de los socios: cabecera a dos columnas, «Cliente:» y tabla sencilla. */
const APP_FACTURAS = `
                                                        FACTURA
Marc Sanjuan Sard                                       Nº Factura: 2025-0036
NIF: 12345678Z                                          Fecha: 15/03/2025
Carrer Major 1
08301 Mataró (Barcelona)
marc@example.com

Cliente:
Restaurant del Port SL
CIF: B12345674
Passeig Marítim 3
08301 Mataró (Barcelona)

Concepto                                           Cantidad      Precio        Importe
Mantenimiento web marzo 2025                              1      150,00 €       150,00 €
Campaña Meta Ads · marzo                                  1      750,00 €       750,00 €

                                                   Base imponible              900,00 €
                                                   IVA (21%)                   189,00 €
                                                   IRPF (-15%)                -135,00 €
                                                   TOTAL                       954,00 €

Forma de pago: Transferencia bancaria
IBAN: ES91 2100 0418 4502 0005 1332
Vencimiento: 14/04/2025
`;

/** Estilo Holded: número en la cabecera, columnas precio/unidades/subtotal y desglose con las etiquetas encima. */
const HOLDED = `
GNERAI SL
CIF B09876541 · Carrer de la Riera 10, 08301 Mataró
                                                          FACTURA F250012
                                                          Fecha          02/05/2025
                                                          Vencimiento    01/06/2025

FACTURAR A
Clínica Dental Mar Blau SL
NIF: B65432106
Avinguda del Maresme 45
08302 Mataró (Barcelona)

CONCEPTO                              PRECIO      UNIDADES     SUBTOTAL      IVA       TOTAL
Diseño de logotipo                    600,00           1         600,00      21%      726,00
Sesión de fotos de producto           250,00           2         500,00      21%      605,00

BASE IMPONIBLE        % IVA        CUOTA IVA        TOTAL
1.100,00              21,00           231,00        1.331,00

Forma de pago: Domiciliación bancaria
`;

/** En catalán, con las fechas en letra, retención y la fecha en que se cobró. */
const CATALAN = `
Factura núm. 2024/118
Data: 3 de març de 2024
Data de venciment: 2 d'abril de 2024

Emissor: Laia Puig Soler · NIF 00000000T
Client: Associació Cultural Els Castellers
NIF: G12345674
Carrer de Sant Pere 5
08301 Mataró

Concepte                                   Import
Gestió de xarxes socials · febrer        400,00 €
Disseny de cartells                      200,00 €

Base imposable                           600,00 €
IVA 21%                                  126,00 €
Retenció IRPF 15%                        -90,00 €
Total                                    636,00 €

Pagada el 28/03/2024
`;

/** En inglés, a un cliente de la UE con inversión del sujeto pasivo e importes a la inglesa. */
const ENGLISH_REVERSE_CHARGE = `
INVOICE
Invoice number: INV-2025-007
Invoice date: June 12, 2025
Due date: July 12, 2025

From:
GNERAI SL
VAT: ESB09876541

Bill to:
Atelier Lumière SARL
VAT number: FR12345678901
12 Rue de la Paix
75002 Paris
France

Description                        Qty     Unit price         Amount
Website redesign                     1       3,500.00       3,500.00
Hosting (annual)                     1         240.00         240.00

Subtotal                                                    3,740.00
VAT 0% - Reverse charge (art. 196 Directive 2006/112/EC)        0.00
Total due                                               EUR 3,740.00
`;

/** Dos tipos de IVA (21 % y 10 %), cada línea con el suyo. */
const MULTI_VAT = `
FACTURA Nº: A-2025-0007
FECHA DE EMISIÓN: 10/01/2025
FECHA DE OPERACIÓN: 31/12/2024

Emisor                                        Cliente
GNERAI SL                                     Hotel Llevant SL
CIF: B09876541                                CIF: B66123456
                                              Passeig de Colom 8
                                              08002 Barcelona

Descripción                         Cant.       Precio    % IVA      Importe
Rediseño de la carta digital            1       800,00      21%       800,00
Menú del evento de presentación        20        10,00      10%       200,00

Base imponible                                                      1.000,00
IVA 21%                                                               168,00
IVA 10%                                                                20,00
Total factura                                                       1.188,00

Vencimiento: 09/02/2025
`;

/** Sello de pagada y fecha de pago; número con una etiqueta genérica. */
const PAID_STAMP = `
FACTURA
Número: 42
Fecha factura: 20/06/2025

Jordi Vila Mas
NIF 11111111H

Destinatario: Construccions Riera SL
CIF A08000002

Concepto                                          Importe
Dirección de obra · junio                        500,00 €

Base imponible        500,00 €
IVA 21 %              105,00 €
IRPF 15 %             -75,00 €
Total factura         530,00 €

                                   PAGADA
Fecha de pago: 25/06/2025
`;

/** Pendiente de pago, sin tabla (una sola línea de concepto) y sin total impreso. */
const PENDING = `
Factura n.º 2025/15                                    Fecha de expedición: 07/07/2025
Emisor: Marc Sanjuan Sard, NIF 12345678Z
Cliente: Fundació Mar i Cel, CIF G12345674

Concepto: Formación en redes sociales (8 horas)
Base imponible: 640,00 €
IVA 21%: 134,40 €
Retención IRPF 15%: 96,00 €

Estado: Pendiente de pago
`;

/** Carta de Word: fecha en el encabezado sin etiqueta, «De:»/«Para:» y puntos de relleno. */
const LETTER = `
Barcelona, a 5 de febrero de 2025

FACTURA 7/2025

De: Jordi Vila Mas, NIF 11111111H
Para: Construccions Riera SL, CIF A08000002

Por los servicios de consultoría prestados en enero de 2025:

Honorarios .......................................... 1.200,00 €
IVA 21 % .............................................. 252,00 €
Retención IRPF 15 % ................................. - 180,00 €
Total a percibir .................................... 1.272,00 €

Forma de pago: transferencia a la cuenta ES91 2100 0418 4502 0005 1332
`;

/**
 * Una línea con cada texto en su columna, como la deja la extracción: `[texto, columna]` o, alineado
 * a la derecha, `[texto, columna en la que acaba, "right"]`.
 */
function at(...parts: ([string, number] | [string, number, "right"])[]): string {
  let line = "";
  for (const [text, column, align] of parts) {
    const start = align === "right" ? column - text.length : column;
    line = line.length >= start ? `${line}  ` : line.padEnd(start, " ");
    line += text;
  }
  return line;
}

/** La plantilla de GNERAI OS: etiquetas con espaciado de letras, el valor debajo y columnas a la derecha. */
const LETTER_SPACED = [
  at(["F A C T U R A", 12]),
  at(["2026-0042", 12]),
  at(["F E C H A D E E M I S I Ó N", 12], ["V E N C I M I E N T O", 45]),
  at(["15/10/2026", 12], ["14/11/2026", 45]),
  at(["E M I S O R", 12], ["C L I E N T E", 77]),
  at(["Laia Mostra Exemple", 12], ["Cal Exemple Restauració SL", 77]),
  at(["GNERAI", 12], ["Cal Exemple", 77]),
  at(["NIF 00000000T", 12], ["NIF B12345674", 77]),
  at(["Passeig de l'Exemple, 7, 3r 2a", 12], ["Plaça de la Mostra, 3, baixos", 77]),
  at(["08350 Arenys de Mar (Barcelona)", 12], ["08330 Premià de Mar (Barcelona)", 77]),
  at(["D E S C R I P C I Ó N", 12], ["C A N T I D A D", 64], ["P R E C I O", 84], ["D T O .", 99], ["I M P O R T E", 110]),
  at(["Diseño y desarrollo de la nueva web · hito 1 de 2", 12], ["1", 79, "right"], ["2.400,00 €", 95, "right"], ["2.400,00 €", 123, "right"]),
  at(["(50 % a la firma)", 12]),
  at(["Sesión de fotografía de producto", 12], ["1", 79, "right"], ["450,00 €", 95, "right"], ["10 %", 106, "right"], ["405,00 €", 123, "right"]),
  at(["Horas de soporte fuera del plan", 12], ["3,5", 79, "right"], ["60,00 €", 95, "right"], ["210,00 €", 123, "right"]),
  at(["Por consumo · 01/09/2026 - 30/09/2026", 12]),
  at(["D A T O S D E P A G O", 12]),
  at(["Forma de pago", 12], ["Transferencia bancaria", 33], ["Base imponible", 70], ["3.015,00 €", 123, "right"]),
  at(["IBAN", 12], ["ES00 0000 0000 0000 0000 0000", 33], ["IVA 21 %", 70], ["633,15 €", 123, "right"]),
  at(["Titular", 12], ["Laia Mostra Exemple", 33], ["Retención IRPF 15 %", 70], ["-452,25 €", 123, "right"]),
  at(["T O T A L A P A G A R", 76], ["3.195,90 €", 123, "right"]),
].join("\n");

/** Rectificativa: se reconoce y se avisa (se importan desde Ajustes → Datos). */
const RECTIFYING = `
FACTURA RECTIFICATIVA Nº R-2025-0003
Fecha: 30/04/2025
Rectifica a la factura 2025-0042 de 15/03/2025

GNERAI SL · CIF B09876541
Cliente: Restaurant del Port SL · CIF B12345674

Concepto                                  Importe
Anulación de la campaña de marzo       -750,00 €

Base imponible                         -750,00 €
IVA 21%                                -157,50 €
Total                                  -907,50 €
`;

export const INVOICE_FIXTURES: readonly InvoiceFixture[] = [
  {
    name: "app de facturas",
    text: APP_FACTURAS,
    issuerTaxIds: ["12345678Z"],
    expected: {
      number: "2025-0036",
      issuedOn: "2025-03-15",
      dueOn: "2025-04-14",
      issuerTaxId: "12345678Z",
      issuerName: "Marc Sanjuan Sard",
      recipientTaxId: "B12345674",
      recipientName: "Restaurant del Port SL",
      recipientAddress: "Passeig Marítim 3",
      recipientPostalCode: "08301",
      recipientCity: "Mataró",
      recipientCountry: "ES",
      baseCents: 90_000,
      vatBps: 2100,
      vatCents: 18_900,
      irpfBps: 1500,
      irpfCents: 13_500,
      totalCents: 95_400,
      lines: [
        { description: "Mantenimiento web marzo 2025", amountCents: 15_000, quantity: "1", unitPriceCents: 15_000 },
        { description: "Campaña Meta Ads · marzo", amountCents: 75_000, quantity: "1", unitPriceCents: 75_000 },
      ],
      paymentMethod: "transfer",
      paid: null,
      paidOn: null,
    },
  },
  {
    name: "Holded",
    text: HOLDED,
    issuerTaxIds: ["B09876541"],
    expected: {
      number: "F250012",
      issuedOn: "2025-05-02",
      dueOn: "2025-06-01",
      issuerTaxId: "B09876541",
      issuerName: "GNERAI SL",
      recipientTaxId: "B65432106",
      recipientName: "Clínica Dental Mar Blau SL",
      recipientAddress: "Avinguda del Maresme 45",
      recipientPostalCode: "08302",
      recipientCity: "Mataró",
      baseCents: 110_000,
      vatBps: 2100,
      vatCents: 23_100,
      irpfCents: 0,
      totalCents: 133_100,
      lines: [
        { description: "Diseño de logotipo", amountCents: 60_000, quantity: "1", unitPriceCents: 60_000 },
        { description: "Sesión de fotos de producto", amountCents: 50_000, quantity: "2", unitPriceCents: 25_000 },
      ],
      paymentMethod: "sepa_debit",
      paid: null,
    },
  },
  {
    name: "catalán con fecha de cobro",
    text: CATALAN,
    issuerTaxIds: ["00000000T"],
    expected: {
      number: "2024/118",
      issuedOn: "2024-03-03",
      dueOn: "2024-04-02",
      issuerTaxId: "00000000T",
      recipientTaxId: "G12345674",
      recipientName: "Associació Cultural Els Castellers",
      recipientAddress: "Carrer de Sant Pere 5",
      recipientPostalCode: "08301",
      recipientCity: "Mataró",
      baseCents: 60_000,
      vatBps: 2100,
      vatCents: 12_600,
      irpfBps: 1500,
      irpfCents: 9000,
      totalCents: 63_600,
      lines: [
        { description: "Gestió de xarxes socials · febrer", amountCents: 40_000 },
        { description: "Disseny de cartells", amountCents: 20_000 },
      ],
      paid: true,
      paidOn: "2024-03-28",
    },
  },
  {
    name: "inglés, inversión del sujeto pasivo",
    text: ENGLISH_REVERSE_CHARGE,
    issuerTaxIds: ["B09876541"],
    expected: {
      number: "INV-2025-007",
      issuedOn: "2025-06-12",
      dueOn: "2025-07-12",
      issuerTaxId: "B09876541",
      issuerName: "GNERAI SL",
      recipientTaxId: "FR12345678901",
      recipientName: "Atelier Lumière SARL",
      recipientAddress: "12 Rue de la Paix",
      recipientPostalCode: "75002",
      recipientCity: "Paris",
      recipientCountry: "FR",
      baseCents: 374_000,
      vatBps: 0,
      vatCents: 0,
      totalCents: 374_000,
      lines: [
        { description: "Website redesign", amountCents: 350_000, quantity: "1", unitPriceCents: 350_000 },
        { description: "Hosting (annual)", amountCents: 24_000, quantity: "1", unitPriceCents: 24_000 },
      ],
    },
  },
  {
    name: "dos tipos de IVA",
    text: MULTI_VAT,
    issuerTaxIds: ["B09876541"],
    expected: {
      number: "A-2025-0007",
      issuedOn: "2025-01-10",
      operationOn: "2024-12-31",
      dueOn: "2025-02-09",
      issuerTaxId: "B09876541",
      issuerName: "GNERAI SL",
      recipientTaxId: "B66123456",
      recipientName: "Hotel Llevant SL",
      recipientAddress: "Passeig de Colom 8",
      recipientPostalCode: "08002",
      recipientCity: "Barcelona",
      baseCents: 100_000,
      vatBps: null,
      vatCents: 18_800,
      totalCents: 118_800,
      lines: [
        { description: "Rediseño de la carta digital", amountCents: 80_000, quantity: "1", unitPriceCents: 80_000 },
        { description: "Menú del evento de presentación", amountCents: 20_000, quantity: "20", unitPriceCents: 1000 },
      ],
    },
  },
  {
    name: "sello de pagada",
    text: PAID_STAMP,
    issuerTaxIds: ["11111111H"],
    expected: {
      number: "42",
      issuedOn: "2025-06-20",
      issuerTaxId: "11111111H",
      issuerName: "Jordi Vila Mas",
      recipientTaxId: "A08000002",
      recipientName: "Construccions Riera SL",
      baseCents: 50_000,
      vatBps: 2100,
      vatCents: 10_500,
      irpfBps: 1500,
      irpfCents: 7500,
      totalCents: 53_000,
      lines: [{ description: "Dirección de obra · junio", amountCents: 50_000 }],
      paid: true,
      paidOn: "2025-06-25",
    },
  },
  {
    name: "pendiente, sin tabla ni total",
    text: PENDING,
    issuerTaxIds: ["12345678Z"],
    expected: {
      number: "2025/15",
      issuedOn: "2025-07-07",
      issuerTaxId: "12345678Z",
      recipientTaxId: "G12345674",
      recipientName: "Fundació Mar i Cel",
      baseCents: 64_000,
      vatBps: 2100,
      vatCents: 13_440,
      irpfBps: 1500,
      irpfCents: 9600,
      totalCents: 67_840,
      paid: false,
      paidOn: null,
    },
  },
  {
    name: "carta de Word",
    text: LETTER,
    issuerTaxIds: ["11111111H"],
    expected: {
      number: "7/2025",
      issuedOn: "2025-02-05",
      issuerTaxId: "11111111H",
      issuerName: "Jordi Vila Mas",
      recipientTaxId: "A08000002",
      recipientName: "Construccions Riera SL",
      baseCents: 120_000,
      vatBps: 2100,
      vatCents: 25_200,
      irpfBps: 1500,
      irpfCents: 18_000,
      totalCents: 127_200,
      paymentMethod: "transfer",
    },
  },
  {
    name: "plantilla con espaciado de letras",
    text: LETTER_SPACED,
    issuerTaxIds: ["00000000T"],
    expected: {
      number: "2026-0042",
      issuedOn: "2026-10-15",
      dueOn: "2026-11-14",
      issuerTaxId: "00000000T",
      issuerName: "Laia Mostra Exemple",
      recipientTaxId: "B12345674",
      recipientName: "Cal Exemple Restauració SL",
      recipientAddress: "Plaça de la Mostra, 3, baixos",
      recipientPostalCode: "08330",
      recipientCity: "Premià de Mar",
      baseCents: 301_500,
      vatBps: 2100,
      vatCents: 63_315,
      irpfBps: 1500,
      irpfCents: 45_225,
      totalCents: 319_590,
      lines: [
        { description: "Diseño y desarrollo de la nueva web · hito 1 de 2 (50 % a la firma)", amountCents: 240_000, quantity: "1", unitPriceCents: 240_000 },
        { description: "Sesión de fotografía de producto", amountCents: 40_500, quantity: "1", unitPriceCents: 45_000 },
        { description: "Horas de soporte fuera del plan", amountCents: 21_000, quantity: "3.5", unitPriceCents: 6000 },
      ],
      paymentMethod: "transfer",
    },
  },
];

/** La rectificativa (se prueba aparte: solo tiene que avisar y leer lo básico). */
export const RECTIFYING_FIXTURE: InvoiceFixture = {
  name: "rectificativa",
  text: RECTIFYING,
  issuerTaxIds: ["B09876541"],
  expected: { number: "R-2025-0003", issuedOn: "2025-04-30", recipientTaxId: "B12345674" },
};
