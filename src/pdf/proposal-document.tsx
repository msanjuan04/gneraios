import type { ReactElement } from "react";
import { Document, Image, Page, StyleSheet, Text, View, type DocumentProps } from "@react-pdf/renderer";
import { brand } from "@/brand";
import { isotypePath, logoBlackPath, logoWhitePath, PDF_FONT_STACK, registerPdfFonts } from "./assets";
import { buildProposalView, type ProposalSection, type ProposalView } from "./proposal-view-model";
import type { QuoteDocumentData } from "./quote-types";

// La propuesta comercial: una portada oscura con el título y los precios, y debajo páginas blancas
// con el resumen, el alcance de cada opción numerado y las condiciones. Es la que se manda a quien
// pide algo; el presupuesto formal (quote-document.tsx) es el que se acepta y se factura.

const color = {
  dark: "#0b0b0c",
  darkSoft: "#17181a",
  onDark: "#ffffff",
  onDarkMuted: "#9a9ca0",
  rule: "#d8d9dc",
  ink: "#0b0b0c",
  text: "#33353a",
  muted: "#8a8c91",
  accent: brand.palette.blueDeep,
};

const MARGIN_X = 56;
const size = (fontSize: number, lineHeight = 1.4) => ({ fontSize, lineHeight });
const tabular = { fontFeatureSettings: ["tnum" as const] };

const styles = StyleSheet.create({
  cover: { backgroundColor: color.dark, color: color.onDark, fontFamily: PDF_FONT_STACK, paddingHorizontal: MARGIN_X, paddingTop: 70, paddingBottom: 54 },
  watermark: { position: "absolute", right: -120, bottom: 120, width: 520, height: 520, opacity: 0.1 },
  // El PNG lleva margen a la izquierda (el trazo empieza en x 105 de 900): se compensa para alinear con el texto.
  coverLogo: { width: 220, height: 220 * (220 / 900), marginLeft: -(220 * 105) / 900 },
  coverBody: { marginTop: 190 },
  kicker: { ...size(8, 1.4), letterSpacing: 3, color: color.onDarkMuted, fontWeight: 500 },
  coverTitle: { ...size(34, 1.12), fontWeight: 800, marginTop: 18, maxWidth: 440 },
  coverFor: { ...size(11, 1.4), color: color.onDarkMuted, marginTop: 18 },
  prices: { flexDirection: "row", gap: 24, marginTop: 190 },
  price: { flexGrow: 1, flexBasis: 0, borderTopWidth: 1, borderTopColor: "#5a5c61", paddingTop: 10 },
  priceLabel: { ...size(7, 1.4), letterSpacing: 2, color: color.onDarkMuted },
  priceName: { ...size(10.5, 1.3), fontWeight: 600, marginTop: 6 },
  priceAmount: { ...size(22, 1.1), fontWeight: 800, marginTop: 12, ...tabular },
  priceSuffix: { ...size(8, 1.2), color: color.onDarkMuted, fontWeight: 500 },
  coverFooter: { position: "absolute", left: MARGIN_X, right: MARGIN_X, bottom: 40, flexDirection: "row", justifyContent: "space-between" },
  coverFooterText: { ...size(7.5, 1.3), color: color.onDarkMuted },

  page: { backgroundColor: "#ffffff", color: color.ink, fontFamily: PDF_FONT_STACK, paddingTop: 48, paddingBottom: 70, paddingHorizontal: MARGIN_X },
  pageLogo: { width: 70, height: 70 * (220 / 900), marginLeft: -(70 * 105) / 900 },
  pageKicker: { ...size(7.5, 1.4), letterSpacing: 2.5, color: color.muted, marginTop: 26 },
  pageTitle: { ...size(23, 1.12), fontWeight: 800, marginTop: 10, maxWidth: 440 },
  paragraph: { ...size(10.5, 1.55), color: color.text, marginTop: 14 },
  priceBox: { backgroundColor: color.dark, color: color.onDark, flexDirection: "row", alignItems: "center", paddingVertical: 20, paddingHorizontal: 28, marginTop: 22 },
  priceBoxAmount: { ...size(26, 1.1), fontWeight: 800, ...tabular },
  priceBoxSuffix: { ...size(8, 1.2), color: color.onDarkMuted, marginLeft: 6, marginTop: 10 },
  priceBoxText: { ...size(8.5, 1.4), color: color.onDarkMuted, marginLeft: 28, flexGrow: 1, flexBasis: 0 },
  item: { flexDirection: "row", marginTop: 14 },
  itemNumber: { ...size(9, 1.3), fontWeight: 700, width: 44 },
  itemBody: { flexGrow: 1, flexBasis: 0 },
  itemTitle: { ...size(10, 1.3), fontWeight: 700 },
  point: { flexDirection: "row", marginTop: 3 },
  bullet: { ...size(9, 1.4), color: color.muted, width: 14 },
  pointText: { ...size(9, 1.45), color: color.text, flexGrow: 1, flexBasis: 0 },
  tableTitle: { ...size(7.5, 1.3), letterSpacing: 1.5, fontWeight: 700, marginTop: 26, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: color.ink },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 0.7, borderBottomColor: color.rule },
  rowText: { ...size(9.5, 1.35), color: color.text },
  rowAmount: { ...size(9.5, 1.35), fontWeight: 700, ...tabular },
  note: { borderLeftWidth: 3, borderLeftColor: color.muted, paddingLeft: 14, marginTop: 14 },
  noteText: { ...size(9.5, 1.5), color: color.text },
  footer: { position: "absolute", left: MARGIN_X, right: MARGIN_X, bottom: 34, flexDirection: "row", justifyContent: "space-between" },
  footerText: { ...size(7.5, 1.3), color: color.muted },
  pageNumber: { ...size(7.5, 1.3), color: color.ink, fontWeight: 600 },
});

