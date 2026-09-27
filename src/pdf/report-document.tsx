import type { ReactElement } from "react";
import { Document, Image, Link, Page, StyleSheet, Text, View, type DocumentProps } from "@react-pdf/renderer";
import { brand } from "@/brand";
import type { ClientMonthReport } from "@/domain/reports";
import { logoPath, PDF_FONT_STACK, registerPdfFonts } from "./assets";
import {
  buildReportView,
  type ReportInvoiceHeaders,
  type ReportInvoiceRowView,
  type ReportItemView,
  type ReportView,
  type ReportWebView,
} from "./report-view-model";

// Plantilla del informe mensual: el mismo sistema que la factura y el presupuesto (A4 blanco,
// Manrope, etiquetas espaciadas, filetes finos y los colores de `brand.ts`), con secciones limpias
// y un gráfico de barras de las visitas por canal hecho con rectángulos de react-pdf. Nada de
// verdes y rojos para subir o bajar: el informe cuenta, no juzga.

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
  bar: brand.palette.blueBright,
  barPrevious: mix(brand.palette.black, 0.16),
  track: mix(brand.palette.black, 0.04),
  paper: brand.palette.white,
};

const MARGIN_X = 50;

// El PNG del logo (900 × 220 px) lleva margen blanco: el trazo ocupa x 105–835 e y 42–151.
const LOGO_WIDTH = 132;
const LOGO_HEIGHT = LOGO_WIDTH * (220 / 900);
const LOGO_INK = { left: 105 / 900, top: 42 / 220, bottom: 151 / 220 };

