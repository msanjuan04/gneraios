// Campos que entiende cada importación y su mapeo automático por el título de la columna, con
// sinónimos en castellano, catalán e inglés y los nombres de las exportaciones que ya existen
// (la app `facturas`, gnerai-finance, Holded y Excel hechos a mano).

import { normalizeKey } from "./text";

export type ImportKind = "clients" | "invoices";

export const CLIENT_FIELDS = [
  "display_name",
  "legal_name",
  "tax_id",
  "address_line",
  "postal_code",
  "city",
  "province",
  "country",
  "sector",
  "website",
  "notes",
  "payment_terms_days",
  "language",
  "source",
  "owner",
  "external_id",
  "contact_name",
  "contact_role",
  "contact_email",
  "contact_phone",
] as const;

export const INVOICE_FIELDS = [
  "number",
  "issued_on",
  "operation_on",
  "due_on",
  "series",
  "issuer_tax_id",
  "kind",
  "rectifies_number",
  "rectification_reason",
  "client_name",
  "client_tax_id",
  "client_address",
  "client_postal_code",
  "client_city",
  "client_province",
  "client_country",
  "client_email",
  "description",
  "quantity",
  "unit_price",
  "discount",
  "line_amount",
  "billing_type",
  "period_start",
  "period_end",
  "vat_rate",
  "vat_amount",
  "vat_regime",
  "irpf_rate",
  "irpf_amount",
  "base",
  "total",
  "paid",
  "paid_on",
  "payment_method",
  "notes",
] as const;

export type ClientField = (typeof CLIENT_FIELDS)[number];
export type InvoiceField = (typeof INVOICE_FIELDS)[number];
export type ImportField = ClientField | InvoiceField;

/** Columna del fichero (índice) de cada campo. Un campo sin columna no está. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

/**
 * Sinónimos de cada campo. Se comparan normalizados (`normalizeKey`: minúsculas, sin acentos, "%"
 * como "pct", "€" como "eur" y cualquier otro signo como espacio), así que "iva_pct" es "iva pct".
 */
const CLIENT_SYNONYMS: Record<ClientField, readonly string[]> = {
  display_name: ["nombre", "nombre comercial", "cliente", "empresa", "nom", "nom comercial", "client", "name", "company", "customer", "display name", "marca", "denominacion"],
  legal_name: ["razon social", "nombre fiscal", "denominacion social", "rao social", "nom fiscal", "legal name", "business name", "company name", "titular"],
  tax_id: ["nif", "cif", "nif cif", "cif nif", "dni", "nie", "nif cliente", "cif cliente", "vat", "vat number", "vat id", "tax id", "nif iva", "numero fiscal", "identificacion fiscal", "id fiscal"],
  address_line: ["direccion", "domicilio", "direccion fiscal", "domicilio fiscal", "adreca", "address", "street", "calle"],
  postal_code: ["codigo postal", "cp", "c p", "cod postal", "codi postal", "postal code", "zip", "zip code", "postcode"],
  city: ["ciudad", "poblacion", "localidad", "municipio", "ciutat", "poblacio", "city", "town"],
  province: ["provincia", "provincia estado", "estado", "region", "state", "county"],
  country: ["pais", "country", "nacion", "codigo pais", "country code"],
  sector: ["sector", "actividad", "industria", "industry", "activitat", "tipo de negocio"],
  website: ["web", "sitio web", "pagina web", "website", "url", "dominio", "pagina"],
  notes: ["notas", "observaciones", "comentarios", "notes", "comments", "observacions"],
  payment_terms_days: ["plazo de pago", "dias de pago", "plazo pago", "vencimiento dias", "payment terms", "terminos de pago", "termini de pagament"],
  language: ["idioma", "language", "lengua", "idioma preferido", "llengua"],
  source: ["fuente", "origen", "canal", "fuente de adquisicion", "source", "lead source", "procedencia"],
  owner: ["responsable", "socio", "socio responsable", "comercial", "owner", "account manager", "gestor"],
  external_id: ["id", "codigo", "codigo cliente", "cod cliente", "ref", "referencia", "customer id", "client id", "id cliente", "codi"],
  contact_name: ["contacto", "persona de contacto", "nombre contacto", "nombre del contacto", "contact", "contact name", "contacte", "persona contacte", "interlocutor"],
  contact_role: ["cargo", "puesto", "rol", "carrec", "role", "position", "job title", "title"],
  contact_email: ["email", "e mail", "correo", "correo electronico", "mail", "email contacto", "correu", "correu electronic", "email address"],
  contact_phone: ["telefono", "tel", "movil", "telefono movil", "telf", "tlf", "telefon", "mobil", "phone", "mobile", "phone number"],
};

