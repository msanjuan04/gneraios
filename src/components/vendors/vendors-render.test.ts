import { NextIntlClientProvider } from "next-intl";
import { type ComponentProps, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ExpenseListItem, FinanceConfig } from "@/components/finance/types";
import { deepMerge, type Messages } from "@/i18n/messages/merge";
import type { ClientVendorsData, VendorDetailData, VendorListItem, VendorsPageData } from "./types";

// Las pantallas de proveedores pintadas de verdad (listado, ficha y tarjeta del cliente), con datos
// como los de la demo: que no revienten, que enseñen lo importante y que no quede ninguna clave de
// i18n a la vista en ningún idioma.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/demo/finance/vendors",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ org: "demo" }),
}));
// Las acciones de servidor no se ejecutan aquí: solo se pinta.
vi.mock("@/app/[org]/finance/vendors/actions", () => ({ saveVendorProfile: vi.fn(), archiveVendor: vi.fn() }));

const { default: esAll } = await import("@/i18n/messages/es");
const { default: caAll } = await import("@/i18n/messages/ca");
const { default: enAll } = await import("@/i18n/messages/en");
const { TooltipProvider } = await import("@/components/ui/tooltip");
const { VendorsView } = await import("./vendors-view");
const { VendorDetail } = await import("./vendor-detail");
const { ClientVendorsCard } = await import("./client-vendors-card");

type Locale = "es" | "ca" | "en";
const LOCALES: Locale[] = ["es", "ca", "en"];
// Como en la app: el catalán y el inglés caen al español si falta una clave de otra área.
const APP: Record<Locale, Messages> = { es: esAll, ca: deepMerge(esAll, caAll), en: deepMerge(esAll, enAll) };

/** El HTML pintado, con los espacios finos y duros de Intl («23,50 €») como espacios normales. */
function render(locale: Locale, element: ReactElement): string {
  // Los hijos van como argumento de createElement; los props, sin `children` (de ahí el `as`).
  const intl = { locale, messages: APP[locale], timeZone: "Europe/Madrid" } as ComponentProps<typeof NextIntlClientProvider>;
  const tooltips = {} as ComponentProps<typeof TooltipProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, createElement(TooltipProvider, tooltips, element))).replace(
    /[\u00a0\u202f]/g,
    " ",
  );
}

/** Sin claves de proveedores ni llaves de ICU sin resolver. */
function expectClean(html: string, where: string) {
  expect(html, where).not.toMatch(/vendors\.[a-z]/);
  expect(html, where).not.toMatch(/\{(count|amount|name|year|date|share|column)\b/);
}

const vendor = (overrides: Partial<VendorListItem>): VendorListItem => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Clara Font Studio",
  kind: "freelancer",
  taxId: "39080359R",
  countryCode: "ES",
  contactName: "Clara Font",
  email: "hola@clarafont.cat",
  phone: "+34 600 11 22 33",
  iban: "ES9121000418450200051332",
  website: "clarafont.cat",
  notes: "Factura a final de mes.",
  defaultCategoryId: null,
  archived: false,
  expensesCount: 6,
  costCents: 65_050,
  yearExpensesCount: 4,
  yearCostCents: 25_050,
  pendingCents: 56_000,
  pendingCount: 2,
  overdueCents: 31_800,
  overdueCount: 1,
  clientsCount: 2,
  firstExpenseOn: "2025-12-20",
  lastExpenseOn: "2026-09-27",
  ...overrides,
});

const CLIENT_A = "00000000-0000-4000-8000-0000000000a1";

