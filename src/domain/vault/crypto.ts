/**
 * Criptografía de la bóveda de contraseñas. Todo pasa en el navegador con WebCrypto: la contraseña
 * maestra y la clave de la bóveda nunca viajan al servidor, así que ni el servidor ni quien mire la
 * base de datos pueden leer un secreto.
 *
 * Cómo encaja:
 *   contraseña maestra ──PBKDF2──▶ clave personal ──AES-GCM──▶ cifra la clave privada del miembro
 *   clave privada ──RSA-OAEP──▶ abre el sobre (vault_grants) ──▶ clave de la bóveda
 *   clave de la bóveda ──AES-GCM──▶ cifra y descifra cada secreto (vault_items)
 *
 * Sin `next`, `react` ni `@supabase/*`: solo WebCrypto, que existe igual en el navegador y en Node.
 */

/** Iteraciones de PBKDF2 para derivar la clave personal (OWASP ≥ 600 000 para PBKDF2-SHA256). */
export const KDF_ITERATIONS = 600_000;
const KEY_BITS = 256;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const RSA_BITS = 2048;

const subtle = () => {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new VaultCryptoError("unsupported");
  return api;
};

export class VaultCryptoError extends Error {
  /** `wrong_password`: la contraseña maestra no abre la clave privada (o el dato está corrupto). */
  constructor(readonly code: "wrong_password" | "corrupt" | "unsupported") {
    super(code);
    this.name = "VaultCryptoError";
  }
}

// --- base64 (sin dependencias: vale en navegador y en Node) ------------------------------------

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new VaultCryptoError("corrupt");
  }
}

// WebCrypto pide vistas sobre un ArrayBuffer de verdad (no compartido): se crean siempre así.
const random = (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));

const utf8 = (value: string): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(value);
  const bytes = new Uint8Array(new ArrayBuffer(encoded.length));
  bytes.set(encoded);
  return bytes;
};

// --- AES-GCM ------------------------------------------------------------------------------------

/** `iv.ciphertext`, los dos en base64: un solo texto que guardar en una columna. */
export async function encryptWithKey(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = random(IV_BYTES);
  const sealed = await subtle().encrypt({ name: "AES-GCM", iv }, key, utf8(plaintext));
  return `${toBase64(iv)}.${toBase64(sealed)}`;
}

export async function decryptWithKey(key: CryptoKey, sealed: string): Promise<string> {
  const [iv, body, ...rest] = sealed.split(".");
  if (!iv || !body || rest.length > 0) throw new VaultCryptoError("corrupt");
  try {
    const open = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(body));
    return new TextDecoder().decode(open);
  } catch {
    throw new VaultCryptoError("wrong_password");
  }
}

// --- contraseña maestra → clave personal --------------------------------------------------------

export function newSalt(): string {
  return toBase64(random(SALT_BYTES));
}

/** La clave que sale de la contraseña maestra. No se guarda en ningún sitio: se recalcula al abrir. */
export async function deriveKey(masterPassword: string, salt: string, iterations = KDF_ITERATIONS): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", utf8(masterPassword), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: fromBase64(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

// --- par de claves del miembro ------------------------------------------------------------------

export type MemberKeyMaterial = {
  publicKey: string;
  privateKeyCiphertext: string;
  kdfSalt: string;
  kdfIterations: number;
};

/** Un par nuevo con la privada ya cifrada con la contraseña maestra: lo que se guarda en vault_keys. */
export async function createMemberKeys(masterPassword: string): Promise<MemberKeyMaterial> {
  const pair = await subtle().generateKey(
    { name: "RSA-OAEP", modulusLength: RSA_BITS, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"],
  );
  const kdfSalt = newSalt();
  const personal = await deriveKey(masterPassword, kdfSalt);
  const pkcs8 = await subtle().exportKey("pkcs8", pair.privateKey);
  return {
    publicKey: toBase64(await subtle().exportKey("spki", pair.publicKey)),
    privateKeyCiphertext: await encryptWithKey(personal, toBase64(pkcs8)),
    kdfSalt,
    kdfIterations: KDF_ITERATIONS,
  };
}

/** Abre la clave privada del miembro. Lanza `wrong_password` si la contraseña maestra no es la suya. */
export async function unlockPrivateKey(masterPassword: string, keys: MemberKeyMaterial): Promise<CryptoKey> {
  const personal = await deriveKey(masterPassword, keys.kdfSalt, keys.kdfIterations);
  const pkcs8 = fromBase64(await decryptWithKey(personal, keys.privateKeyCiphertext));
  return subtle().importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
}

// --- clave de la bóveda y sus sobres -------------------------------------------------------------

/** La clave con la que se cifran los secretos. Se crea una sola vez por org. */
export function createVaultKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: KEY_BITS }, true, ["encrypt", "decrypt"]);
}

/** El sobre para un miembro: la clave de la bóveda cifrada con su clave pública. */
export async function wrapVaultKey(vaultKey: CryptoKey, publicKeySpki: string): Promise<string> {
  const publicKey = await subtle().importKey("spki", fromBase64(publicKeySpki), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const raw = await subtle().exportKey("raw", vaultKey);
  return toBase64(await subtle().encrypt({ name: "RSA-OAEP" }, publicKey, raw));
}

/** Abre el sobre con la clave privada ya desbloqueada. */
export async function unwrapVaultKey(privateKey: CryptoKey, wrapped: string): Promise<CryptoKey> {
  let raw: ArrayBuffer;
  try {
    raw = await subtle().decrypt({ name: "RSA-OAEP" }, privateKey, fromBase64(wrapped));
  } catch {
    throw new VaultCryptoError("corrupt");
  }
  return subtle().importKey("raw", raw, { name: "AES-GCM", length: KEY_BITS }, true, ["encrypt", "decrypt"]);
}

// --- fuerza de una contraseña --------------------------------------------------------------------

/** 0–4, como los medidores de siempre: longitud y variedad. Solo para avisar, nunca para impedir. */
export function passwordStrength(value: string): 0 | 1 | 2 | 3 | 4 {
  if (!value) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  const score = (value.length >= 20 ? 3 : value.length >= 14 ? 2 : value.length >= 10 ? 1 : 0) + (variety >= 3 ? 1 : 0);
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?-_";

/** Una contraseña al azar sin caracteres que se confunden (0/O, 1/l/I). Sin sesgo: rechaza y repite. */
export function generatePassword(length = 20): string {
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = "";
  while (out.length < length) {
    for (const byte of random(length)) {
      if (byte >= max) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}