const INVOICE_SYNONYMS: Record<InvoiceField, readonly string[]> = {
  number: ["numero", "numero factura", "n factura", "no factura", "num factura", "num", "factura", "numero de factura", "invoice number", "invoice", "invoice no", "numero serie", "numero de serie", "invoice_number"],
  issued_on: ["fecha", "fecha factura", "fecha emision", "fecha de emision", "fecha de expedicion", "fecha expedicion", "data", "data factura", "data emissio", "data d emissio", "date", "invoice date", "issue date", "fechaemision", "fecha emisio"],
  operation_on: ["fecha operacion", "fecha de operacion", "fecha devengo", "data operacio", "operation date", "service date"],
  due_on: ["vencimiento", "fecha vencimiento", "fecha de vencimiento", "vence", "data venciment", "venciment", "due date", "due", "fechavencimiento"],
  series: ["serie", "series", "codigo serie"],
  issuer_tax_id: ["nif emisor", "cif emisor", "emisor", "emisor nif", "issuer", "issuer tax id", "nif empresa", "prefijo"],
  kind: ["tipo factura", "tipo de factura", "clase", "tipus factura", "invoice type", "rectificativa", "es rectificativa", "abono"],
  rectifies_number: ["factura rectificada", "rectifica a", "rectifica", "factura original", "rectifies", "original invoice", "factura rectificada numero"],
  rectification_reason: ["motivo rectificacion", "motivo de rectificacion", "motivo", "causa rectificacion", "motiu", "reason"],
  client_name: ["cliente", "nombre cliente", "razon social", "cliente nombre", "destinatario", "nombre destinatario", "client", "nom client", "customer", "customer name", "cliente razon social", "nombre"],
  client_tax_id: ["nif", "cif", "nif cif", "nif cliente", "cif cliente", "cliente nif", "dni", "nif destinatario", "vat", "vat number", "tax id", "customer tax id", "nif client"],
  client_address: ["direccion", "domicilio", "cliente direccion", "direccion cliente", "adreca", "address"],
  client_postal_code: ["codigo postal", "cp", "cliente cp", "cp cliente", "codi postal", "postal code", "zip"],
  client_city: ["ciudad", "poblacion", "localidad", "municipio", "cliente ciudad", "ciutat", "poblacio", "city"],
  client_province: ["provincia", "cliente provincia", "state", "region"],
  client_country: ["pais", "cliente pais", "country"],
  client_email: ["email", "cliente email", "email cliente", "correo", "correo electronico", "correu", "e mail", "mail"],
  description: ["concepto", "descripcion", "detalle", "servicio", "producto", "concepte", "descripcio", "description", "concept", "item", "lineas descripcion", "descripcion linea"],
  quantity: ["cantidad", "unidades", "uds", "ud", "unid", "quantitat", "quantity", "qty", "lineas cantidad", "cant"],
  unit_price: ["precio", "precio unitario", "p unitario", "precio unidad", "importe unitario", "preu", "preu unitari", "unit price", "price", "lineas precio", "precio_unitario", "pvp"],
  discount: ["descuento", "dto", "pct dto", "dto pct", "pct descuento", "descuento pct", "descompte", "discount", "discount pct"],
  line_amount: ["importe", "importe linea", "total linea", "subtotal linea", "base linea", "import", "import linia", "amount", "line total", "line amount", "importe neto linea"],
  billing_type: ["tipo de facturacion", "tipo facturacion", "periodicidad", "recurrencia", "tipo ingreso", "tipo de ingreso", "frecuencia", "periodicitat", "recurrence", "billing type", "frequency"],
  period_start: ["periodo desde", "desde", "inicio periodo", "fecha inicio", "periode des de", "period start", "from"],
  period_end: ["periodo hasta", "hasta", "fin periodo", "fecha fin", "periode fins", "period end", "to"],
  vat_rate: ["pct iva", "iva pct", "tipo iva", "tipo de iva", "porcentaje iva", "tipo impositivo", "iva tipo", "tipus iva", "pct vat", "vat pct", "vat rate", "tax rate", "porcentajeiva", "iva_pct"],
  vat_amount: ["iva", "cuota iva", "importe iva", "cuota de iva", "iva eur", "total iva", "iva repercutido", "cuota", "quota iva", "vat", "vat amount", "tax", "tax amount", "totales iva", "iva amount"],
  vat_regime: ["regimen iva", "regimen de iva", "regimen", "exencion", "causa exencion", "mencion legal", "regim iva", "vat regime", "tax regime"],
  irpf_rate: ["pct irpf", "irpf pct", "tipo irpf", "tipo retencion", "retencion pct", "pct retencion", "porcentaje irpf", "tipus irpf", "retencio pct", "withholding rate", "porcentajeirpf", "irpf_pct"],
  irpf_amount: ["irpf", "retencion", "importe irpf", "retencion irpf", "cuota irpf", "irpf eur", "total irpf", "retencio", "withholding", "totales irpf", "irpf amount"],
  base: ["base imponible", "base", "subtotal", "importe neto", "neto", "base imposable", "total base", "net", "net amount", "subtotal amount", "totales base", "base_imponible"],
  total: ["total", "total factura", "importe total", "total a cobrar", "total a pagar", "total eur", "total import", "total amount", "invoice total", "totales total", "liquido"],
  paid: ["cobrada", "pagada", "estado", "estado cobro", "cobrado", "status", "estat", "paid", "cobrat"],
  paid_on: ["fecha cobro", "fecha de cobro", "fecha pago", "fecha de pago", "cobrada el", "data cobrament", "data de cobrament", "paid on", "payment date", "paid date", "fecha_cobro"],
  payment_method: ["forma de pago", "forma pago", "metodo de pago", "metodo pago", "medio de pago", "forma de pagament", "payment method", "formapago", "forma_pago"],
  notes: ["notas", "observaciones", "comentarios", "notes", "observacions"],
};