const config: FinanceConfig = {
  issuers: [{ id: "00000000-0000-4000-8000-0000000000e1", name: "GNERAI", kind: "company", archived: false }],
  categories: [
    { id: "00000000-0000-4000-8000-0000000000c1", name: "Freelances y colaboradores", expenseGroup: "cost_of_sales", isFixed: false, isInfrastructure: false, archived: false },
  ],
  vendors: [{ id: vendor({}).id, name: "Clara Font Studio", taxId: "39080359R", countryCode: "ES", defaultCategoryId: null, archived: false }],
  members: [],
  clients: [{ id: CLIENT_A, name: "Hotel Llevant", archived: false }],
  vatRates: [{ id: "00000000-0000-4000-8000-0000000000f1", name: "IVA 21 %", rateBps: 2100, isDefault: true }],
  irpfRates: [],
  defaultIssuerId: "00000000-0000-4000-8000-0000000000e1",
  defaultVatBps: 2100,
};

// Un gasto como los que devuelve listExpenses (Finanzas → Gastos). Con `as`: si ExpenseListItem gana
// campos, el test no se rompe por eso.
const expense = {
  id: "00000000-0000-4000-8000-0000000000b1",
  issuerId: config.defaultIssuerId,
  issuerName: "GNERAI",
  vendorId: vendor({}).id,
  vendorName: "Clara Font Studio",
  categoryId: config.categories[0]!.id,
  categoryName: "Freelances y colaboradores",
  expenseGroup: "cost_of_sales",
  isFixed: false,
  description: "Diseño de la carta",
  vendorInvoiceNumber: "CF-2026-031",
  issuedOn: "2026-09-27",
  dueOn: "2026-10-27",
  payableOn: "2026-10-27",
  baseCents: 20_000,
  vatBps: 2100,
  vatCents: 4_200,
  vatDeductible: true,
  irpfBps: 0,
  irpfCents: 0,
  totalCents: 24_200,
  costCents: 20_000,
  paidOn: null,
  paymentMethod: null,
  memberId: null,
  memberName: null,
  subscriptionId: null,
  periodStart: null,
  hasAttachment: true,
  source: "manual",
  notes: null,
  status: "pending",
  locked: false,
  allocation: "client",
  clientId: CLIENT_A,
  clientName: "Hotel Llevant",
  rebill: false,
  rebillMarkupBps: 0,
  rebillState: null,
  rebillInvoiceId: null,
  rebillInvoiceNumber: null,
} as ExpenseListItem;

function detail(overrides: Partial<VendorDetailData> = {}): VendorDetailData {
  return {
    vendor: vendor({}),
    allocation: [
      { allocation: "company", clientId: null, clientName: null, expensesCount: 2, costCents: 8_000, yearExpensesCount: 1, yearCostCents: -2_000, pendingCents: 0, lastExpenseOn: "2026-09-27" },
      { allocation: "client", clientId: CLIENT_A, clientName: "Hotel Llevant", expensesCount: 2, costCents: 26_050, yearExpensesCount: 2, yearCostCents: 26_050, pendingCents: 24_200, lastExpenseOn: "2026-09-27" },
      { allocation: "hosted_sites", clientId: null, clientName: null, expensesCount: 1, costCents: 1_000, yearExpensesCount: 1, yearCostCents: 1_000, pendingCents: 0, lastExpenseOn: "2026-09-27" },
    ],
    recentExpenses: [expense],
    categories: [{ id: config.categories[0]!.id, name: "Freelances y colaboradores", archived: false }],
    financeConfig: config,
    today: "2026-09-27",
    year: 2026,
    ...overrides,
  };
}

