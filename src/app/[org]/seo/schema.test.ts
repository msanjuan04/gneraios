import { describe, expect, it } from "vitest";
import { EMPTY_PROPERTY_FORM, normalizeGa4Id, propertyFormSchema } from "./schema";

const messages = (input: unknown) => {
  const result = propertyFormSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
};

describe("formulario de una web", () => {
  it("acepta la web propia con Search Console, con GA4 o con las dos", () => {
    expect(messages({ ...EMPTY_PROPERTY_FORM, label: "gnerai.com", gsc_site_url: "sc-domain:gnerai.com" })).toEqual([]);
    expect(messages({ ...EMPTY_PROPERTY_FORM, label: "Blog", gsc_site_url: "https://blog.gnerai.com/" })).toEqual([]);
    expect(messages({ ...EMPTY_PROPERTY_FORM, label: "GA4", ga4_property_id: "properties/123456789" })).toEqual([]);
  });

  it("pide al menos una fuente, formatos válidos y el cliente si es de un cliente", () => {
    expect(messages({ ...EMPTY_PROPERTY_FORM, label: "x" })).toEqual(["gsc_site_url:sourceRequired"]);
    expect(messages({ ...EMPTY_PROPERTY_FORM, label: "x", gsc_site_url: "gnerai.com" })).toEqual(["gsc_site_url:gscSite"]);
    expect(messages({ ...EMPTY_PROPERTY_FORM, label: "x", ga4_property_id: "G-ABC123" })).toEqual(["ga4_property_id:ga4Property"]);
    expect(messages({ ...EMPTY_PROPERTY_FORM, label: "x", owner: "client", gsc_site_url: "sc-domain:x.com" })).toEqual([
      "client_id:clientRequired",
    ]);
    expect(messages({ ...EMPTY_PROPERTY_FORM, label: "  ", gsc_site_url: "sc-domain:x.com" })).toEqual(["label:required"]);
  });

  it("normaliza el id de GA4", () => {
    expect(normalizeGa4Id(" properties/987654321 ")).toBe("987654321");
    expect(normalizeGa4Id("987654321")).toBe("987654321");
  });
});
