import { describe, expect, it } from "vitest";
import { buildProposalView, scopeItem } from "./proposal-view-model";
import { sampleQuote } from "./quote-samples";

const nbsp = (value: string) => value.replace(/ /g, " ");

describe("la propuesta a partir de un presupuesto", () => {
  const view = buildProposalView(sampleQuote);

  it("la portada lleva el título, para quién es y un precio por cada tipo de cobro", () => {
    expect(view.title).toBe("Web corporativa y mantenimiento");
    expect(view.preparedFor.startsWith("Preparada para ")).toBe(true);
    expect(view.prices.length).toBeGreaterThanOrEqual(2);
    expect(view.prices[0]!.label).toBe("OPCIÓN A");
    expect(view.prices[1]!.label).toBe("OPCIÓN B");
  });

  it("los importes salen sin céntimos si son redondos y con la etiqueta de IVA", () => {
    const first = view.prices[0]!;
    expect(nbsp(first.amount)).toMatch(/^[\d.]+ €$/);
    expect(first.suffix).toBe("+ IVA");
    expect(view.prices.find((price) => price.name === "Cuota mensual")?.suffix).toBe("+ IVA / mes");
  });

  it("cada tipo de cobro tiene su sección, numerada desde la 02 (la 01 es el resumen)", () => {
    expect(view.sections.map((section) => section.kicker.slice(0, 2))).toEqual(
      view.sections.map((_, index) => String(index + 2).padStart(2, "0")),
    );
    expect(view.intro?.kicker.startsWith("01 · ")).toBe(true);
  });

  it("las notas del presupuesto pasan a ser párrafos del resumen", () => {
    expect(view.intro?.paragraphs.at(-1)).toBe("Incluye dos rondas de cambios sobre el diseño.");
  });

  it("el pie lleva la fecha y la validez calculada", () => {
    expect(view.footerRight).toContain("30 días");
  });
});

describe("un presupuesto con un solo tipo de cobro", () => {
  it("no se llama «Opción A» si no hay más opciones", () => {
    const onlyOneOff = {
      ...sampleQuote,
      lines: sampleQuote.lines.filter((line) => line.billingType === "one_off"),
      totals: { ...sampleQuote.totals, monthly: null, yearly: null },
    };
    const view = buildProposalView(onlyOneOff);
    expect(view.prices).toHaveLength(1);
    expect(view.prices[0]!.label).toBe("PRECIO CERRADO");
  });
});

describe("el alcance", () => {
  it("la primera línea es el título y el resto, lo que incluye", () => {
    expect(scopeItem("Auditoría de la cuenta\n- Análisis del gasto\n• Revisión de términos", 0)).toEqual({
      number: "01",
      title: "Auditoría de la cuenta",
      points: ["Análisis del gasto", "Revisión de términos"],
    });
  });

  it("una línea sin detalle es solo título", () => {
    expect(scopeItem("Diseño de la web", 8)).toEqual({ number: "09", title: "Diseño de la web", points: [] });
  });
});
