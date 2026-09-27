// Importar clientes (con sus contactos) desde un CSV: validar cada fila, reconocer los que ya
// existen (por NIF, por identificador de origen o por nombre) y decidir qué se crea, qué se
// completa y qué se salta. Reimportar el mismo fichero no cambia nada: todo sale como "saltar".
//
// Un cliente existente solo se completa (los campos vacíos); lo que ya tiene no se pisa, porque
// puede haberse corregido en GNERAI OS después de la primera importación.

import type { ColumnMapping, ImportField } from "./fields";
import { error, info, type Issue, primaryIssue, type RowAction, warning, emptyCounts, type ActionCounts, hasErrors } from "./issues";
import { cellOf, type ImportTable } from "./table";
import { cleanText, normalizeKey } from "./text";
import {
  type AppLocale,
  classifyTaxId,
  isScientificNumber,
  parseCountry,
  parseEmails,
  parseLanguage,
  parsePostalCode,
  type TaxIdKind,
} from "./values";

export type ExistingClient = {
  id: string;
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  externalId: string | null;
  archived: boolean;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string;
  sector: string | null;
  website: string | null;
  notes: string | null;
  paymentTermsDays: number | null;
  importedSourceId: string | null;
  ownerMemberId: string | null;
};

export type ExistingContact = {
  clientId: string;
  fullName: string;
  email: string | null;
  isPrimary: boolean;
  isBilling: boolean;
};

export type ClientImportContext = {
  clients: readonly ExistingClient[];
  contacts: readonly ExistingContact[];
  sources: readonly { id: string; name: string }[];
  members: readonly { id: string; fullName: string; initials: string }[];
  /** Socio responsable de los clientes nuevos si el fichero no lo dice (quien importa). */
  defaultOwnerId: string | null;
};

/** Lo que se escribe en `clients` (nombres de columna de la base de datos). */
export type ClientValues = {
  display_name: string;
  legal_name: string | null;
  tax_id: string | null;
  tax_id_kind: TaxIdKind;
  address_line: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  country_code: string;
  sector: string | null;
  website: string | null;
  notes: string | null;
  payment_terms_days: number | null;
  preferred_language: AppLocale;
  imported_source_id: string | null;
  owner_member_id: string | null;
  external_id: string | null;
};

export type ContactValues = {
  full_name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  is_billing: boolean;
};

/** Campos que se pueden completar en un cliente existente, con el campo del mapeo del que salen. */
const FILLABLE: readonly [keyof ClientValues, ImportField][] = [
  ["legal_name", "legal_name"],
  ["tax_id", "tax_id"],
  ["address_line", "address_line"],
  ["postal_code", "postal_code"],
  ["city", "city"],
  ["province", "province"],
  ["sector", "sector"],
  ["website", "website"],
  ["notes", "notes"],
  ["payment_terms_days", "payment_terms_days"],
  ["imported_source_id", "source"],
  ["owner_member_id", "owner"],
  ["external_id", "external_id"],
];

export type ClientEntity = {
  /** Clave del cliente dentro del fichero (NIF, identificador de origen o nombre). */
  key: string;
  action: "create" | "update" | "skip";
  existingId: string | null;
  /** Alta completa (create) o solo los campos que se completan (update). */
  values: ClientValues | null;
  fill: Partial<ClientValues>;
  contacts: ContactValues[];
  rowNumbers: number[];
};

export type ClientRowResult = {
  rowNumber: number;
  action: RowAction;
  issues: Issue[];
  key: string | null;
  name: string | null;
  taxId: string | null;
  existingId: string | null;
  contact: { name: string; email: string | null } | null;
};

export type ClientImportPlan = {
  rows: ClientRowResult[];
  entities: ClientEntity[];
  counts: ActionCounts;
};

