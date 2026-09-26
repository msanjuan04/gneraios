import type { ReactElement, ReactNode } from "react";
import { Document, Image, Page, StyleSheet, Text, View, type DocumentProps } from "@react-pdf/renderer";
import { brand } from "@/brand";
import { logoPath, PDF_FONT_STACK, registerPdfFonts } from "./assets";
import type { InvoiceDocumentData } from "./types";
import { buildInvoiceView, type InvoiceView, type LabeledValue } from "./view-model";

// Plantilla de factura (ARCHITECTURE.md §9.3): A4 blanco, Manrope, etiquetas espaciadas,
// filetes finos y el total destacado. El color de marca se usa poco: el tipo de documento,
// el total y el recuadro de la rectificativa. Todos los colores salen de `brand.ts`.

/** Tinta `hex` al `amount` sobre el blanco del papel: tonos opacos, sin transparencias. */
function mix(hex: string, amount: number, over: string = brand.palette.white): string {
  const channel = (value: string, index: number) => parseInt(value.slice(1 + index * 2, 3 + index * 2), 16);
  const rgb = [0, 1, 2].map((index) => Math.round(channel(hex, index) * amount + channel(over, index) * (1 - amount)));
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

const color = {
  ink: brand.palette.black,
  text: mix(brand.palette.black, 0.78),
  muted: mix(brand.palette.black, 0.52),
  rule: mix(brand.palette.black, 0.85),
  hairline: mix(brand.palette.black, 0.1),
  accent: brand.palette.blueDeep,
  accentSoft: mix(brand.palette.blueDeep, 0.05),
  watermark: mix(brand.palette.blueDeep, 0.07),
  paper: brand.palette.white,
};

const PT_PER_MM = 72 / 25.4;
const A4_HEIGHT = 297 * PT_PER_MM;
/** Hueco del QR de Verifactu: 35 mm (la norma pide de 30 a 40 mm), arriba en la primera página. */
const QR_SIZE = 35 * PT_PER_MM;
const QR_LEGEND_HEIGHT = 24;
const MARGIN_X = 50;

// El PNG del logo (900 × 220 px) lleva margen blanco: el trazo ocupa x 105–835 e y 42–151.
// Se compensa para que el borde visible del logo quede alineado con el resto de la página.
const LOGO_WIDTH = 132;
const LOGO_HEIGHT = LOGO_WIDTH * (220 / 900);
const LOGO_INK = { left: 105 / 900, top: 42 / 220, bottom: 151 / 220 };

const COLUMN = { quantity: 50, unitPrice: 70, discount: 40, vat: 38, base: 78 };

const tabular = { fontFeatureSettings: ["tnum" as const] };

/**
 * Tamaño e interlineado siempre juntos. En react-pdf 4.9 un `lineHeight` sin unidades se
 * multiplica por el `fontSize` del propio nodo (18 si no lo tiene) y los textos con `render`
 * (el número de página) lo vuelven a multiplicar al recalcularse; por eso no hay interlineado
 * en la página ni en vistas sin tamaño.
 */
function textSize(fontSize: number, lineHeight = 1.4) {
  return { fontSize, lineHeight };
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: color.paper,
    color: color.ink,
    fontFamily: PDF_FONT_STACK,
    fontSize: 8.5,
    paddingTop: 46,
    paddingBottom: 78,
    paddingHorizontal: MARGIN_X,
  },
  content: textSize(8.5, 1.45),
  num: tabular,
  label: {
    ...textSize(6.5, 1.3),
    fontWeight: 600,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: color.muted,
  },

  watermark: {
    ...textSize(96, 1),
    position: "absolute",
    left: -80,
    right: -80,
    textAlign: "center",
    fontWeight: 800,
    letterSpacing: 8,
    color: color.watermark,
    transform: "rotate(-32deg)",
  },
  runningHeader: {
    position: "absolute",
    top: 24,
    left: MARGIN_X,
    right: MARGIN_X,
    fontSize: 6.5,
    letterSpacing: 0.6,
    color: color.muted,
  },

  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headerMain: { flex: 1, paddingRight: 24 },
  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    marginLeft: -LOGO_WIDTH * LOGO_INK.left,
    marginTop: -LOGO_HEIGHT * LOGO_INK.top,
    marginBottom: -LOGO_HEIGHT * (1 - LOGO_INK.bottom),
  },
  docType: {
    ...textSize(7.5, 1.3),
    marginTop: 34,
    fontWeight: 700,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  headline: { ...textSize(26, 1.15), marginTop: 4, fontWeight: 800, letterSpacing: -0.6 },
  headlineDraft: { color: color.muted },
  draftNotice: { ...textSize(7.5, 1.3), marginTop: 3, color: color.muted },
  dates: { flexDirection: "row", marginTop: 18 },
  dateItem: { marginRight: 30 },
  dateValue: { ...textSize(9, 1.3), marginTop: 3, fontWeight: 600 },
  qrSlot: { width: QR_SIZE, height: QR_SIZE + QR_LEGEND_HEIGHT, alignItems: "center" },
  qr: { width: QR_SIZE, height: QR_SIZE },
  qrLegend: { ...textSize(6.5, 1.3), marginTop: 4, textAlign: "center", color: color.text },

  parties: {
    flexDirection: "row",
    marginTop: 26,
    paddingTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: color.hairline,
  },
  party: { flex: 1, paddingRight: 24 },
  partyName: { ...textSize(9.5, 1.35), marginTop: 6, fontWeight: 700 },
  partyTradeName: { color: color.muted },
  partyLines: { marginTop: 3 },
  partyLine: { color: color.text },

  rectifies: {
    flexDirection: "row",
    marginTop: 22,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: color.accentSoft,
    borderLeftWidth: 2,
    borderLeftColor: color.accent,
  },
  rectifiesItem: { marginRight: 28 },
  rectifiesReason: { flex: 1 },
  rectifiesValue: { marginTop: 3, fontWeight: 600 },

  table: { marginTop: 28 },
  tableHead: {
    flexDirection: "row",
    paddingBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: color.rule,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: color.hairline,
  },
  colDescription: { flex: 1, paddingRight: 16 },
  colQuantity: { width: COLUMN.quantity, textAlign: "right" },
  colUnitPrice: { width: COLUMN.unitPrice, textAlign: "right" },
  colDiscount: { width: COLUMN.discount, textAlign: "right" },
  colVat: { width: COLUMN.vat, textAlign: "right" },
  colBase: { width: COLUMN.base, textAlign: "right" },
  description: { fontWeight: 600 },
  detail: { ...textSize(7.5, 1.35), marginTop: 2, color: color.muted },
  cell: { color: color.text },
  cellBase: { fontWeight: 600 },

  summary: { flexDirection: "row", justifyContent: "space-between", marginTop: 22 },
  payment: { width: "46%", paddingRight: 12 },
  paymentRow: { flexDirection: "row", marginTop: 5 },
  paymentLabel: { width: 82, color: color.muted },
  paymentValue: { flex: 1, fontWeight: 500 },
  totals: { width: "46%" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: color.hairline,
  },
  totalLabel: { color: color.text },
  totalHint: { ...textSize(7, 1.3), color: color.muted },
  totalValue: { fontWeight: 600 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: color.accent,
    color: color.paper,
  },
  grandTotalLabel: { ...textSize(7.5, 1.2), fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" },
  grandTotalValue: { ...textSize(15, 1.2), fontWeight: 800, letterSpacing: -0.2 },

  block: { marginTop: 22 },
  legalNote: { ...textSize(7.5, 1.4), marginTop: 4, color: color.text },
  notes: { marginTop: 4, color: color.text },

  footer: {
    position: "absolute",
    left: MARGIN_X,
    right: MARGIN_X,
    bottom: 30,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: color.hairline,
  },
  footerText: { fontSize: 6.5, color: color.muted },
  footerRegistry: { flex: 1, paddingRight: 24 },
});

