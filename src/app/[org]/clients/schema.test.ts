import { describe, expect, it } from "vitest";
import {
  activityFormSchema,
  clientFormSchema,
  contactFormSchema,
  contactFormDefaults,
  newClientDefaults,
  normalizeClientTaxId,
} from "./schema";

const OWNER = "8f0b9c7e-2f3a-4c55-9d1e-6a7b8c9d0e1f";

function issues(input: unknown) {
  const result = clientFormSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
}

describe("normalizeClientTaxId", () => {
  it("validates Spanish NIFs with their control character", () => {
    expect(normalizeClientTaxId("es", " b-1234567-4 ")).toBe("B12345674");
    expect(normalizeClientTaxId("es", "12345678Z")).toBe("12345678Z");
    expect(normalizeClientTaxId("es", "B12345675")).toBeNull();
  });

  it("requires a country prefix for EU VAT numbers", () => {
    expect(normalizeClientTaxId("eu_vat", "fr 12 345678901")).toBe("FR12345678901");
    expect(normalizeClientTaxId("eu_vat", "PT-123456789")).toBe("PT123456789");
    expect(normalizeClientTaxId("eu_vat", "123456789")).toBeNull();
    expect(normalizeClientTaxId("eu_vat", "F1234")).toBeNull();
  });

  it("keeps only letters and digits for foreign identifiers, as the database does", () => {
    expect(normalizeClientTaxId("foreign", "12-345/678 ab")).toBe("12345678AB");
    expect(normalizeClientTaxId("foreign", "x")).toBeNull();
    expect(normalizeClientTaxId("foreign", "1".repeat(21))).toBeNull();
  });

  it("returns an empty string when there is nothing to validate", () => {
    for (const kind of ["es", "eu_vat", "foreign"] as const) expect(normalizeClientTaxId(kind, "  ")).toBe("");
  });
});

describe("clientFormSchema", () => {
  it("accepts a lead with just a name", () => {
    expect(issues({ ...newClientDefaults(OWNER), display_name: "Hotel Llevant" })).toEqual([]);
  });

  it("reports the tax id error for its kind, together with other field errors", () => {
    const base = newClientDefaults(OWNER);
    expect(issues({ ...base, tax_id: "B12345675" })).toEqual(["display_name:required", "tax_id:taxId"]);
    expect(issues({ ...base, display_name: "X", tax_id_kind: "eu_vat", tax_id: "123" })).toEqual(["tax_id:euVat"]);
    expect(issues({ ...base, display_name: "X", tax_id_kind: "foreign", tax_id: "-" })).toEqual(["tax_id:foreignTaxId"]);
  });

  it("normalizes the country code and checks website and payment terms", () => {
    const base = { ...newClientDefaults(""), display_name: "Clínica Mar Blau" };
    const parsed = clientFormSchema.parse({ ...base, country_code: " fr ", website: "https://marblau.cat/es", payment_terms_days: "45" });
    expect(parsed.country_code).toBe("FR");
    expect(issues({ ...base, country_code: "ESP" })).toEqual(["country_code:countryCode"]);
    expect(issues({ ...base, website: "no es una web" })).toEqual(["website:website"]);
    expect(issues({ ...base, payment_terms_days: "400" })).toEqual(["payment_terms_days:days"]);
    expect(issues({ ...base, payment_terms_days: "3.5" })).toEqual(["payment_terms_days:days"]);
  });
});

describe("contactFormSchema", () => {
  it("lowercases emails and validates phones", () => {
    const base = { ...contactFormDefaults(undefined, true), full_name: "Laia Puig" };
    expect(base.is_primary && base.is_billing).toBe(true);
    expect(contactFormSchema.parse({ ...base, email: " Laia@MarBlau.CAT " }).email).toBe("laia@marblau.cat");
    expect(contactFormSchema.safeParse({ ...base, phone: "+34 600 00 00 00" }).success).toBe(true);
    expect(contactFormSchema.safeParse({ ...base, phone: "llámame" }).success).toBe(false);
  });
});

describe("activityFormSchema", () => {
  const base = { kind: "call", title: "Llamada", body: "", occurred_at: "2026-09-26T14:30", deal_id: "", contact_id: "" };

  it("takes the wall-clock time of a datetime-local input", () => {
    expect(activityFormSchema.safeParse(base).success).toBe(true);
    expect(activityFormSchema.safeParse({ ...base, occurred_at: "2026-09-26T14:30:05" }).success).toBe(true);
    expect(activityFormSchema.safeParse({ ...base, occurred_at: "2026-09-26" }).success).toBe(false);
  });

  it("rejects kinds that are not human activity", () => {
    expect(activityFormSchema.safeParse({ ...base, kind: "stage_change" }).success).toBe(false);
  });
});