export function fieldsFor(kind: ImportKind): readonly ImportField[] {
  return kind === "clients" ? CLIENT_FIELDS : INVOICE_FIELDS;
}

const normalizedSynonyms = new Map<string, readonly string[]>();

/** Sinónimos de un campo normalizados como los títulos (una sola vez). */
function synonymsFor(kind: ImportKind, field: ImportField): readonly string[] {
  const cacheKey = `${kind}:${field}`;
  let list = normalizedSynonyms.get(cacheKey);
  if (!list) {
    const raw = kind === "clients" ? CLIENT_SYNONYMS[field as ClientField] : INVOICE_SYNONYMS[field as InvoiceField];
    list = [...new Set((raw ?? []).map(normalizeKey))];
    normalizedSynonyms.set(cacheKey, list);
  }
  return list;
}

/** Título de la columna en la plantilla que se descarga (el primer sinónimo, legible). */
export const TEMPLATE_HEADERS: Record<ImportKind, readonly [ImportField, string][]> = {
  clients: [
    ["display_name", "Nombre"],
    ["legal_name", "Razón social"],
    ["tax_id", "NIF"],
    ["address_line", "Dirección"],
    ["postal_code", "Código postal"],
    ["city", "Ciudad"],
    ["province", "Provincia"],
    ["country", "País"],
    ["sector", "Sector"],
    ["website", "Web"],
    ["contact_name", "Contacto"],
    ["contact_role", "Cargo"],
    ["contact_email", "Email"],
    ["contact_phone", "Teléfono"],
    ["notes", "Notas"],
  ],
  invoices: [
    ["number", "Número"],
    ["issued_on", "Fecha"],
    ["due_on", "Vencimiento"],
    ["client_name", "Cliente"],
    ["client_tax_id", "NIF"],
    ["client_address", "Dirección"],
    ["client_postal_code", "Código postal"],
    ["client_city", "Ciudad"],
    ["client_country", "País"],
    ["description", "Concepto"],
    ["quantity", "Cantidad"],
    ["unit_price", "Precio"],
    ["line_amount", "Importe"],
    ["vat_rate", "% IVA"],
    ["irpf_rate", "% IRPF"],
    ["base", "Base imponible"],
    ["vat_amount", "Cuota IVA"],
    ["irpf_amount", "Retención IRPF"],
    ["total", "Total"],
    ["paid_on", "Fecha de cobro"],
    ["rectifies_number", "Factura rectificada"],
  ],
};