function Header({ view }: { view: InvoiceView }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerMain}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf no tiene atributo alt */}
        <Image src={logoPath()} style={styles.logo} />
        <Text style={styles.docType}>{view.documentType}</Text>
        <Text style={view.draft ? [styles.headline, styles.headlineDraft] : styles.headline}>{view.headline}</Text>
        {view.draft ? <Text style={styles.draftNotice}>{view.draft.notice}</Text> : null}
        <View style={styles.dates}>
          {view.dates.map((date) => (
            <View key={date.label} style={styles.dateItem}>
              <Text style={styles.label}>{date.label}</Text>
              <Text style={[styles.dateValue, styles.num]}>{date.value}</Text>
            </View>
          ))}
        </View>
      </View>
      {/* El hueco del QR ocupa siempre lo mismo: con o sin QR, la cabecera no se mueve. */}
      <View style={styles.qrSlot}>
        {view.verifactu ? (
          <>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf no tiene atributo alt */}
            <Image src={view.verifactu.qrDataUrl} style={styles.qr} />
            <Text style={styles.qrLegend}>{view.verifactu.legend}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

function Parties({ view }: { view: InvoiceView }) {
  return (
    <View style={styles.parties}>
      {[view.issuer, view.client].map((party) => (
        <View key={party.heading} style={styles.party}>
          <Text style={styles.label}>{party.heading}</Text>
          <Text style={styles.partyName}>{party.name}</Text>
          {party.tradeName ? <Text style={styles.partyTradeName}>{party.tradeName}</Text> : null}
          <View style={styles.partyLines}>
            {party.lines.map((line, index) => (
              <Text key={index} style={styles.partyLine}>
                {line}
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function RectifiesItem({ entry, grow = false }: { entry: LabeledValue; grow?: boolean }) {
  return (
    <View style={grow ? styles.rectifiesReason : styles.rectifiesItem}>
      <Text style={styles.label}>{entry.label}</Text>
      <Text style={grow ? styles.rectifiesValue : [styles.rectifiesValue, styles.num]}>{entry.value}</Text>
    </View>
  );
}

function Rectifies({ rectifies }: { rectifies: NonNullable<InvoiceView["rectifies"]> }) {
  return (
    <View style={styles.rectifies} wrap={false}>
      <RectifiesItem entry={rectifies.number} />
      <RectifiesItem entry={rectifies.issuedOn} />
      <RectifiesItem entry={rectifies.reason} grow />
    </View>
  );
}

/** Presencia mínima que pide `minPresenceAhead` para "no separar de lo siguiente". */
const KEEP_WITH_NEXT = 10_000;

/**
 * Hueco vacío que salta de página si detrás no caben `points`: así un título no se queda
 * solo al pie de una página. (En el primer hijo de una vista, `minPresenceAhead` no actúa.)
 */
function KeepTogether({ points }: { points: number }) {
  return <View minPresenceAhead={points} />;
}

function LinesTable({ table, children }: { table: InvoiceView["table"]; children?: ReactNode }) {
  const { headers, rows } = table;
  return (
    <View style={styles.table}>
      {/* `fixed` dentro de la tabla: la cabecera se repite arriba de cada página que ocupa. */}
      <View style={styles.tableHead} fixed>
        <Text style={[styles.label, styles.colDescription]}>{headers.description}</Text>
        <Text style={[styles.label, styles.colQuantity]}>{headers.quantity}</Text>
        <Text style={[styles.label, styles.colUnitPrice]}>{headers.unitPrice}</Text>
        {headers.discount ? <Text style={[styles.label, styles.colDiscount]}>{headers.discount}</Text> : null}
        {headers.vat ? <Text style={[styles.label, styles.colVat]}>{headers.vat}</Text> : null}
        <Text style={[styles.label, styles.colBase]}>{headers.base}</Text>
      </View>
      {rows.map((row, index) => (
        // Una línea nunca se parte entre dos páginas, y la última no se separa de los totales.
        <View
          key={index}
          style={styles.row}
          wrap={false}
          minPresenceAhead={children && index === rows.length - 1 ? KEEP_WITH_NEXT : undefined}
        >
          <View style={styles.colDescription}>
            <Text style={styles.description}>{row.description}</Text>
            {row.detail ? <Text style={[styles.detail, styles.num]}>{row.detail}</Text> : null}
          </View>
          <Text style={[styles.cell, styles.num, styles.colQuantity]}>{row.quantity}</Text>
          <Text style={[styles.cell, styles.num, styles.colUnitPrice]}>{row.unitPrice}</Text>
          {headers.discount ? <Text style={[styles.cell, styles.num, styles.colDiscount]}>{row.discount}</Text> : null}
          {headers.vat ? <Text style={[styles.cell, styles.num, styles.colVat]}>{row.vat}</Text> : null}
          <Text style={[styles.cellBase, styles.num, styles.colBase]}>{row.base}</Text>
        </View>
      ))}
      {children}
    </View>
  );
}

function Summary({ view }: { view: InvoiceView }) {
  const { payment, totals } = view;
  return (
    // Pago y totales van juntos y nunca se separan de página.
    <View style={styles.summary} wrap={false}>
      <View style={styles.payment}>
        {payment ? (
          <>
            <Text style={styles.label}>{payment.title}</Text>
            {payment.rows.map((row) => (
              <View key={row.label} style={styles.paymentRow}>
                <Text style={styles.paymentLabel}>{row.label}</Text>
                <Text style={[styles.paymentValue, styles.num]}>{row.value}</Text>
              </View>
            ))}
          </>
        ) : null}
      </View>
      <View style={styles.totals}>
        {totals.rows.map((row, index) => (
          <View key={index} style={styles.totalRow}>
            <View>
              <Text style={styles.totalLabel}>{row.label}</Text>
              {row.hint ? <Text style={[styles.totalHint, styles.num]}>{row.hint}</Text> : null}
            </View>
            <Text style={[styles.totalValue, styles.num]}>{row.value}</Text>
          </View>
        ))}
        <View style={styles.grandTotal}>
          <Text style={styles.grandTotalLabel}>{totals.total.label}</Text>
          <Text style={[styles.grandTotalValue, styles.num]}>{totals.total.value}</Text>
        </View>
      </View>
    </View>
  );
}

/** Tamaño de la marca de borrador para que quepa entera en diagonal, centrada en la página. */
function watermarkStyle(mark: string) {
  const fontSize = Math.min(110, Math.floor(720 / Math.max(mark.length, 1)));
  return { fontSize, top: (A4_HEIGHT - fontSize) / 2 };
}

function InvoiceLayout({ view }: { view: InvoiceView }) {
  return (
    <Document
      title={view.title}
      author={view.author}
      subject={view.runningHeader}
      creator={brand.product}
      producer={brand.product}
      language={view.language}
    >
      <Page size="A4" style={styles.page}>
        {view.draft ? (
          <Text style={[styles.watermark, watermarkStyle(view.draft.mark)]} fixed>
            {view.draft.mark}
          </Text>
        ) : null}
        <Text
          style={styles.runningHeader}
          fixed
          render={({ pageNumber }) => (pageNumber > 1 ? view.runningHeader : "")}
        />

        <View style={styles.content}>
          <Header view={view} />
          <Parties view={view} />
          {view.rectifies ? <Rectifies rectifies={view.rectifies} /> : null}
          <KeepTogether points={72} />
          {/* Los totales van dentro de la tabla para arrastrar la última línea si saltan de página. */}
          <LinesTable table={view.table}>
            <Summary view={view} />
          </LinesTable>

          {view.legalNotes ? (
            <View style={styles.block} wrap={false}>
              <Text style={styles.label}>{view.legalNotes.title}</Text>
              {view.legalNotes.items.map((item, index) => (
                <Text key={index} style={styles.legalNote}>
                  {item}
                </Text>
              ))}
            </View>
          ) : null}
          {view.notes ? (
            <>
              <KeepTogether points={48} />
              <View style={styles.block}>
                <Text style={styles.label}>{view.notes.title}</Text>
                <Text style={styles.notes}>{view.notes.text}</Text>
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.footer} fixed>
          <Text style={[styles.footerText, styles.footerRegistry]}>{view.footer.registryInfo ?? ""}</Text>
          <Text
            style={[styles.footerText, styles.num]}
            render={({ pageNumber, totalPages }) => view.footer.pageLabel(pageNumber, totalPages)}
          />
        </View>
      </Page>
    </Document>
  );
}

/**
 * Documento react-pdf de una factura (borrador o emitida, ordinaria o rectificativa). Solo
 * en el servidor: las fuentes y el logo se leen del disco.
 */
export function InvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  registerPdfFonts();
  return <InvoiceLayout view={buildInvoiceView(data)} />;
}

/**
 * El mismo documento como elemento listo para `renderToBuffer`. Resuelve los datos antes de
 * entrar en React, así que un dato que falte lanza aquí y no a mitad del render.
 */
export function createInvoiceDocument(data: InvoiceDocumentData): ReactElement<DocumentProps> {
  registerPdfFonts();
  return <InvoiceLayout view={buildInvoiceView(data)} />;
}
