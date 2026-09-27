import { describe, expect, it } from "vitest";
import { type ClientImportContext, type ExistingClient, planClientImport } from "./clients-import";
import { autoMapColumns } from "./fields";
import { parseCsv } from "./csv";
import type { ImportTable } from "./table";

function table(csv: string): ImportTable {
  const parsed = parseCsv(csv);
  return { headers: parsed.headers, rows: parsed.rows, rowNumbers: parsed.rowNumbers };
}

function existing(overrides: Partial<ExistingClient>): ExistingClient {
  return {
    id: "c-port",
    displayName: "Restaurant del Port",
    legalName: "Port Mataró SL",
    taxId: "B12345674",
    externalId: null,
    archived: false,
    addressLine: "Passeig Marítim 3",
    postalCode: "08301",
    city: "Mataró",
    province: null,
    countryCode: "ES",
    sector: null,
    website: null,
    notes: null,
    paymentTermsDays: null,
    importedSourceId: null,
    ownerMemberId: null,
    ...overrides,
  };
}

const ctx = (over: Partial<ClientImportContext> = {}): ClientImportContext => ({
  clients: [],
  contacts: [],
  sources: [{ id: "src-ref", name: "Referido" }],
  members: [{ id: "m-ms", fullName: "Marc Sanjuan", initials: "MS" }],
  defaultOwnerId: "m-ms",
  ...over,
});

const HEADER = "Nombre;Razón social;NIF;Dirección;CP;Ciudad;País;Sector;Contacto;Email;Teléfono;Fuente\n";

