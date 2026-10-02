/**
 * Secciones de «Tu espacio», en el orden en que se ven. Añadir o reordenar una sección es tocar
 * esta lista (y su componente): la base de datos solo guarda lo que un socio ha cambiado a mano
 * (client_portal_settings.sections) y el resto toma su valor por defecto.
 */
export const PORTAL_SECTIONS = ["progress", "work_log", "files", "services", "documents", "requests", "web_data", "ads"] as const;

export type PortalSectionKey = (typeof PORTAL_SECTIONS)[number];

/** Encendida por defecto. «Datos de tu web» solo se enseña si un socio lo decide para ese cliente. */
export const PORTAL_SECTION_DEFAULTS: Readonly<Record<PortalSectionKey, boolean>> = {
  progress: true,
  work_log: true,
  files: true,
  services: true,
  documents: true,
  requests: true,
  web_data: false,
  ads: false,
};

export type PortalSectionFlags = Record<PortalSectionKey, boolean>;

export function isPortalSection(value: unknown): value is PortalSectionKey {
  return typeof value === "string" && (PORTAL_SECTIONS as readonly string[]).includes(value);
}

/** Secciones de un cliente: lo guardado (solo sí o no) encima de los valores por defecto. */
export function resolvePortalSections(stored: unknown): PortalSectionFlags {
  const flags = { ...PORTAL_SECTION_DEFAULTS };
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(stored)) {
      if (isPortalSection(key) && typeof value === "boolean") flags[key] = value;
    }
  }
  return flags;
}

/** Las encendidas, en orden. */
export function enabledPortalSections(flags: PortalSectionFlags): PortalSectionKey[] {
  return PORTAL_SECTIONS.filter((key) => flags[key]);
}