describe("listado de proveedores", () => {
  const data: VendorsPageData = {
    vendors: [
      vendor({}),
      vendor({ id: "00000000-0000-4000-8000-000000000002", name: "Raiola Networks SL", kind: "company", taxId: "B62357827", contactName: null, email: null, pendingCents: 0, pendingCount: 0, overdueCents: 0, clientsCount: 0 }),
      vendor({ id: "00000000-0000-4000-8000-000000000003", name: "Antigua Gestoría", kind: "company", archived: true }),
    ],
    categories: [],
    year: 2026,
  };
  const initial = { kind: "all" as const, showArchived: false, query: "", openNew: false };

  it("enseña cada proveedor con su tipo, sus cifras y el alta para un socio", () => {
    const html = render("es", createElement(VendorsView, { slug: "demo", basePath: "/demo", data, canEdit: true, initial }));
    expect(html).toContain("Clara Font Studio");
    expect(html).toContain("Freelance");
    expect(html).toContain("Raiola Networks SL");
    expect(html).toContain('href="/demo/finance/vendors/00000000-0000-4000-8000-000000000001"');
    expect(html).toContain("250,50 €");
    expect(html).toContain("318,00 € vencido");
    expect(html).toContain("Nuevo proveedor");
    // Los archivados, fuera salvo que se pidan (con su contador).
    expect(html).not.toContain("Antigua Gestoría");
    expect(html).toContain("Ver 1 archivado");
    expectClean(html, "es");
  });

  it("para un viewer, solo lectura; sin proveedores, el estado vacío", () => {
    const readOnly = render("es", createElement(VendorsView, { slug: "demo", basePath: "/demo", data, canEdit: false, initial }));
    expect(readOnly).toContain("Solo lectura");
    expect(readOnly).not.toContain("Nuevo proveedor");
    const empty = render("ca", createElement(VendorsView, { slug: "demo", basePath: "/demo", data: { ...data, vendors: [] }, canEdit: true, initial }));
    expect(empty).toContain("Encara no hi ha proveïdors");
    expectClean(empty, "ca");
  });

  it("con el filtro de freelancers y los archivados de la URL", () => {
    const html = render("en", createElement(VendorsView, { slug: "demo", basePath: "/demo", data, canEdit: true, initial: { ...initial, kind: "freelancer", showArchived: true } }));
    expect(html).toContain("Clara Font Studio");
    expect(html).not.toContain("Raiola Networks SL");
    expect(html).toContain('aria-pressed="true"');
    expectClean(html, "en");
  });
});

describe("ficha de un proveedor", () => {
  it("cabecera, cifras, «¿Para quién?» con el enlace al cliente y sus últimos gastos", () => {
    const html = render("es", createElement(VendorDetail, { slug: "demo", basePath: "/demo", data: detail(), canEdit: true }));
    expect(html).toContain("Clara Font Studio");
    expect(html).toContain("ES91 2100 0418 4502 0005 1332");
    expect(html).toContain('href="mailto:hola@clarafont.cat"');
    expect(html).toContain('href="https://clarafont.cat"');
    expect(html).toContain("Registrar gasto");
    expect(html).toContain("650,50 €");
    expect(html).toContain("318,00 € vencido");
    expect(html).toContain("¿Para quién?");
    expect(html).toContain('href="/demo/clients/00000000-0000-4000-8000-0000000000a1"');
    expect(html).toContain("Nuestra empresa");
    expect(html).toContain("Webs alojadas");
    expect(html).toContain("Diseño de la carta");
    expect(html).toContain('href="/demo/finance/expenses?vendor=00000000-0000-4000-8000-000000000001"');
    expect(html).toContain("Factura a final de mes.");
    expectClean(html, "es");
  });

  it("archivado: sin «Registrar gasto» y con el aviso; un viewer, solo lectura", () => {
    const archived = render("ca", createElement(VendorDetail, { slug: "demo", basePath: "/demo", data: detail({ vendor: vendor({ archived: true }) }), canEdit: true }));
    expect(archived).not.toContain("Registra una despesa");
    expect(archived).toContain("Recupera");
    expect(archived).toContain("recupera&#x27;l per registrar-hi despeses");
    expectClean(archived, "ca");

    const viewer = render("en", createElement(VendorDetail, { slug: "demo", basePath: "/demo", data: detail(), canEdit: false }));
    expect(viewer).toContain("Read-only");
    expect(viewer).not.toContain("Record expense");
    expect(viewer).toContain("Who was it for?");
    expectClean(viewer, "en");
  });

  it("«¿Para quién?» con muchos clientes: los 8 que más cuestan y una fila con el resto", () => {
    const allocation = Array.from({ length: 10 }, (_, i) => ({
      allocation: "client" as const,
      clientId: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
      clientName: `Cliente ${i + 1}`,
      expensesCount: 1,
      costCents: (10 - i) * 1_000,
      yearExpensesCount: 1,
      yearCostCents: (10 - i) * 1_000,
      pendingCents: 0,
      lastExpenseOn: "2026-09-01",
    }));
    const html = render("es", createElement(VendorDetail, { slug: "demo", basePath: "/demo", data: detail({ allocation }), canEdit: true }));
    expect(html).toContain("Cliente 8");
    expect(html).not.toContain("Cliente 9<");
    expect(html).toContain("2 clientes más");
    // Los dos últimos: 20 € + 10 € (de 550 €).
    expect(html).toContain("30,00 €");
    expectClean(html, "es");
  });

  it("sin gastos: cifras a cero y los vacíos de cada bloque", () => {
    const empty = detail({
      vendor: vendor({ expensesCount: 0, costCents: 0, yearExpensesCount: 0, yearCostCents: 0, pendingCents: 0, pendingCount: 0, overdueCents: 0, overdueCount: 0, clientsCount: 0, firstExpenseOn: null, lastExpenseOn: null, notes: null, iban: null }),
      allocation: [],
      recentExpenses: [],
    });
    for (const locale of LOCALES) {
      const html = render(locale, createElement(VendorDetail, { slug: "demo", basePath: "/demo", data: empty, canEdit: true }));
      expectClean(html, locale);
    }
    const es = render("es", createElement(VendorDetail, { slug: "demo", basePath: "/demo", data: empty, canEdit: true }));
    expect(es).toContain("Registrar el primero");
    expect(es).toContain("Sin gastos todavía");
  });
});