const INVOICE_COLUMN = { date: 62, due: 70, amount: 82, status: 74 };
const QUERY_COLUMN = { clicks: 48, previous: 70, position: 74 };

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
    marginTop: 28,
    fontWeight: 700,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  headline: { ...textSize(26, 1.15), marginTop: 4, fontWeight: 800, letterSpacing: -0.6 },
  subtitle: { ...textSize(11, 1.3), marginTop: 4, fontWeight: 600, color: color.text },
  notice: { ...textSize(7.5, 1.3), marginTop: 3, color: color.muted },
  dates: { flexDirection: "row", marginTop: 16 },
  dateItem: { marginRight: 30 },
  dateValue: { ...textSize(9, 1.3), marginTop: 3, fontWeight: 600 },

  summary: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: color.accentSoft,
    borderLeftWidth: 2,
    borderLeftColor: color.accent,
  },
  summaryItem: { marginRight: 28 },
  summaryValue: { ...textSize(13, 1.25), marginTop: 3, fontWeight: 800, letterSpacing: -0.2 },

  section: { marginTop: 22 },
  sectionTitle: {
    ...textSize(7.5, 1.3),
    fontWeight: 700,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: color.accent,
  },
  sectionSubtitle: { marginTop: 4, color: color.text },
  groupTitle: { marginTop: 10 },
  list: { marginTop: 4 },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: color.hairline,
  },
  itemMain: { flex: 1, paddingRight: 16 },
  itemTitle: { fontWeight: 600 },
  itemDetail: { ...textSize(7.5, 1.35), marginTop: 2, color: color.muted },
  itemLink: { color: color.accent, textDecoration: "none" },
  itemAside: { ...textSize(7.5, 1.35), width: 86, textAlign: "right", color: color.muted },
  // Una sola línea: el nombre a la izquierda y el detalle a la derecha (servicios).
  itemInline: { alignItems: "baseline" },
  itemInlineDetail: { ...textSize(7.5, 1.35), width: "58%", textAlign: "right", color: color.muted },
  status: {
    ...textSize(6.5, 1.2),
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: color.accent,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 6,
    backgroundColor: color.accentSoft,
  },
  empty: { marginTop: 6, color: color.muted },
  more: { ...textSize(7.5, 1.35), marginTop: 6, color: color.muted },

  tiles: { flexDirection: "row", marginTop: 12 },
  tile: {
    flex: 1,
    marginRight: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: color.rule,
  },
  tileLast: { marginRight: 0 },
  // Dos líneas de etiqueta siempre: así las cifras de todas las fichas quedan a la misma altura.
  tileLabel: { minHeight: 17 },
  tileValue: { ...textSize(16, 1.15), marginTop: 3, fontWeight: 800, letterSpacing: -0.3 },
  tileDelta: { ...textSize(7.5, 1.3), marginTop: 5, fontWeight: 700, color: color.accent },
  tileCaption: { ...textSize(7, 1.3), color: color.muted },

  chart: { marginTop: 18 },
  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 },
  legend: { flexDirection: "row", alignItems: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", marginLeft: 12 },
  legendSwatch: { width: 7, height: 7, borderRadius: 1.5, marginRight: 4 },
  legendText: { ...textSize(7, 1.2), color: color.muted },
  barRow: { flexDirection: "row", alignItems: "center", paddingVertical: 3.5 },
  barLabel: { width: 118, paddingRight: 8, color: color.text },
  barTrack: { flex: 1, paddingVertical: 1, backgroundColor: color.track, borderRadius: 2 },
  bar: { height: 8, borderRadius: 2, backgroundColor: color.bar },
  barPrevious: { height: 3, marginTop: 1.5, borderRadius: 1.5, backgroundColor: color.barPrevious },
  barValue: { width: 44, textAlign: "right", fontWeight: 700 },
  barDelta: { ...textSize(7.5, 1.3), width: 46, textAlign: "right", color: color.muted },

  table: { marginTop: 6 },
  tableHead: {
    flexDirection: "row",
    paddingBottom: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: color.rule,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: color.hairline,
  },
  cell: { color: color.text },
  cellStrong: { fontWeight: 600 },
  colFlex: { flex: 1, paddingRight: 12 },
  colRight: { textAlign: "right" },
  subTitle: { marginTop: 14 },

  totalBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: color.accent,
    color: color.paper,
  },
  totalLabel: { ...textSize(7.5, 1.2), fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" },
  totalValue: { ...textSize(12, 1.2), fontWeight: 800, letterSpacing: -0.2 },
  allPaid: { marginTop: 10, fontWeight: 600, color: color.text },
  notes: { marginTop: 10 },
  note: { ...textSize(7, 1.4), color: color.muted },

  hoursTotal: {
    flexDirection: "row",
    paddingVertical: 6,
    borderTopWidth: 0.75,
    borderTopColor: color.rule,
  },

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
});

/** Hueco vacío que salta de página si detrás no caben `points` (un título no se queda solo al pie). */
function KeepTogether({ points }: { points: number }) {
  return <View minPresenceAhead={points} />;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <>
      <KeepTogether points={90} />
      <Text style={styles.sectionTitle}>{children}</Text>
    </>
  );
}