// Igual que el formulario de clientes: "gnerai.com", "www.gnerai.com/es" o "https://gnerai.com".
const WEBSITE = /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+\p{L}{2,}(:\d{2,5})?([/?#]\S*)?$/iu;

type ParsedRow = {
  values: ClientValues;
  contact: Omit<ContactValues, "is_primary" | "is_billing"> | null;
  /** Campos que el fichero trae con valor (para saber qué completar y qué comparar). */
  present: Set<keyof ClientValues>;
  issues: Issue[];
};

function parseRow(row: readonly string[], mapping: ColumnMapping, ctx: ClientImportContext): ParsedRow {
  const issues: Issue[] = [];
  const cell = (field: ImportField) => cellOf(row, mapping, field);
  const present = new Set<keyof ClientValues>();

  const legalName = cleanText(cell("legal_name"), 200);
  const displayName = cleanText(cell("display_name"), 200) ?? legalName;
  if (!displayName) issues.push(error("required", { field: "display_name" }));

  const countryRaw = cell("country");
  let countryCode = "ES";
  if (countryRaw) {
    const parsed = parseCountry(countryRaw);
    if (parsed) {
      countryCode = parsed;
      present.add("country_code");
    } else {
      issues.push(error("country_unknown", { field: "country", params: { value: countryRaw } }));
    }
  }

  let taxId: string | null = null;
  let taxIdKind: TaxIdKind = countryCode === "ES" ? "es" : "foreign";
  const taxRaw = cell("tax_id");
  if (taxRaw) {
    const classified = classifyTaxId(taxRaw, countryRaw ? countryCode : null);
    if (classified.ok) {
      taxId = classified.value;
      taxIdKind = classified.kind;
      present.add("tax_id");
    } else {
      issues.push(error(classified.reason === "control" ? "tax_id_control" : "tax_id_format", { field: "tax_id", params: { value: taxRaw } }));
    }
  }

  const postal = parsePostalCode(cell("postal_code"), countryCode);
  if (postal.padded) issues.push(info("postal_code_padded", { field: "postal_code", params: { value: postal.value ?? "" } }));
  if (!postal.valid) issues.push(warning("postal_code_invalid", { field: "postal_code", params: { value: postal.value ?? "" } }));

  let website = cleanText(cell("website"), 200);
  if (website && !WEBSITE.test(website)) {
    issues.push(warning("website_invalid", { field: "website", params: { value: website } }));
    website = null;
  }

  let paymentTerms: number | null = null;
  const termsRaw = cell("payment_terms_days");
  if (termsRaw) {
    const digits = termsRaw.replace(/\s*(dias|días|days|d)\.?$/i, "");
    if (/^\d{1,3}$/.test(digits) && Number(digits) <= 365) paymentTerms = Number(digits);
    else issues.push(warning("terms_invalid", { field: "payment_terms_days", params: { value: termsRaw } }));
  }

  let language: AppLocale = "es";
  const languageRaw = cell("language");
  if (languageRaw) {
    const parsed = parseLanguage(languageRaw);
    if (parsed) language = parsed;
    else issues.push(warning("language_unknown", { field: "language", params: { value: languageRaw } }));
  }

  let sourceId: string | null = null;
  const sourceRaw = cell("source");
  if (sourceRaw) {
    const key = normalizeKey(sourceRaw);
    sourceId = ctx.sources.find((s) => normalizeKey(s.name) === key)?.id ?? null;
    if (!sourceId) issues.push(warning("source_unknown", { field: "source", params: { value: sourceRaw } }));
  }

  let ownerId: string | null = null;
  const ownerRaw = cell("owner");
  if (ownerRaw) {
    const key = normalizeKey(ownerRaw);
    ownerId =
      ctx.members.find((m) => m.initials.toLowerCase() === key.replace(/\s/g, "") || normalizeKey(m.fullName) === key)?.id ??
      null;
    if (!ownerId) issues.push(warning("owner_unknown", { field: "owner", params: { value: ownerRaw } }));
  }

  const externalRaw = cleanText(cell("external_id"), 100);

  const values: ClientValues = {
    display_name: displayName ?? "",
    legal_name: legalName,
    tax_id: taxId,
    tax_id_kind: taxIdKind,
    address_line: cleanText(cell("address_line"), 200),
    postal_code: postal.value,
    city: cleanText(cell("city"), 80),
    province: cleanText(cell("province"), 80),
    country_code: countryCode,
    sector: cleanText(cell("sector"), 80),
    website,
    notes: cleanText(cell("notes"), 2000),
    payment_terms_days: paymentTerms,
    preferred_language: language,
    imported_source_id: sourceId,
    owner_member_id: ownerId,
    external_id: externalRaw ? `import:${externalRaw}` : null,
  };
  for (const [key] of FILLABLE) if (values[key] !== null) present.add(key);

  // Contacto: si hay nombre, email o teléfono. Sin nombre, el del cliente (suele ser el email de facturación).
  const emails = parseEmails(cell("contact_email"));
  if (emails.invalid.length > 0) issues.push(warning("email_invalid", { field: "contact_email", params: { value: emails.invalid.join(", ") } }));
  if (emails.extra.length > 0) issues.push(info("email_extra", { field: "contact_email", params: { value: emails.extra.join(", ") } }));
  let phone = cleanText(cell("contact_phone"), 40);
  if (phone && isScientificNumber(phone)) {
    issues.push(warning("phone_scientific", { field: "contact_phone", params: { value: phone } }));
    phone = null;
  }
  const contactName = cleanText(cell("contact_name"), 120);
  const contact =
    contactName || emails.email || phone
      ? {
          full_name: (contactName ?? displayName ?? emails.email ?? "").slice(0, 120),
          role: cleanText(cell("contact_role"), 80),
          email: emails.email,
          phone,
        }
      : null;

  return { values, contact, present, issues };
}

function nameKey(name: string): string {
  return normalizeKey(name);
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Qué se completaría y qué se mantiene de un cliente existente. */
function diffExisting(existing: ExistingClient, parsed: ParsedRow): { fill: Partial<ClientValues>; kept: ImportField[] } {
  const current: Record<keyof ClientValues, unknown> = {
    display_name: existing.displayName,
    legal_name: existing.legalName,
    tax_id: existing.taxId,
    tax_id_kind: null,
    address_line: existing.addressLine,
    postal_code: existing.postalCode,
    city: existing.city,
    province: existing.province,
    country_code: existing.countryCode,
    sector: existing.sector,
    website: existing.website,
    notes: existing.notes,
    payment_terms_days: existing.paymentTermsDays,
    preferred_language: null,
    imported_source_id: existing.importedSourceId,
    owner_member_id: existing.ownerMemberId,
    external_id: existing.externalId,
  };
  const fill: Partial<ClientValues> = {};
  const kept: ImportField[] = [];
  for (const [key, field] of FILLABLE) {
    if (!parsed.present.has(key)) continue;
    const incoming = parsed.values[key];
    const now = current[key];
    if (isEmptyValue(now)) {
      (fill as Record<string, unknown>)[key] = incoming;
      if (key === "tax_id") fill.tax_id_kind = parsed.values.tax_id_kind;
    } else if (
      key !== "external_id" &&
      key !== "owner_member_id" &&
      key !== "imported_source_id" &&
      String(now).toLowerCase() !== String(incoming).toLowerCase()
    ) {
      kept.push(field);
    }
  }
  if (parsed.present.has("country_code") && parsed.values.country_code !== existing.countryCode) kept.push("country");
  return { fill, kept };
}

function contactIsNew(
  contact: { full_name: string; email: string | null },
  existing: readonly { full_name: string; email: string | null }[],
): boolean {
  if (contact.email) return !existing.some((c) => c.email?.toLowerCase() === contact.email);
  const name = normalizeKey(contact.full_name);
  return !existing.some((c) => normalizeKey(c.full_name) === name);
}

type WorkingEntity = ClientEntity & { firstRow: number; knownContacts: { full_name: string; email: string | null }[] };

/**
 * Una fila posterior del mismo cliente completa lo que aún está vacío: en un alta, sus valores;
 * en un cliente existente, los campos vacíos de su ficha que ninguna fila anterior ha completado.
 */
function fillFromLaterRow(entity: WorkingEntity, parsed: ParsedRow, existing: ExistingClient | null): ImportField[] {
  const filled: ImportField[] = [];
  if (entity.values) {
    const values = entity.values as Record<string, unknown>;
    for (const [key, field] of FILLABLE) {
      if (!parsed.present.has(key) || !isEmptyValue(values[key])) continue;
      values[key] = parsed.values[key];
      if (key === "tax_id") entity.values.tax_id_kind = parsed.values.tax_id_kind;
      filled.push(field);
    }
    return filled;
  }
  if (!existing) return filled;
  const { fill } = diffExisting(existing, parsed);
  const target = entity.fill as Record<string, unknown>;
  for (const [key, field] of FILLABLE) {
    if (!(key in fill) || key in target) continue;
    target[key] = fill[key];
    if (key === "tax_id") entity.fill.tax_id_kind = fill.tax_id_kind;
    filled.push(field);
  }
  return filled;
}

/**
 * Simula la importación de clientes. Cada fila: crear (cliente nuevo), completar (datos vacíos o
 * un contacto nuevo de un cliente que ya existe o que ha creado una fila anterior), saltar (no
 * trae nada nuevo) o error. Varias filas con el mismo NIF (o nombre) son el mismo cliente: así
 * se importa un fichero con una fila por contacto.
 */
export function planClientImport(table: ImportTable, mapping: ColumnMapping, ctx: ClientImportContext): ClientImportPlan {
  const byTaxId = new Map<string, ExistingClient>();
  const byExternal = new Map<string, ExistingClient>();
  const byName = new Map<string, ExistingClient[]>();
  for (const client of ctx.clients) {
    if (client.taxId) byTaxId.set(client.taxId, client);
    if (client.externalId) byExternal.set(client.externalId, client);
    for (const name of [client.displayName, client.legalName]) {
      if (!name) continue;
      const key = nameKey(name);
      const list = byName.get(key) ?? [];
      if (!list.includes(client)) list.push(client);
      byName.set(key, list);
    }
  }
  const contactsByClient = new Map<string, { full_name: string; email: string | null; isPrimary: boolean; isBilling: boolean }[]>();
  for (const c of ctx.contacts) {
    const list = contactsByClient.get(c.clientId) ?? [];
    list.push({ full_name: c.fullName, email: c.email, isPrimary: c.isPrimary, isBilling: c.isBilling });
    contactsByClient.set(c.clientId, list);
  }

  const clientsById = new Map(ctx.clients.map((c) => [c.id, c]));
  const entities = new Map<string, WorkingEntity>();
  const rows: ClientRowResult[] = [];

  table.rows.forEach((row, index) => {
    const rowNumber = table.rowNumbers[index] ?? index + 2;
    const parsed = parseRow(row, mapping, ctx);
    const issues = [...parsed.issues];
    const result: ClientRowResult = {
      rowNumber,
      action: "error",
      issues,
      key: null,
      name: parsed.values.display_name || null,
      taxId: parsed.values.tax_id,
      existingId: null,
      contact: parsed.contact ? { name: parsed.contact.full_name, email: parsed.contact.email } : null,
    };
    rows.push(result);
    if (hasErrors(issues)) return;
    if (!parsed.values.owner_member_id && !parsed.present.has("owner_member_id")) {
      parsed.values.owner_member_id = ctx.defaultOwnerId;
    }

    const key = parsed.values.tax_id
      ? `nif:${parsed.values.tax_id}`
      : parsed.values.external_id
        ? `ext:${parsed.values.external_id}`
        : `name:${nameKey(parsed.values.display_name)}`;
    result.key = key;

    // Otra fila del mismo fichero ya lleva este cliente: esta solo puede añadir un contacto o completar.
    const known = entities.get(key);
    if (known) {
      result.existingId = known.existingId;
      issues.push(info("merged_row", { params: { row: known.firstRow } }));
      let changed = false;
      if (parsed.contact && contactIsNew(parsed.contact, known.knownContacts)) {
        const existingContacts = known.existingId ? (contactsByClient.get(known.existingId) ?? []) : [];
        const hasPrimary = known.contacts.some((c) => c.is_primary) || existingContacts.some((c) => c.isPrimary);
        known.contacts.push({ ...parsed.contact, is_primary: !hasPrimary, is_billing: false });
        known.knownContacts.push(parsed.contact);
        issues.push(info("contact_new", { params: { name: parsed.contact.full_name } }));
        changed = true;
      }
      const filled = fillFromLaterRow(known, parsed, known.existingId ? (clientsById.get(known.existingId) ?? null) : null);
      if (filled.length > 0) {
        issues.push(info("client_fill", { fields: filled }));
        changed = true;
      }
      if (changed && known.action === "skip") known.action = "update";
      known.rowNumbers.push(rowNumber);
      result.action = changed ? "update" : "skip";
      return;
    }

    // ¿Ya existe en GNERAI OS?
    let existing: ExistingClient | null = null;
    if (parsed.values.tax_id) existing = byTaxId.get(parsed.values.tax_id) ?? null;
    if (!existing && parsed.values.external_id) existing = byExternal.get(parsed.values.external_id) ?? null;
    if (!existing) {
      const candidates = [
        ...(byName.get(nameKey(parsed.values.display_name)) ?? []),
        ...(parsed.values.legal_name ? (byName.get(nameKey(parsed.values.legal_name)) ?? []) : []),
      ].filter((c, i, list) => list.indexOf(c) === i);
      if (candidates.length > 1) {
        issues.push(error("client_ambiguous", { params: { name: parsed.values.display_name } }));
        return;
      }
      const candidate = candidates[0];
      if (candidate) {
        if (parsed.values.tax_id && candidate.taxId && candidate.taxId !== parsed.values.tax_id) {
          issues.push(error("name_conflict", { params: { name: candidate.displayName, taxId: candidate.taxId } }));
          return;
        }
        existing = candidate;
      }
    }

    if (existing) {
      result.existingId = existing.id;
      if (existing.archived) issues.push(warning("client_archived", { params: { name: existing.displayName } }));
      const { fill, kept } = diffExisting(existing, parsed);
      const knownContacts = (contactsByClient.get(existing.id) ?? []).map((c) => ({ full_name: c.full_name, email: c.email }));
      const existingContacts = contactsByClient.get(existing.id) ?? [];
      const contacts: ContactValues[] = [];
      if (parsed.contact && contactIsNew(parsed.contact, knownContacts)) {
        contacts.push({
          ...parsed.contact,
          is_primary: !existingContacts.some((c) => c.isPrimary),
          is_billing: !existingContacts.some((c) => c.isBilling),
        });
        knownContacts.push(parsed.contact);
        issues.push(info("contact_new", { params: { name: parsed.contact.full_name } }));
      } else if (parsed.contact) {
        issues.push(info("contact_exists", { params: { name: parsed.contact.full_name } }));
      }
      const fillFields = FILLABLE.filter(([k]) => k in fill).map(([, f]) => f);
      if (fillFields.length > 0) issues.push(info("client_fill", { fields: fillFields }));
      if (kept.length > 0) issues.push(info("field_kept", { fields: kept }));
      const changed = fillFields.length > 0 || contacts.length > 0;
      if (!changed) issues.unshift(info("client_exists", { params: { name: existing.displayName } }));
      entities.set(key, {
        key,
        action: changed ? "update" : "skip",
        existingId: existing.id,
        values: null,
        fill,
        contacts,
        rowNumbers: [rowNumber],
        firstRow: rowNumber,
        knownContacts,
      });
      result.action = changed ? "update" : "skip";
      return;
    }

    const contacts: ContactValues[] = parsed.contact ? [{ ...parsed.contact, is_primary: true, is_billing: true }] : [];
    entities.set(key, {
      key,
      action: "create",
      existingId: null,
      values: parsed.values,
      fill: {},
      contacts,
      rowNumbers: [rowNumber],
      firstRow: rowNumber,
      knownContacts: parsed.contact ? [parsed.contact] : [],
    });
    result.action = "create";
  });

  const counts = emptyCounts();
  for (const r of rows) counts[r.action] += 1;
  return {
    rows,
    entities: [...entities.values()].map((entity) => ({
      key: entity.key,
      action: entity.action,
      existingId: entity.existingId,
      values: entity.values,
      fill: entity.fill,
      contacts: entity.contacts,
      rowNumbers: entity.rowNumbers,
    })),
    counts,
  };
}

/** El motivo principal de una fila, para guardarlo con el resultado. */
export function rowMessage(row: { issues: readonly Issue[] }): string | null {
  return primaryIssue(row.issues)?.code ?? null;
}
