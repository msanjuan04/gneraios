import { describe, expect, it } from "vitest";
import { classifyFromColumn, classifyLine, manualClassification } from "./classify";

describe("classifyLine", () => {
  it.each([
    ["Mantenimiento web septiembre", "monthly", "monthly_service", "mantenimiento"],
    ["Cuota SEO", "monthly", "monthly_service", "cuota"],
    ["Posicionamiento SEO mensual", "monthly", "monthly_period", "mensual"],
    ["Hosting web", "yearly", "yearly_hosting", "hosting"],
    ["Renovación dominio gnerai.com", "yearly", "yearly_hosting", "dominio"],
    ["Licencia anual", "yearly", "yearly_period", "anual"],
    ["Diseño web corporativa", "one_off", "one_off_project", "web"],
    ["Desarrollo app reservas", "one_off", "one_off_project", "desarrollo"],
    ["Rebranding completo", "one_off", "one_off_project", "rebranding"],
    ["Campaña Meta Ads noviembre", "usage", "usage_campaign", "campana"],
    ["Campanya Google Ads", "usage", "usage_campaign", "campany"],
    ["Cuota de alta", "one_off", "one_off_explicit", "cuota de alta"],
    ["Website maintenance", "monthly", "monthly_service", "maintenance"],
  ])("«%s» → %s (regla %s, «%s»)", (description, billingType, ruleId, keyword) => {
    const result = classifyLine(description);
    expect(result).toMatchObject({ billingType, source: "keyword", rule: { id: ruleId, keyword } });
  });

  it("sin palabra clave: puntual, sin regla, para revisar", () => {
    expect(classifyLine("Varios")).toEqual({ billingType: "one_off", category: "one_off", source: "default", rule: null, ambiguous: false });
  });

  it("uso y servicio recurrente a la vez, sin periodicidad explícita: ambigua", () => {
    expect(classifyLine("Gestión de campañas y mantenimiento")).toMatchObject({ billingType: "usage", ambiguous: true });
    expect(classifyLine("Gestión mensual de campañas")).toMatchObject({ billingType: "monthly", ambiguous: false });
    // Lo puntual no hace ambigua a nada: «mantenimiento web» es recurrente sin dudas.
    expect(classifyLine("Mantenimiento web")).toMatchObject({ ambiguous: false });
  });
});

describe("classifyFromColumn y manualClassification", () => {
  it("valores de una columna de periodicidad (la recurrence de gnerai-finance)", () => {
    expect(classifyFromColumn("monthly")).toMatchObject({ billingType: "monthly", source: "column", rule: { id: "column_monthly" } });
    expect(classifyFromColumn("quarterly")).toMatchObject({ billingType: "monthly", rule: { id: "column_quarterly" } });
    expect(classifyFromColumn("Anual")).toMatchObject({ billingType: "yearly", category: "recurring" });
    expect(classifyFromColumn("unique")).toMatchObject({ billingType: "one_off" });
    expect(classifyFromColumn("Puntual")).toMatchObject({ billingType: "one_off" });
    expect(classifyFromColumn("uso")).toMatchObject({ billingType: "usage", category: "usage" });
    expect(classifyFromColumn("")).toBeNull();
    expect(classifyFromColumn("a veces")).toBeNull();
  });

  it("la del socio manda", () => {
    expect(manualClassification("yearly")).toEqual({ billingType: "yearly", category: "recurring", source: "manual", rule: null, ambiguous: false });
  });
});