function Header({ view }: { view: ReportView }) {
  return (
    <View>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf no tiene atributo alt */}
      <Image src={logoPath()} style={styles.logo} />
      <Text style={styles.docType}>{view.documentType}</Text>
      <Text style={styles.headline}>{view.headline}</Text>
      <Text style={styles.subtitle}>{view.subtitle}</Text>
      {view.notice ? <Text style={styles.notice}>{view.notice}</Text> : null}
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

function Summary({ items }: { items: ReportView["summary"] }) {
  return (
    <View style={styles.summary} wrap={false}>
      {items.map((item) => (
        <View key={item.label} style={styles.summaryItem}>
          <Text style={styles.label}>{item.label}</Text>
          <Text style={[styles.summaryValue, styles.num]}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

function InlineItems({ items }: { items: ReportItemView[] }) {
  return (
    <View style={styles.list}>
      {items.map((item, index) => (
        <View key={index} style={[styles.item, styles.itemInline]} wrap={false}>
          <Text style={[styles.itemTitle, styles.itemMain]}>{item.title}</Text>
          {item.detail ? <Text style={[styles.itemInlineDetail, styles.num]}>{item.detail}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Items({ items, asStatus = false }: { items: ReportItemView[]; asStatus?: boolean }) {
  return (
    <View style={styles.list}>
      {items.map((item, index) => (
        <View key={index} style={styles.item} wrap={false}>
          <View style={styles.itemMain}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {item.detail ? (
              item.link ? (
                <Link src={item.link} style={[styles.itemDetail, styles.itemLink]}>
                  {item.detail}
                </Link>
              ) : (
                <Text style={styles.itemDetail}>{item.detail}</Text>
              )
            ) : null}
          </View>
          {item.aside ? (
            asStatus ? (
              <View>
                <Text style={styles.status}>{item.aside}</Text>
              </View>
            ) : (
              <Text style={[styles.itemAside, styles.num]}>{item.aside}</Text>
            )
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Groups({ groups, inline = false }: { groups: { title: string | null; items: ReportItemView[] }[]; inline?: boolean }) {
  return (
    <>
      {groups.map((group, index) => (
        <View key={group.title ?? index}>
          <KeepTogether points={48} />
          {group.title ? <Text style={[styles.label, styles.groupTitle]}>{group.title}</Text> : null}
          {inline ? <InlineItems items={group.items} /> : <Items items={group.items} />}
        </View>
      ))}
    </>
  );
}

function Tiles({ tiles }: { tiles: ReportWebView["tiles"] }) {
  return (
    <View style={styles.tiles} wrap={false}>
      {tiles.map((tile, index) => (
        <View key={tile.label} style={index === tiles.length - 1 ? [styles.tile, styles.tileLast] : styles.tile}>
          <Text style={[styles.label, styles.tileLabel]}>{tile.label}</Text>
          <Text style={[styles.tileValue, styles.num]}>{tile.value}</Text>
          {tile.delta ? <Text style={[styles.tileDelta, styles.num]}>{tile.delta}</Text> : null}
          {tile.caption ? <Text style={styles.tileCaption}>{tile.caption}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/** Barras horizontales: la del mes, llena; la del mes anterior, fina debajo. */
function ChannelChart({ channels }: { channels: NonNullable<ReportWebView["channels"]> }) {
  const width = (ratio: number) => `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  return (
    <View style={styles.chart} wrap={false}>
      <View style={styles.chartHead}>
        <Text style={styles.label}>{channels.title}</Text>
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: color.bar }]} />
            <Text style={styles.legendText}>{channels.legend.current}</Text>
          </View>
          {channels.legend.previous ? (
            <View style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: color.barPrevious }]} />
              <Text style={styles.legendText}>{channels.legend.previous}</Text>
            </View>
          ) : null}
        </View>
      </View>
      {channels.rows.map((row) => (
        <View key={row.label} style={styles.barRow}>
          <Text style={styles.barLabel}>{row.label}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.bar, { width: width(row.ratio) }]} />
            {row.previousRatio !== null ? <View style={[styles.barPrevious, { width: width(row.previousRatio) }]} /> : null}
          </View>
          <Text style={[styles.barValue, styles.num]}>{row.value}</Text>
          <Text style={[styles.barDelta, styles.num]}>{row.delta ?? ""}</Text>
        </View>
      ))}
    </View>
  );
}

function Queries({ queries }: { queries: NonNullable<ReportWebView["queries"]> }) {
  const { headers } = queries;
  return (
    <View style={styles.chart}>
      <KeepTogether points={60} />
      <Text style={styles.label}>{queries.title}</Text>
      <View style={styles.table}>
        <View style={styles.tableHead}>
          <Text style={[styles.label, styles.colFlex]}>{headers.query}</Text>
          <Text style={[styles.label, styles.colRight, { width: QUERY_COLUMN.clicks }]}>{headers.clicks}</Text>
          {headers.previous ? <Text style={[styles.label, styles.colRight, { width: QUERY_COLUMN.previous }]}>{headers.previous}</Text> : null}
          <Text style={[styles.label, styles.colRight, { width: QUERY_COLUMN.position }]}>{headers.position}</Text>
        </View>
        {queries.rows.map((row, index) => (
          <View key={index} style={styles.row} wrap={false}>
            <Text style={[styles.cellStrong, styles.colFlex]}>{row.query}</Text>
            <Text style={[styles.cellStrong, styles.num, styles.colRight, { width: QUERY_COLUMN.clicks }]}>{row.clicks}</Text>
            {row.previous !== null ? (
              <Text style={[styles.cell, styles.num, styles.colRight, { width: QUERY_COLUMN.previous }]}>{row.previous}</Text>
            ) : null}
            <Text style={[styles.cell, styles.num, styles.colRight, { width: QUERY_COLUMN.position }]}>{row.position}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Web({ web }: { web: ReportWebView }) {
  return (
    <View style={styles.section}>
      <SectionTitle>{web.title}</SectionTitle>
      <Text style={styles.sectionSubtitle}>{web.subtitle}</Text>
      {web.tiles.length > 0 ? <Tiles tiles={web.tiles} /> : null}
      {web.channels ? <ChannelChart channels={web.channels} /> : null}
      {web.queries ? <Queries queries={web.queries} /> : null}
      <View style={styles.notes} wrap={false}>
        {web.notes.map((note, index) => (
          <Text key={index} style={styles.note}>
            {note}
          </Text>
        ))}
      </View>
    </View>
  );
}

function InvoiceTable({
  headers,
  rows,
  amount,
}: {
  headers: ReportInvoiceHeaders;
  rows: ReportInvoiceRowView[];
  /** Qué importe se enseña: el total (las del mes) o lo pendiente (las de antes). */
  amount: "total" | "outstanding";
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHead}>
        <Text style={[styles.label, styles.colFlex]}>{headers.number}</Text>
        <Text style={[styles.label, { width: INVOICE_COLUMN.date }]}>{headers.date}</Text>
        <Text style={[styles.label, { width: INVOICE_COLUMN.due }]}>{headers.due}</Text>
        <Text style={[styles.label, styles.colRight, { width: INVOICE_COLUMN.amount }]}>{headers[amount]}</Text>
        <Text style={[styles.label, styles.colRight, { width: INVOICE_COLUMN.status }]}>{headers.status}</Text>
      </View>
      {rows.map((row, index) => (
        <View key={index} style={styles.row} wrap={false}>
          <Text style={[styles.cellStrong, styles.num, styles.colFlex]}>{row.number}</Text>
          <Text style={[styles.cell, styles.num, { width: INVOICE_COLUMN.date }]}>{row.date}</Text>
          <Text style={[styles.cell, styles.num, { width: INVOICE_COLUMN.due }]}>{row.due}</Text>
          <Text style={[styles.cellStrong, styles.num, styles.colRight, { width: INVOICE_COLUMN.amount }]}>{row[amount]}</Text>
          <Text style={[styles.cell, styles.colRight, { width: INVOICE_COLUMN.status }]}>{row.status}</Text>
        </View>
      ))}
    </View>
  );
}

/** Filas a partir de las que la facturación puede partirse entre dos hojas. */
const INVOICES_KEEP_TOGETHER = 12;

function Invoices({ invoices }: { invoices: ReportView["invoices"] }) {
  const rows = invoices.issued.rows.length + (invoices.pending?.rows.length ?? 0);
  // Si es corta, la sección va entera en una hoja: no se separa lo pendiente de su total.
  return (
    <View style={styles.section} wrap={rows > INVOICES_KEEP_TOGETHER}>
      <SectionTitle>{invoices.title}</SectionTitle>
      <Text style={[styles.label, styles.subTitle]}>{invoices.issued.title}</Text>
      {invoices.issued.empty ? (
        <Text style={styles.empty}>{invoices.issued.empty}</Text>
      ) : (
        <InvoiceTable headers={invoices.headers} rows={invoices.issued.rows} amount="total" />
      )}
      {invoices.pending ? (
        <>
          <KeepTogether points={60} />
          <Text style={[styles.label, styles.subTitle]}>{invoices.pending.title}</Text>
          <InvoiceTable headers={invoices.headers} rows={invoices.pending.rows} amount="outstanding" />
        </>
      ) : null}
      {invoices.total ? (
        <View style={styles.totalBox} wrap={false}>
          <Text style={styles.totalLabel}>{invoices.total.label}</Text>
          <Text style={[styles.totalValue, styles.num]}>{invoices.total.value}</Text>
        </View>
      ) : null}
      {invoices.allPaid ? <Text style={styles.allPaid}>{invoices.allPaid}</Text> : null}
      <Text style={[styles.note, { marginTop: 8 }]}>{invoices.note}</Text>
    </View>
  );
}

function Hours({ hours }: { hours: NonNullable<ReportView["hours"]> }) {
  return (
    <View style={styles.section} wrap={false}>
      <Text style={styles.sectionTitle}>{hours.title}</Text>
      <View style={styles.table}>
        {hours.rows.map((row) => (
          <View key={row.label} style={styles.row}>
            <Text style={[styles.cell, styles.colFlex]}>{row.label}</Text>
            <Text style={[styles.cellStrong, styles.num, styles.colRight, { width: INVOICE_COLUMN.amount }]}>{row.value}</Text>
          </View>
        ))}
        <View style={styles.hoursTotal}>
          <Text style={[styles.cellStrong, styles.colFlex]}>{hours.total.label}</Text>
          <Text style={[styles.cellStrong, styles.num, styles.colRight, { width: INVOICE_COLUMN.amount }]}>{hours.total.value}</Text>
        </View>
      </View>
    </View>
  );
}

function ReportLayout({ view }: { view: ReportView }) {
  const { workDone, nextSteps, deliverables, web, services, hours, invoices } = view;
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
        <Text style={styles.runningHeader} fixed render={({ pageNumber }) => (pageNumber > 1 ? view.runningHeader : "")} />

        <View style={styles.content}>
          <Header view={view} />
          <Summary items={view.summary} />

          <View style={styles.section}>
            <SectionTitle>{workDone.title}</SectionTitle>
            {workDone.empty ? <Text style={styles.empty}>{workDone.empty}</Text> : <Groups groups={workDone.groups} />}
          </View>

          {hours ? <Hours hours={hours} /> : null}

          <View style={styles.section}>
            <SectionTitle>{nextSteps.title}</SectionTitle>
            {nextSteps.empty ? <Text style={styles.empty}>{nextSteps.empty}</Text> : <Items items={nextSteps.items} asStatus />}
            {nextSteps.more ? <Text style={styles.more}>{nextSteps.more}</Text> : null}
          </View>

          {deliverables ? (
            <View style={styles.section}>
              <SectionTitle>{deliverables.title}</SectionTitle>
              <Items items={deliverables.items} />
            </View>
          ) : null}

          {web ? <Web web={web} /> : null}

          {services ? (
            <View style={styles.section}>
              <SectionTitle>{services.title}</SectionTitle>
              <Groups groups={services.groups} inline />
            </View>
          ) : null}

          <Invoices invoices={invoices} />
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{view.footer.text}</Text>
          <Text
            style={[styles.footerText, styles.num]}
            render={({ pageNumber, totalPages }) => view.footer.pageLabel(pageNumber, totalPages)}
          />
        </View>
      </Page>
    </Document>
  );
}

/** Documento react-pdf del informe. Solo en el servidor: las fuentes y el logo se leen del disco. */
export function ReportDocument({ report }: { report: ClientMonthReport }) {
  registerPdfFonts();
  return <ReportLayout view={buildReportView(report)} />;
}

/** El mismo documento como elemento listo para `renderToBuffer` (los datos se resuelven antes de React). */
export function createReportDocument(report: ClientMonthReport): ReactElement<DocumentProps> {
  registerPdfFonts();
  return <ReportLayout view={buildReportView(report)} />;
}
