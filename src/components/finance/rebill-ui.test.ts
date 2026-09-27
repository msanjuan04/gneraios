import { createTranslator, NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RebillExpense } from "@/domain/finance/rebill";
import caFinance from "@/i18n/messages/ca/finance.json";
import enFinance from "@/i18n/messages/en/finance.json";
import esFinance from "@/i18n/messages/es/finance.json";
import { deepMerge, type Messages } from "@/i18n/messages/merge";

// Gastos por cliente y su repercusión en la interfaz: los textos (es/ca/en completos y sin claves a
// la vista), el texto de las líneas de factura y los componentes nuevos pintados de verdad.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/demo/finance/expenses",
  useSearchParams: () => new URLSearchParams(),
}));
// La acción de servidor no se ejecuta aquí: solo se pinta.
vi.mock("@/app/[org]/finance/actions", () => ({ addRebillsToInvoice: vi.fn() }));

const { default: esAll } = await import("@/i18n/messages/es");
const { default: caAll } = await import("@/i18n/messages/ca");
const { default: enAll } = await import("@/i18n/messages/en");
const { ClientRebillCard } = await import("./client-rebill-card");
const { RebillPanel } = await import("./rebill-panel");
const { AllocationBadge } = await import("./badges");
const { AllocationFields } = await import("./allocation-fields");
const { rebillLineDescriber } = await import("@/server/finance/rebill-copy");

type Locale = "es" | "ca" | "en";
const LOCALES: Locale[] = ["es", "ca", "en"];
const APP: Record<Locale, Messages> = { es: esAll, ca: deepMerge(esAll, caAll), en: deepMerge(esAll, enAll) };
const FINANCE: Record<Locale, Messages> = { es: esFinance, ca: caFinance, en: enFinance };

