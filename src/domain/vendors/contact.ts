// Los datos de contacto de un proveedor, listos para enlazar.

/** "estudi.cat/portfolio" para leer; con https:// para el enlace (si no lo lleva ya). */
export function websiteLink(website: string): { href: string; label: string } {
  const value = website.trim();
  const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return { href, label: value.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "") };
}

/** "+34 600 11 22 33" → "tel:+34600112233" (sin espacios, puntos, guiones ni paréntesis). */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
