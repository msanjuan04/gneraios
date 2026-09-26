import type { ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View, type DocumentProps } from "@react-pdf/renderer";
import { brand } from "@/brand";
import { logoPath, PDF_FONT_STACK, registerPdfFonts } from "./assets";
import type { QuoteDocumentData } from "./quote-types";
import { buildQuoteView, type QuotePlanRowView, type QuoteTableView, type QuoteTotalsView, type QuoteView } from "./quote-view-model";

// Plantilla de presupuesto (ARCHITECTURE.md §9.3): la misma que la factura —A4 blanco, Manrope,
// etiquetas espaciadas, filetes finos, el total destacado y los colores de `brand.ts`— con lo
// puntual (y su plan de pagos), lo recurrente y lo de uso en secciones separadas, un resumen
// arriba («1.500 € + 350 €/mes»), la validez y el bloque de aceptación.

/** Tinta `hex` al `amount` sobre el blanco del papel (la misma mezcla que la factura). */
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
const MARGIN_X = 50;

// El PNG del logo (900 × 220 px) lleva margen blanco: el trazo ocupa x 105–835 e y 42–151.
const LOGO_WIDTH = 132;
const LOGO_HEIGHT = LOGO_WIDTH * (220 / 900);
const LOGO_INK = { left: 105 / 900, top: 42 / 220, bottom: 151 / 220 };

const COLUMN = { quantity: 50, unitPrice: 70, discount: 40, vat: 38, amount: 92 };
const PLAN_COLUMN = { when: 110, percent: 44, amount: 80, total: 80 };

const tabular = { fontFeatureSettings: ["tnum" as const] };

/** Tamaño e interlineado siempre juntos (ver invoice-document.tsx: react-pdf 4.9 los multiplica). */
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
  subtitle: { ...textSize(11, 1.3), marginTop: 4, fontWeight: 600, color: color.text },
  draftNotice: { ...textSize(7.5, 1.3), marginTop: 3, color: color.muted },
  dates: { flexDirection: "row", marginTop: 18 },
  dateItem: { marginRight: 30 },
  dateValue: { ...textSize(9, 1.3), marginTop: 3, fontWeight: 600 },

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

  // El resumen va en el mismo recuadro suave que la factura rectificada.
  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    marginTop: 22,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: color.accentSoft,
    borderLeftWidth: 2,
    borderLeftColor: color.accent,
  },
  summaryItem: { marginRight: 28 },
  summaryValue: { ...textSize(11, 1.3), marginTop: 3, fontWeight: 700 },
  summaryNote: { ...textSize(7, 1.3), marginLeft: "auto", color: color.muted },

  section: { marginTop: 26 },
  sectionTitle: {
    ...textSize(7.5, 1.3),
    fontWeight: 700,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  table: { marginTop: 8 },
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
  colAmount: { width: COLUMN.amount, textAlign: "right" },
  description: { fontWeight: 600 },
  detail: { ...textSize(7.5, 1.35), marginTop: 2, color: color.muted },
  cell: { color: color.text },
  cellAmount: { fontWeight: 600 },
  note: { ...textSize(7.5, 1.4), marginTop: 6, color: color.muted },

  totalsRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totalsGroup: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
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
  grandTotalValue: { ...textSize(13, 1.2), fontWeight: 800, letterSpacing: -0.2 },

  plan: { marginTop: 20 },
  planHead: {
    flexDirection: "row",
    marginTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: color.rule,
  },
  planLabel: { flex: 1, paddingRight: 16 },
  planWhen: { width: PLAN_COLUMN.when },
  planPercent: { width: PLAN_COLUMN.percent, textAlign: "right" },
  planAmount: { width: PLAN_COLUMN.amount, textAlign: "right" },
  planTotal: { width: PLAN_COLUMN.total, textAlign: "right" },

  block: { marginTop: 22 },
  legalNote: { ...textSize(7.5, 1.4), marginTop: 4, color: color.text },
  notes: { marginTop: 4, color: color.text },
  validity: { marginTop: 4, fontWeight: 600 },

  acceptance: {
    marginTop: 26,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: color.hairline,
  },
  acceptanceText: { marginTop: 4, color: color.text },
  acceptanceFields: { flexDirection: "row", marginTop: 34 },
  acceptanceField: {
    flex: 1,
    marginRight: 18,
    paddingTop: 5,
    borderTopWidth: 0.75,
    borderTopColor: color.rule,
  },
  acceptanceFieldLast: { marginRight: 0 },
  accepted: { ...textSize(11, 1.3), marginTop: 6, fontWeight: 700, color: color.accent },

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

/** Presencia mínima que pide `minPresenceAhead` para "no separar de lo siguiente". */
const KEEP_WITH_NEXT = 10_000;

/** Hueco vacío que salta de página si detrás no caben `points` (un título no se queda solo al pie). */
function KeepTogether({ points }: { points: number }) {
  return <View minPresenceAhead={points} />;
}

function Header({ view }: { view: QuoteView }) {
  return (
    <View>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf no tiene atributo alt */}
      <Image src={logoPath()} style={styles.logo} />
      <Text style={styles.docType}>{view.documentType}</Text>
      <Text style={view.draft ? [styles.headline, styles.headlineDraft] : styles.headline}>{view.headline}</Text>
      {view.subtitle ? <Text style={styles.subtitle}>{view.subtitle}</Text> : null}
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
  );
}