function flatten(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`)));
}

/** Los textos nuevos de esta parte (con los de «Por hacer», que viven en finance.json). */
const OWN_PREFIXES = [
  "finance.allocation.",
  "finance.allocationField.",
  "finance.rebillState.",
  "finance.rebill.",
  "dashboard.actionQueue.items.rebills.",
];

const PARAMS = { count: 2, amount: "110,00 €", base: "100,00 €", markup: "10,00 €", percent: "10 %", client: "Acme", name: "Acme", number: "2026-0042", vendor: "Hetzner", description: "Servidor", concept: "Hetzner · Servidor", month: "septiembre de 2026" };

/** El HTML pintado, con los espacios finos y duros de Intl («23,50 €») como espacios normales. */
/** `t` de toda la app en ese idioma (las claves se comprueban en tiempo de ejecución). */
function translator(locale: Locale, errors: string[] = []) {
  return createTranslator({ locale, messages: APP[locale], onError: (e) => errors.push(`${locale}: ${e.message}`) }) as unknown as (
    key: string,
    params?: Record<string, string | number>,
  ) => string;
}

function render(locale: Locale, element: ReactElement): string {
  const props = { locale, messages: APP[locale], timeZone: "Europe/Madrid" } as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, element)).replace(
    /[\u00a0\u202f]/g,
    " ",
  );
}

/** Sin claves de i18n ni llaves de ICU sin resolver. */
function expectClean(html: string, where: string) {
  expect(html, where).not.toMatch(/finance\.|dashboard\./);
  expect(html, where).not.toMatch(/[{}]/);
}

describe("textos de gastos por cliente y repercusión", () => {
  it("el catalán y el inglés de Finanzas están completos: las mismas claves que el español", () => {
    const keys = flatten(FINANCE.es).sort();
    expect(flatten(FINANCE.ca).sort()).toEqual(keys);
    expect(flatten(FINANCE.en).sort()).toEqual(keys);
  });

  it("todos se formatean en los tres idiomas, con plurales, sin claves a la vista", () => {
    const own = flatten(FINANCE.es).filter((key) => OWN_PREFIXES.some((p) => key.startsWith(p)));
    expect(own.length).toBeGreaterThan(40);
    const errors: string[] = [];
    for (const locale of LOCALES) {
      const t = translator(locale, errors);
      for (const key of own) {
        // Los textos enriquecidos (<link>) se prueban pintados, más abajo.
        if (key.includes(".locked")) continue;
        const text = t(key, PARAMS);
        expect(text, `${locale}:${key}`).not.toBe(key);
        expect(text, `${locale}:${key}`).not.toMatch(/[{}]/);
      }
    }
    expect(errors).toEqual([]);
    const es = translator("es");
    expect(es("dashboard.actionQueue.items.rebills.title", { count: 1 })).toBe("1 gasto por repercutir");
    expect(es("finance.rebill.appendedToast", { count: 3, client: "Acme" })).toBe("3 gastos añadidos al borrador de Acme");
    const ca = translator("ca");
    // «per a {client}»: el nom del client pot començar per vocal (no hi ha «d'» possible).
    expect(ca("finance.rebill.addedToast", { count: 1, client: "Acme" })).toBe("1 despesa afegida a un esborrany nou per a Acme");
    expect(ca("finance.rebill.add")).toBe("Afegeix a la factura");
  });
});

describe("texto de cada línea de factura, en el idioma de la factura", () => {
  const server: RebillExpense = {
    id: "e1",
    clientId: "acme",
    description: "Servidor CX22",
    vendorName: "Hetzner",
    issuedOn: "2026-09-03",
    periodStart: "2026-09-01",
    baseCents: 550,
    markupBps: 0,
  };

  it("proveedor, concepto y el mes que cobra", () => {
    expect(rebillLineDescriber("es")(server)).toBe("Repercusión: Hetzner · Servidor CX22 · septiembre de 2026");
    expect(rebillLineDescriber("ca")(server)).toBe("Repercussió: Hetzner · Servidor CX22 · setembre del 2026");
    expect(rebillLineDescriber("en")(server)).toBe("Rebilled cost: Hetzner · Servidor CX22 · September 2026");
  });

  it("no repite el proveedor si el concepto ya lo nombra; sin proveedor, solo el concepto; sin periodo, el mes de la factura", () => {
    const describe = rebillLineDescriber("es");
    expect(describe({ ...server, description: "hetzner CX22" })).toBe("Repercusión: hetzner CX22 · septiembre de 2026");
    expect(describe({ ...server, vendorName: null, periodStart: null, issuedOn: "2026-02-10" })).toBe("Repercusión: Servidor CX22 · febrero de 2026");
  });
});

describe("componentes", () => {
  const data = {
    pending: [
      {
        id: "e1",
        description: "Dominio acme.es",
        vendorName: "Dinahosting",
        issuedOn: "2026-03-10",
        periodStart: null,
        baseCents: 1_500,
        markupBps: 2000,
        amountCents: 1_800,
        fromSubscription: false,
      },
      {
        id: "e2",
        description: "Servidor CX22",
        vendorName: "Hetzner",
        issuedOn: "2026-09-01",
        periodStart: "2026-09-01",
        baseCents: 550,
        markupBps: 0,
        amountCents: 550,
        fromSubscription: true,
      },
    ],
    totals: { count: 2, baseCents: 2_050, markupCents: 300, amountCents: 2_350 },
    drafted: { count: 1, amountCents: 1_000, invoiceId: "inv-1" },
  };

  it("la tarjeta del cliente: pendientes con su importe y margen, «Añadir a factura» y el borrador", () => {
    for (const locale of LOCALES) {
      const html = render(locale, createElement(ClientRebillCard, { slug: "demo", clientId: "acme", clientName: "Acme", data, canEdit: true }));
      expectClean(html, locale);
      expect(html).toContain("Dinahosting");
      expect(html).toContain("/demo/invoices/inv-1");
      expect(html).toContain("/demo/finance/expenses?client=acme");
    }
    const es = render("es", createElement(ClientRebillCard, { slug: "demo", clientId: "acme", clientName: "Acme", data, canEdit: true }));
    expect(es).toContain("Añadir a factura");
    expect(es).toContain("2 gastos · 23,50 € + IVA a facturar");
    expect(es).toContain("18,00 €");
    expect(es).toContain("+20 %");
    expect(es).toContain("1 gasto ya está en su borrador (10,00 € + IVA)");
  });

  it("la tarjeta sin permiso no ofrece el botón, y sin nada pendiente ni en borrador no se pinta", () => {
    const readOnly = render("es", createElement(ClientRebillCard, { slug: "demo", clientId: "acme", clientName: "Acme", data, canEdit: false }));
    expect(readOnly).not.toContain("Añadir a factura");
    expect(readOnly).toContain("Un socio puede añadirlos a su factura.");
    const empty = { pending: [], totals: { count: 0, baseCents: 0, markupCents: 0, amountCents: 0 }, drafted: { count: 0, amountCents: 0, invoiceId: null } };
    expect(render("es", createElement(ClientRebillCard, { slug: "demo", clientId: "acme", clientName: "Acme", data: empty, canEdit: true }))).toBe("");
  });

  it("el panel de Gastos: un «Añadir a factura» por cliente", () => {
    const groups = [{ clientId: "acme", clientName: "Acme", count: 2, baseCents: 2_050, markupCents: 300, amountCents: 2_350, items: [] }];
    for (const locale of LOCALES) expectClean(render(locale, createElement(RebillPanel, { slug: "demo", groups, canEdit: true })), locale);
    const es = render("es", createElement(RebillPanel, { slug: "demo", groups, canEdit: true }));
    expect(es).toContain("2 gastos · 23,50 € + IVA");
    expect(es).toContain("/demo/clients/acme");
    expect(es).toContain("Añadir a factura");
  });

  it("la píldora de a quién sirve: nada si es de la empresa; el cliente con su estado, o las webs alojadas", () => {
    expect(render("es", createElement(AllocationBadge, { allocation: "company", clientName: null }))).toBe("");
    const client = render("es", createElement(AllocationBadge, { allocation: "client", clientName: "Acme", rebillState: "pending" }));
    expect(client).toContain("Acme");
    expect(client).toContain("Por repercutir");
    expect(render("ca", createElement(AllocationBadge, { allocation: "hosted_sites", clientName: null }))).toContain("Webs allotjades");
    expect(render("en", createElement(AllocationBadge, { allocation: "client", clientName: "Acme", rebillState: "invoiced" }))).toContain("Rebilled");
  });

  it("«¿A quién sirve?»: las tres opciones y, con un cliente que se repercute, lo que se le facturará", () => {
    const props = {
      idPrefix: "expense",
      kind: "expense" as const,
      value: { allocation: "client" as const, clientId: "acme", rebill: true, markup: "10" },
      onChange: () => {},
      errors: {},
      clients: [{ id: "acme", name: "Acme", archived: false }],
      baseCents: 10_000,
    };
    for (const locale of LOCALES) expectClean(render(locale, createElement(AllocationFields, props)), locale);
    const es = render("es", createElement(AllocationFields, props));
    expect(es).toContain("Repartido entre las webs que alojamos");
    expect(es).toContain("Repercutir al cliente");
    expect(es).toContain("A facturar al cliente: 110,00 € + IVA (100,00 € + 10,00 € de margen)");
    expect(es).toContain('aria-checked="true"');

    const locked = render("es", createElement(AllocationFields, { ...props, lock: { state: "invoiced", href: "/demo/invoices/inv-1", number: "2026-0042" } }));
    expect(locked).toContain("Se repercutió en la factura");
    expect(locked).toContain('href="/demo/invoices/inv-1"');
    expect(locked).toContain("2026-0042");
    expectClean(render("ca", createElement(AllocationFields, { ...props, lock: { state: "drafted", href: "/demo/invoices/inv-1", number: null } })), "ca");

    const hosted = render("es", createElement(AllocationFields, { ...props, value: { allocation: "hosted_sites" as const, clientId: "", rebill: false, markup: "" } }));
    expect(hosted).toContain("El reparto sale de las webs activas");
    expect(hosted).not.toContain("Repercutir al cliente");
  });
});