describe("tarjeta de proveedores de la ficha del cliente", () => {
  const data: ClientVendorsData = {
    vendors: [
      { vendorId: "00000000-0000-4000-8000-000000000001", name: "Clara Font Studio", kind: "freelancer", archived: false, expensesCount: 2, costCents: 26_050, yearCostCents: 26_050, lastExpenseOn: "2026-09-27" },
      { vendorId: "00000000-0000-4000-8000-000000000004", name: "Oriol Pons Dev", kind: "freelancer", archived: false, expensesCount: 1, costCents: 12_000, yearCostCents: 0, lastExpenseOn: "2025-11-02" },
    ],
    totals: { expensesCount: 3, costCents: 38_050, yearCostCents: 26_050 },
    year: 2026,
  };

  it("quién ha trabajado para el cliente, lo de este año y lo de siempre, con sus enlaces", () => {
    const html = render("es", createElement(ClientVendorsCard, { basePath: "/demo", clientId: CLIENT_A, data }));
    expect(html).toContain("Proveedores y freelancers");
    expect(html).toContain("2 proveedores han trabajado para este cliente · 380,50 € en total");
    expect(html).toContain('href="/demo/finance/vendors/00000000-0000-4000-8000-000000000004"');
    expect(html).toContain('href="/demo/finance/expenses?client=00000000-0000-4000-8000-0000000000a1"');
    expect(html).toContain("260,50 €");
    expectClean(html, "es");
  });

  it("sin nadie, una línea discreta; en los tres idiomas", () => {
    for (const locale of LOCALES) {
      const html = render(locale, createElement(ClientVendorsCard, { basePath: "/demo", clientId: CLIENT_A, data: { ...data, vendors: [], totals: { expensesCount: 0, costCents: 0, yearCostCents: 0 } } }));
      expectClean(html, locale);
    }
    const en = render("en", createElement(ClientVendorsCard, { basePath: "/demo", clientId: CLIENT_A, data: { ...data, vendors: [] } }));
    expect(en).toContain("No supplier or freelancer has worked for this client yet.");
  });
});