/** Clave de un título de columna para compararlo con los sinónimos. */
export function headerKey(header: string): string {
  return normalizeKey(header);
}

type Candidate = { field: ImportField; column: number; score: number };

function scoreMatch(header: string, synonym: string): number {
  if (header === synonym) return 1000 + synonym.length;
  // El título contiene el sinónimo como palabras enteras ("nif del cliente" contiene "nif").
  const padded = ` ${header} `;
  if (synonym.length >= 3 && padded.includes(` ${synonym} `)) return 500 + synonym.length * 10 - (header.length - synonym.length);
  return 0;
}

/**
 * Mapeo automático: cada campo a la columna cuyo título mejor coincide con alguno de sus
 * sinónimos (igualdad antes que "contiene"; a igualdad, el sinónimo más largo). Cada columna se
 * usa una sola vez y cada campo toma como mucho una.
 */
export function autoMapColumns(kind: ImportKind, headers: readonly string[]): ColumnMapping {
  const keys = headers.map(headerKey);
  const candidates: Candidate[] = [];
  for (const field of fieldsFor(kind)) {
    const synonyms = synonymsFor(kind, field);
    keys.forEach((key, column) => {
      if (key === "") return;
      let best = 0;
      for (const synonym of synonyms) best = Math.max(best, scoreMatch(key, synonym));
      if (best > 0) candidates.push({ field, column, score: best });
    });
  }
  // Mejor puntuación primero; a igualdad, el campo que aparece antes en la lista y la primera columna.
  const order = fieldsFor(kind);
  candidates.sort(
    (a, b) => b.score - a.score || order.indexOf(a.field) - order.indexOf(b.field) || a.column - b.column,
  );
  const mapping: ColumnMapping = {};
  const usedColumns = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== undefined || usedColumns.has(c.column)) continue;
    mapping[c.field] = c.column;
    usedColumns.add(c.column);
  }
  return mapping;
}

/** Campos imprescindibles que faltan en un mapeo (o grupos: "client" = nombre o NIF, "amount" = algún importe). */
export function missingRequired(kind: ImportKind, mapping: ColumnMapping): string[] {
  const has = (field: ImportField) => mapping[field] !== undefined;
  const missing: string[] = [];
  if (kind === "clients") {
    if (!has("display_name") && !has("legal_name")) missing.push("display_name");
    return missing;
  }
  if (!has("number")) missing.push("number");
  if (!has("issued_on")) missing.push("issued_on");
  if (!has("client_name") && !has("client_tax_id")) missing.push("client_name");
  if (!has("line_amount") && !has("unit_price") && !has("base")) missing.push("base");
  return missing;
}

/** Deja solo campos conocidos que apunten a columnas existentes (lo que llega del cliente no se da por bueno). */
export function sanitizeMapping(kind: ImportKind, mapping: Record<string, unknown>, columns: number): ColumnMapping {
  const out: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of fieldsFor(kind)) {
    const value = mapping[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= columns || used.has(value)) continue;
    out[field] = value;
    used.add(value);
  }
  return out;
}
