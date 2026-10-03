// Lo que lleva dentro un secreto de la bóveda (va cifrado entero, el nombre incluido) y cómo se lee
// después de descifrarlo. Puro: lo usan el formulario, la lista y los tests.

import { z } from "zod";

/** El contenido de un secreto, tal y como se cifra en vault_items.ciphertext. */
export const vaultSecretSchema = z.object({
  name: z.string().trim().min(1).max(200),
  username: z.string().max(200).default(""),
  password: z.string().max(1000).default(""),
  url: z.string().max(500).default(""),
  notes: z.string().max(10_000).default(""),
  /** Clave TOTP (lo que da el QR de la verificación en dos pasos), por si hay que apuntarla. */
  totp: z.string().max(200).default(""),
});
export type VaultSecret = z.infer<typeof vaultSecretSchema>;

export const EMPTY_SECRET: VaultSecret = { name: "", username: "", password: "", url: "", notes: "", totp: "" };

/** Una fila de vault_items con su contenido ya descifrado. */
export type VaultEntry = {
  id: string;
  clientId: string | null;
  updatedAt: string;
  secret: VaultSecret;
};

/** Lo guardado (texto JSON descifrado) → secreto. Lo que no cuadre se queda en un secreto vacío. */
export function readVaultSecret(json: string): VaultSecret {
  try {
    return vaultSecretSchema.parse(JSON.parse(json));
  } catch {
    return { ...EMPTY_SECRET, name: "—" };
  }
}

/** Busca por nombre, usuario, web y notas, sin acentos ni mayúsculas (todo pasa en el navegador). */
export function matchesQuery(secret: VaultSecret, query: string): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  return [secret.name, secret.username, secret.url, secret.notes].some((field) => normalize(field).includes(needle));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
