// Sin "server-only": lo usa también la sincronización, que se puede lanzar desde el cron o un
// script. Nunca se importa desde código de cliente (lee la clave del entorno del servidor).
//
// Secretos de integraciones (ARCHITECTURE.md §5). Hoy se cifran en el servidor con AES-256-GCM y
// una clave de entorno (INTEGRATIONS_ENCRYPTION_KEY), y la base de datos solo guarda el texto
// cifrado en una columna que ningún miembro puede leer. `SecretStore` es la frontera: cambiarlo por
// Supabase Vault (que PGlite no tiene) es escribir otra implementación, sin tocar a quien lo usa.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export interface SecretStore {
  /** Cifra `plaintext` ligado a `context` (org y proveedor): no se puede abrir con otro contexto. */
  seal(plaintext: string, context: string): Promise<string>;
  open(sealed: string, context: string): Promise<string>;
}

export const ENCRYPTION_KEY_ENV = "INTEGRATIONS_ENCRYPTION_KEY";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretStoreError extends Error {
  constructor(readonly code: "missing_key" | "invalid_key" | "secret_format" | "secret_invalid") {
    super(code);
    this.name = "SecretStoreError";
  }
}

/** La clave maestra: 32 bytes en base64 (`openssl rand -base64 32`) o en hexadecimal (64 caracteres). */
export function parseEncryptionKey(value: string | undefined): Buffer | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/.test(raw)) {
    const bytes = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return bytes.length === 32 ? bytes : null;
  }
  return null;
}

/** Subclave para un uso concreto (cifrar secretos, firmar el state de OAuth…), nunca la maestra tal cual. */
export function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `gnerai-os/${purpose}`, 32));
}

export class AesGcmSecretStore implements SecretStore {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new SecretStoreError("invalid_key");
    this.#key = key;
  }

  async seal(plaintext: string, context: string): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  async open(sealed: string, context: string): Promise<string> {
    const [version, iv, body, tag, ...rest] = sealed.split(".");
    if (version !== VERSION || !iv || !body || !tag || rest.length > 0) throw new SecretStoreError("secret_format");
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretStoreError("secret_invalid");
    }
  }
}

/** El almacén de secretos con la clave del entorno. Lanza si falta o no es válida. */
export function secretStoreFromEnv(env: Record<string, string | undefined> = process.env): SecretStore {
  const raw = env[ENCRYPTION_KEY_ENV];
  const master = parseEncryptionKey(raw);
  if (!master) throw new SecretStoreError(raw ? "invalid_key" : "missing_key");
  return new AesGcmSecretStore(deriveKey(master, "integrations/secrets"));
}

/** Contexto de cifrado del token de una integración: un texto cifrado de una org no sirve en otra. */
export function integrationSecretContext(orgId: string, provider: string): string {
  return `integrations/${orgId}/${provider}`;
}
