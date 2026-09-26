/** Slugs that collide with top-level routes and can never name an organisation. */
export const RESERVED_SLUGS = [
  "login",
  "logout",
  "auth",
  "onboarding",
  "api",
  "preview",
  "settings",
  "invite",
  "admin",
  "app",
  "brand",
  "static",
  "_next",
] as const;

const SLUG_MAX_LENGTH = 40;
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * "Agència Mataró, S.L." → "agencia-mataro-s-l": lowercase ASCII without accents, every run
 * of other characters collapsed into one "-", at most 40 characters. The result may be
 * empty or reserved, so check it with isValidSlug before using it.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/** 1–40 characters of [a-z0-9-], starting and ending alphanumeric, and not reserved. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !(RESERVED_SLUGS as readonly string[]).includes(slug);
}