describe("planClientImport", () => {
  it("crea clientes nuevos con su contacto (principal y de facturación)", () => {
    const t = table(`${HEADER}Fabrik;Fabrik Madrid SL;B87654315;Gran Vía 1;28013;Madrid;España;Moda;Ana Pérez;ana@fabrik.es;600 111 222;Referido\n`);
    const plan = planClientImport(t, autoMapColumns("clients", t.headers), ctx());
    expect(plan.counts).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    expect(plan.entities[0]).toMatchObject({
      action: "create",
      values: {
        display_name: "Fabrik",
        legal_name: "Fabrik Madrid SL",
        tax_id: "B87654315",
        tax_id_kind: "es",
        postal_code: "28013",
        country_code: "ES",
        sector: "Moda",
        imported_source_id: "src-ref",
        owner_member_id: "m-ms",
      },
      contacts: [{ full_name: "Ana Pérez", email: "ana@fabrik.es", phone: "600 111 222", is_primary: true, is_billing: true }],
    });
  });

  it("una fila por contacto: el mismo NIF es el mismo cliente, que suma contactos", () => {
    const t = table(
      `${HEADER}Fabrik;;B87654315;;;;;;Ana;ana@fabrik.es;;\nFabrik;;B87654315;;;;;;Luis;luis@fabrik.es;;\nFabrik;;B87654315;;;;;;Ana;ana@fabrik.es;;\n`,
    );
    const plan = planClientImport(t, autoMapColumns("clients", t.headers), ctx());
    expect(plan.rows.map((r) => r.action)).toEqual(["create", "update", "skip"]);
    expect(plan.entities).toHaveLength(1);
    expect(plan.entities[0]!.contacts.map((c) => [c.full_name, c.is_primary])).toEqual([
      ["Ana", true],
      ["Luis", false],
    ]);
    expect(plan.rows[2]!.issues.map((i) => i.code)).toContain("merged_row");
  });

  it("un cliente existente se completa (campos vacíos) y no se pisa lo que ya tiene", () => {
    const t = table(`${HEADER}Restaurant del Port;;B12345674;Otra calle 9;;Mataró;;Hostelería;;facturas@port.cat;;\n`);
    const plan = planClientImport(t, autoMapColumns("clients", t.headers), ctx({ clients: [existing({})] }));
    expect(plan.rows[0]!.action).toBe("update");
    expect(plan.entities[0]).toMatchObject({ action: "update", existingId: "c-port", fill: { sector: "Hostelería" } });
    expect(plan.entities[0]!.fill).not.toHaveProperty("address_line");
    const codes = plan.rows[0]!.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["client_fill", "field_kept", "contact_new"]));
    expect(plan.rows[0]!.issues.find((i) => i.code === "field_kept")!.fields).toEqual(["address_line"]);
  });

  it("reimportar lo mismo no cambia nada: todo sale como «saltar»", () => {
    const csv = `${HEADER}Fabrik;Fabrik Madrid SL;B87654315;Gran Vía 1;28013;Madrid;España;Moda;Ana Pérez;ana@fabrik.es;;\n`;
    const t = table(csv);
    const first = planClientImport(t, autoMapColumns("clients", t.headers), ctx());
    const created = first.entities[0]!.values!;
    const after = ctx({
      clients: [
        existing({
          id: "c-fabrik",
          displayName: created.display_name,
          legalName: created.legal_name,
          taxId: created.tax_id,
          addressLine: created.address_line,
          postalCode: created.postal_code,
          city: created.city,
          sector: created.sector,
          ownerMemberId: "m-ms",
        }),
      ],
      contacts: [{ clientId: "c-fabrik", fullName: "Ana Pérez", email: "ana@fabrik.es", isPrimary: true, isBilling: true }],
    });
    const second = planClientImport(t, autoMapColumns("clients", t.headers), after);
    expect(second.counts).toEqual({ create: 0, update: 0, skip: 1, error: 0 });
    expect(second.rows[0]!.issues[0]!.code).toBe("client_exists");
  });

  it("reconoce por nombre si no hay NIF; con otro NIF es un conflicto; con varios, ambiguo", () => {
    const byName = table(`${HEADER}restaurant del port;;;;;;;;;;;\n`);
    expect(planClientImport(byName, autoMapColumns("clients", byName.headers), ctx({ clients: [existing({})] })).rows[0]).toMatchObject({
      action: "skip",
      existingId: "c-port",
    });

    const otherNif = table(`${HEADER}Restaurant del Port;;B87654315;;;;;;;;;\n`);
    expect(planClientImport(otherNif, autoMapColumns("clients", otherNif.headers), ctx({ clients: [existing({})] })).rows[0]!.issues[0]!.code).toBe(
      "name_conflict",
    );

    const twice = ctx({ clients: [existing({ taxId: null }), existing({ id: "c-2", taxId: null, legalName: null })] });
    expect(planClientImport(byName, autoMapColumns("clients", byName.headers), twice).rows[0]!.issues[0]!.code).toBe("client_ambiguous");
  });

  it("valida cada fila: nombre, NIF, país; y avisa de lo que se corrige o se descarta", () => {
    const t = table(
      `${HEADER};;B87654315;;;;;;;;;\nMal NIF;;12345678A;;;;;;;;;\nLejos;;;;;;Atlántida;;;;;\nCeros;;;;8301;;;;;mal@;6,12E+08;Otra fuente\n`,
    );
    const plan = planClientImport(t, autoMapColumns("clients", t.headers), ctx());
    expect(plan.rows.map((r) => [r.action, r.issues[0]?.code])).toEqual([
      ["error", "required"],
      ["error", "tax_id_control"],
      ["error", "country_unknown"],
      ["create", "postal_code_padded"],
    ]);
    const codes = plan.rows[3]!.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["postal_code_padded", "email_invalid", "phone_scientific", "source_unknown"]));
    expect(plan.entities[0]!.values!.postal_code).toBe("08301");
  });

  it("clientes extranjeros: IVA intracomunitario o identificador libre", () => {
    const t = table(`${HEADER}Maison;;FR12345678901;;75001;Paris;Francia;;;;;\nAcme;;12-3456789;;;;USA;;;;;\n`);
    const plan = planClientImport(t, autoMapColumns("clients", t.headers), ctx());
    expect(plan.entities.map((e) => [e.values!.tax_id, e.values!.tax_id_kind, e.values!.country_code])).toEqual([
      ["FR12345678901", "eu_vat", "FR"],
      ["123456789", "foreign", "US"],
    ]);
  });
});