function Parties({ view }: { view: QuoteView }) {
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

function Summary({ summary }: { summary: NonNullable<QuoteView["summary"]> }) {
  return (
    <View style={styles.summary} wrap={false}>
      {summary.items.map((item) => (
        <View key={item.label} style={styles.summaryItem}>
          <Text style={styles.label}>{item.label}</Text>
          <Text style={[styles.summaryValue, styles.num]}>{item.value}</Text>
        </View>
      ))}
      <Text style={styles.summaryNote}>{summary.note}</Text>
    </View>
  );
}

function LinesTable({ table, keepLastWithNext = false }: { table: QuoteTableView; keepLastWithNext?: boolean }) {
  const { headers, rows } = table;
  return (
    <View style={styles.table}>
      <View style={styles.tableHead} fixed>
        <Text style={[styles.label, styles.colDescription]}>{headers.description}</Text>
        <Text style={[styles.label, styles.colQuantity]}>{headers.quantity}</Text>
        <Text style={[styles.label, styles.colUnitPrice]}>{headers.unitPrice}</Text>
        {headers.discount ? <Text style={[styles.label, styles.colDiscount]}>{headers.discount}</Text> : null}
        {headers.vat ? <Text style={[styles.label, styles.colVat]}>{headers.vat}</Text> : null}
        <Text style={[styles.label, styles.colAmount]}>{headers.amount}</Text>
      </View>
      {rows.map((row, index) => (
        // Una línea nunca se parte entre dos páginas; la última no se separa de sus totales.
        <View
          key={index}
          style={styles.row}
          wrap={false}
          minPresenceAhead={keepLastWithNext && index === rows.length - 1 ? KEEP_WITH_NEXT : undefined}
        >
          <View style={styles.colDescription}>
            <Text style={styles.description}>{row.description}</Text>
            {row.detail ? <Text style={[styles.detail, styles.num]}>{row.detail}</Text> : null}
          </View>
          <Text style={[styles.cell, styles.num, styles.colQuantity]}>{row.quantity}</Text>
          <Text style={[styles.cell, styles.num, styles.colUnitPrice]}>{row.unitPrice}</Text>
          {headers.discount ? <Text style={[styles.cell, styles.num, styles.colDiscount]}>{row.discount}</Text> : null}
          {headers.vat ? <Text style={[styles.cell, styles.num, styles.colVat]}>{row.vat}</Text> : null}
          <Text style={[styles.cellAmount, styles.num, styles.colAmount]}>{row.amount}</Text>
        </View>
      ))}
    </View>
  );
}

function Totals({ totals }: { totals: QuoteTotalsView }) {
  return (
    <View style={styles.totals} wrap={false}>
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
  );
}

function PlanTable({ plan }: { plan: { title: string; headers: QuotePlanRowView; rows: QuotePlanRowView[] } }) {
  const { headers } = plan;
  return (
    <View style={styles.plan} wrap={false}>
      <Text style={styles.label}>{plan.title}</Text>
      <View style={styles.planHead}>
        <Text style={[styles.label, styles.planLabel]}>{headers.label}</Text>
        <Text style={[styles.label, styles.planWhen]}>{headers.when}</Text>
        <Text style={[styles.label, styles.planPercent]}>{headers.percent}</Text>
        <Text style={[styles.label, styles.planAmount]}>{headers.amount}</Text>
        <Text style={[styles.label, styles.planTotal]}>{headers.total}</Text>
      </View>
      {plan.rows.map((row, index) => (
        <View key={index} style={styles.row}>
          <Text style={[styles.description, styles.planLabel]}>{row.label}</Text>
          <Text style={[styles.cell, styles.num, styles.planWhen]}>{row.when}</Text>
          <Text style={[styles.cell, styles.num, styles.planPercent]}>{row.percent}</Text>
          <Text style={[styles.cellAmount, styles.num, styles.planAmount]}>{row.amount}</Text>
          <Text style={[styles.cell, styles.num, styles.planTotal]}>{row.total}</Text>
        </View>
      ))}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <>
      <KeepTogether points={96} />
      <Text style={styles.sectionTitle}>{children}</Text>
    </>
  );
}

function Acceptance({ acceptance }: { acceptance: QuoteView["acceptance"] }) {
  return (
    <View style={styles.acceptance} wrap={false}>
      <Text style={styles.label}>{acceptance.title}</Text>
      {acceptance.accepted ? <Text style={styles.accepted}>{acceptance.accepted}</Text> : null}
      {acceptance.text ? <Text style={styles.acceptanceText}>{acceptance.text}</Text> : null}
      {acceptance.fields.length > 0 ? (
        <View style={styles.acceptanceFields}>
          {acceptance.fields.map((field, index) => (
            <View
              key={field}
              style={index === acceptance.fields.length - 1 ? [styles.acceptanceField, styles.acceptanceFieldLast] : styles.acceptanceField}
            >
              <Text style={styles.label}>{field}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Tamaño de la marca de borrador para que quepa entera en diagonal, centrada en la página. */
function watermarkStyle(mark: string) {
  const fontSize = Math.min(110, Math.floor(720 / Math.max(mark.length, 1)));
  return { fontSize, top: (A4_HEIGHT - fontSize) / 2 };
}

function QuoteLayout({ view }: { view: QuoteView }) {
  const { oneOff, recurring, usage } = view;
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
        <Text style={styles.runningHeader} fixed render={({ pageNumber }) => (pageNumber > 1 ? view.runningHeader : "")} />

        <View style={styles.content}>
          <Header view={view} />
          <Parties view={view} />
          {view.summary ? <Summary summary={view.summary} /> : null}

          {oneOff ? (
            <View style={styles.section}>
              <SectionTitle>{oneOff.title}</SectionTitle>
              <LinesTable table={oneOff.table} keepLastWithNext />
              <View style={styles.totalsRow}>
                <Totals totals={oneOff.totals} />
              </View>
              {oneOff.plan ? <PlanTable plan={oneOff.plan} /> : null}
            </View>
          ) : null}

          {recurring ? (
            <View style={styles.section}>
              <SectionTitle>{recurring.title}</SectionTitle>
              <LinesTable table={recurring.table} keepLastWithNext />
              <View style={recurring.totals.length > 1 ? styles.totalsGroup : styles.totalsRow}>
                {recurring.totals.map((totals) => (
                  <Totals key={totals.total.label} totals={totals} />
                ))}
              </View>
            </View>
          ) : null}

          {usage ? (
            <View style={styles.section}>
              <SectionTitle>{usage.title}</SectionTitle>
              <LinesTable table={usage.table} />
              <Text style={styles.note}>{usage.note}</Text>
            </View>
          ) : null}

          {view.validity ? (
            <View style={styles.block} wrap={false}>
              <Text style={styles.label}>{view.validity.title}</Text>
              <Text style={styles.validity}>{view.validity.text}</Text>
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
          <Acceptance acceptance={view.acceptance} />
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

/** Documento react-pdf de un presupuesto. Solo en el servidor: las fuentes y el logo se leen del disco. */
export function QuoteDocument({ data }: { data: QuoteDocumentData }) {
  registerPdfFonts();
  return <QuoteLayout view={buildQuoteView(data)} />;
}

/**
 * El mismo documento como elemento listo para `renderToBuffer`. Resuelve los datos antes de
 * entrar en React, así que un dato que falte lanza aquí y no a mitad del render.
 */
export function createQuoteDocument(data: QuoteDocumentData): ReactElement<DocumentProps> {
  registerPdfFonts();
  return <QuoteLayout view={buildQuoteView(data)} />;
}