function PageFooter({ view }: { view: ProposalView }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{view.contactLine}</Text>
      <Text style={styles.pageNumber} render={({ pageNumber }) => String(pageNumber).padStart(2, "0")} />
    </View>
  );
}

function Section({ section }: { section: ProposalSection }) {
  return (
    <>
      <Text style={styles.pageKicker}>{section.kicker}</Text>
      <Text style={styles.pageTitle}>{section.title}</Text>
      <View style={styles.priceBox} wrap={false}>
        <Text style={styles.priceBoxAmount}>{section.price.amount}</Text>
        <Text style={styles.priceBoxSuffix}>{section.price.suffix}</Text>
        <View style={styles.priceBoxText}>
          {section.price.lines.map((line) => (
            <Text key={line} style={{ fontWeight: 700, color: color.onDark }}>
              {line}
            </Text>
          ))}
        </View>
      </View>
      {section.items.map((item) => (
        <View key={item.number} style={styles.item} wrap={false}>
          <Text style={styles.itemNumber}>{item.number}</Text>
          <View style={styles.itemBody}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {item.points.map((point) => (
              <View key={point} style={styles.point}>
                <Text style={styles.bullet}>◦</Text>
                <Text style={styles.pointText}>{point}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

export function ProposalDocument({ data }: { data: QuoteDocumentData }): ReactElement<DocumentProps> {
  registerPdfFonts();
  const view = buildProposalView(data);
  return (
    <Document title={view.title} author={brand.name} language={view.language}>
      {/* Portada */}
      <Page size="A4" style={styles.cover}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image no tiene alt */}
        <Image src={isotypePath()} style={styles.watermark} />
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={logoWhitePath()} style={styles.coverLogo} />
        <View style={styles.coverBody}>
          <Text style={styles.kicker}>{view.coverKicker}</Text>
          <Text style={styles.coverTitle}>{view.title}</Text>
          <Text style={styles.coverFor}>{view.preparedFor}</Text>
        </View>
        {view.prices.length > 0 && (
          <View style={styles.prices}>
            {view.prices.slice(0, 2).map((price) => (
              <View key={price.label + price.name} style={styles.price}>
                <Text style={styles.priceLabel}>{price.label}</Text>
                <Text style={styles.priceName}>{price.name}</Text>
                <Text style={styles.priceAmount}>
                  {price.amount} <Text style={styles.priceSuffix}>{price.suffix}</Text>
                </Text>
              </View>
            ))}
          </View>
        )}
        <View style={styles.coverFooter}>
          <Text style={styles.coverFooterText}>{view.footerLeft}</Text>
          <Text style={styles.coverFooterText}>{view.footerRight}</Text>
        </View>
      </Page>

      {/* Resumen */}
      {view.intro && (
        <Page size="A4" style={styles.page}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={logoBlackPath()} style={styles.pageLogo} />
          <Text style={styles.pageKicker}>{view.intro.kicker}</Text>
          <Text style={styles.pageTitle}>{view.intro.title}</Text>
          {view.intro.paragraphs.map((paragraph, index) => (
            <Text key={index} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
          {view.payments && (
            <>
              <Text style={styles.tableTitle}>{view.payments.title}</Text>
              {view.payments.rows.map((row) => (
                <View key={row.label + row.detail} style={styles.row} wrap={false}>
                  <Text style={styles.rowText}>
                    {row.label} · {row.detail}
                  </Text>
                  <Text style={styles.rowAmount}>{row.amount}</Text>
                </View>
              ))}
            </>
          )}
          <PageFooter view={view} />
        </Page>
      )}

      {/* El alcance de cada opción */}
      {view.sections.map((section) => (
        <Page key={section.kicker} size="A4" style={styles.page}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={logoBlackPath()} style={styles.pageLogo} />
          <Section section={section} />
          <PageFooter view={view} />
        </Page>
      ))}

      {/* Condiciones */}
      {view.conditions && (
        <Page size="A4" style={styles.page}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={logoBlackPath()} style={styles.pageLogo} />
          <Text style={styles.pageKicker}>{view.conditions.title}</Text>
          {view.conditions.lines.map((line) => (
            <View key={line} style={styles.note}>
              <Text style={styles.noteText}>{line}</Text>
            </View>
          ))}
          <PageFooter view={view} />
        </Page>
      )}
    </Document>
  );
}

export function createProposalDocument(data: QuoteDocumentData): ReactElement<DocumentProps> {
  return <ProposalDocument data={data} />;
}
