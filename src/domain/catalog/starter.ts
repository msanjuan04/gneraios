import type { CatalogBundle, CatalogItem } from "./types";

/**
 * Catálogo de ejemplo de una agencia digital en España: lo que crea «Crear servicios de ejemplo» y
 * lo que siembra la demo. Son datos, no reglas: los precios son orientativos y los socios los
 * cambian en Ajustes → Catálogo. Todos llevan el IVA por defecto de la org y están sujetos a IRPF.
 * `key` enlaza los packs con sus servicios; no se guarda.
 */

export type StarterItem = Omit<CatalogItem, "id" | "taxRateId" | "isActive" | "position"> & { key: string };
export type StarterBundle = Omit<CatalogBundle, "id" | "isActive" | "position" | "items"> & {
  key: string;
  items: { key: string; quantity: string | null }[];
};

export const STARTER_ITEMS: readonly StarterItem[] = [
  {
    key: "web-corporativa",
    category: "web",
    name: "Web corporativa",
    description:
      "Diseño y desarrollo de una web de hasta 5 páginas, adaptada a móvil, con gestor de contenidos, formulario de contacto, textos legales y SEO técnico de base.",
    translations: {
      ca: {
        description:
          "Disseny i desenvolupament d'un web de fins a 5 pàgines, adaptat a mòbil, amb gestor de continguts, formulari de contacte, textos legals i SEO tècnic de base.",
      },
      en: {
        name: "Corporate website",
        description:
          "Design and development of a website of up to 5 pages, mobile-friendly, with a content management system, contact form, legal pages and technical SEO basics.",
      },
    },
    billingType: "one_off",
    unitLabel: null,
    unitPriceCents: 180_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "tienda-online",
    category: "web",
    name: "Tienda online",
    description:
      "Tienda online con catálogo de productos, pago con tarjeta, gestión de pedidos y envíos, adaptada a móvil y lista para vender.",
    translations: {
      ca: {
        name: "Botiga en línia",
        description:
          "Botiga en línia amb catàleg de productes, pagament amb targeta, gestió de comandes i enviaments, adaptada a mòbil i a punt per vendre.",
      },
      en: {
        name: "Online store",
        description: "Online store with a product catalogue, card payments, order and shipping management, mobile-friendly and ready to sell.",
      },
    },
    billingType: "one_off",
    unitLabel: null,
    unitPriceCents: 350_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "landing-page",
    category: "web",
    name: "Landing page",
    description: "Página de aterrizaje para una campaña o un servicio: diseño, textos orientados a la conversión, formulario y medición de resultados.",
    translations: {
      ca: {
        description: "Pàgina d'aterratge per a una campanya o un servei: disseny, textos orientats a la conversió, formulari i mesura de resultats.",
      },
      en: { description: "Landing page for a campaign or a service: design, conversion-focused copy, form and results tracking." },
    },
    billingType: "one_off",
    unitLabel: "página",
    unitPriceCents: 65_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "seo-mensual",
    category: "seo",
    name: "SEO mensual",
    description:
      "Posicionamiento orgánico continuo: investigación de palabras clave, optimización de la web, contenidos, enlaces e informe mensual de resultados.",
    translations: {
      ca: {
        description:
          "Posicionament orgànic continu: recerca de paraules clau, optimització del web, continguts, enllaços i informe mensual de resultats.",
      },
      en: {
        name: "Monthly SEO",
        description: "Ongoing search engine optimisation: keyword research, on-site optimisation, content, link building and a monthly results report.",
      },
    },
    billingType: "monthly",
    unitLabel: null,
    unitPriceCents: 45_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "auditoria-seo",
    category: "seo",
    name: "Auditoría SEO",
    description: "Análisis técnico, de contenidos y de la competencia, con un plan de acción priorizado para mejorar el posicionamiento.",
    translations: {
      ca: {
        name: "Auditoria SEO",
        description: "Anàlisi tècnica, de continguts i de la competència, amb un pla d'acció prioritzat per millorar el posicionament.",
      },
      en: { name: "SEO audit", description: "Technical, content and competitor analysis, with a prioritised action plan to improve rankings." },
    },
    billingType: "one_off",
    unitLabel: null,
    unitPriceCents: 59_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "google-ads",
    category: "ads",
    name: "Gestión Google Ads (mensual)",
    description:
      "Creación, optimización y seguimiento de campañas en Google Ads, con medición de conversiones e informe mensual. La inversión en anuncios no está incluida.",
    translations: {
      ca: {
        name: "Gestió Google Ads (mensual)",
        description:
          "Creació, optimització i seguiment de campanyes a Google Ads, amb mesura de conversions i informe mensual. La inversió en anuncis no hi és inclosa.",
      },
      en: {
        name: "Google Ads management (monthly)",
        description: "Google Ads campaign setup, optimisation and monitoring, with conversion tracking and a monthly report. Ad spend not included.",
      },
    },
    billingType: "monthly",
    unitLabel: null,
    unitPriceCents: 35_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "meta-ads",
    category: "ads",
    name: "Gestión Meta Ads (mensual)",
    description:
      "Campañas en Facebook e Instagram: públicos, creatividades, optimización e informe mensual. La inversión en anuncios no está incluida.",
    translations: {
      ca: {
        name: "Gestió Meta Ads (mensual)",
        description:
          "Campanyes a Facebook i Instagram: públics, creativitats, optimització i informe mensual. La inversió en anuncis no hi és inclosa.",
      },
      en: {
        name: "Meta Ads management (monthly)",
        description: "Facebook and Instagram campaigns: audiences, creatives, optimisation and a monthly report. Ad spend not included.",
      },
    },
    billingType: "monthly",
    unitLabel: null,
    unitPriceCents: 35_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "branding",
    category: "branding",
    name: "Branding",
    description: "Identidad de marca: logotipo y sus variantes, paleta de colores, tipografías y manual de uso.",
    translations: {
      ca: { description: "Identitat de marca: logotip i les seves variants, paleta de colors, tipografies i manual d'ús." },
      en: { description: "Brand identity: logo and its variations, colour palette, typography and brand guidelines." },
    },
    billingType: "one_off",
    unitLabel: null,
    unitPriceCents: 120_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "mantenimiento-web",
    category: "maintenance",
    name: "Mantenimiento web (mensual)",
    description: "Actualizaciones, copias de seguridad, seguridad, monitorización y pequeños cambios de contenido cada mes.",
    translations: {
      ca: {
        name: "Manteniment web (mensual)",
        description: "Actualitzacions, còpies de seguretat, seguretat, monitoratge i petits canvis de contingut cada mes.",
      },
      en: { name: "Website maintenance (monthly)", description: "Updates, backups, security, monitoring and small content changes every month." },
    },
    billingType: "monthly",
    unitLabel: null,
    unitPriceCents: 6_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "hosting-anual",
    category: "hosting",
    name: "Hosting (anual)",
    description: "Alojamiento web con certificado SSL, copias de seguridad diarias y cuentas de correo.",
    translations: {
      ca: { description: "Allotjament web amb certificat SSL, còpies de seguretat diàries i comptes de correu." },
      en: { name: "Hosting (yearly)", description: "Web hosting with an SSL certificate, daily backups and email accounts." },
    },
    billingType: "yearly",
    unitLabel: null,
    unitPriceCents: 18_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
  {
    key: "hora-consultoria",
    category: "consulting",
    name: "Hora de consultoría",
    description: "Consultoría, formación o trabajos a medida fuera de los servicios contratados, por horas.",
    translations: {
      ca: { name: "Hora de consultoria", description: "Consultoria, formació o treballs a mida fora dels serveis contractats, per hores." },
      en: { name: "Consulting hour", description: "Consulting, training or custom work outside the contracted services, billed by the hour." },
    },
    billingType: "usage",
    unitLabel: "hora",
    unitPriceCents: 6_000,
    defaultQuantity: "1",
    irpfApplies: true,
  },
];

export const STARTER_BUNDLES: readonly StarterBundle[] = [
  {
    key: "pack-lanzamiento",
    name: "Pack Lanzamiento",
    description: "Todo lo necesario para salir al mercado: identidad de marca, web corporativa, hosting y mantenimiento.",
    translations: {
      ca: { name: "Pack Llançament", description: "Tot el necessari per sortir al mercat: identitat de marca, web corporativa, hosting i manteniment." },
      en: { name: "Launch pack", description: "Everything you need to go to market: brand identity, corporate website, hosting and maintenance." },
    },
    discountBps: 1_000,
    items: [
      { key: "branding", quantity: null },
      { key: "web-corporativa", quantity: null },
      { key: "hosting-anual", quantity: null },
      { key: "mantenimiento-web", quantity: null },
    ],
  },
  {
    key: "pack-crecimiento",
    name: "Pack Crecimiento",
    description: "Para captar más clientes: auditoría SEO de partida, SEO mensual y campañas en Google Ads.",
    translations: {
      ca: { name: "Pack Creixement", description: "Per captar més clients: auditoria SEO de partida, SEO mensual i campanyes a Google Ads." },
      en: { name: "Growth pack", description: "To win more customers: an initial SEO audit, monthly SEO and Google Ads campaigns." },
    },
    discountBps: 1_000,
    items: [
      { key: "auditoria-seo", quantity: null },
      { key: "seo-mensual", quantity: null },
      { key: "google-ads", quantity: null },
    ],
  },
];

/** Posición de cada servicio de ejemplo dentro de su categoría (0, 1, 2…), en el orden de la lista. */
export function starterPositions(items: readonly Pick<StarterItem, "key" | "category">[] = STARTER_ITEMS): Map<string, number> {
  const next = new Map<string, number>();
  const positions = new Map<string, number>();
  for (const item of items) {
    const position = next.get(item.category) ?? 0;
    positions.set(item.key, position);
    next.set(item.category, position + 1);
  }
  return positions;
}
