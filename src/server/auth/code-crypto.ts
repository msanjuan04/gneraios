// Criptografía de la entrada con código (sin "server-only": se prueba con Vitest; solo la usa el
// servidor). Códigos de 8 cifras al azar, su hash con scrypt y sal, y tokens de dispositivo.

import { createHash, randomBytes, randomInt, scrypt as scryptCb, type ScryptOptions, timingSafeEqual } from "node:crypto";

export const ACCESS_CODE_LENGTH = 8;

// scrypt: N = 2^15 (≈ 50 ms por intento en el servidor), r = 8, p = 1, 32 bytes.
const PARAMS = { N: 1 << 15, r: 8, p: 1, keylen: 32 } as const;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

/**
 * Los códigos que alguien probaría primero: menos de 5 cifras distintas (11111111, 12121212,
 * 11223344) o una escalera de 5 o más (12345678, 98765…). No se reparten (quedan ~90 millones).
 */
export function isGuessableCode(code: string): boolean {
  if (new Set(code).size < 5) return true;
  let longest = 1;
  let run = 1;
  let prev = 0;
  for (let i = 1; i < code.length; i++) {
    const step = code.charCodeAt(i) - code.charCodeAt(i - 1);
    const stair = step === 1 || step === -1;
    run = stair && step === prev ? run + 1 : stair ? 2 : 1;
    prev = step;
    longest = Math.max(longest, run);
  }
  return longest >= 5;
}

/** Un código nuevo: 8 cifras al azar criptográfico (puede empezar por 0), nunca uno de los obvios. */
export function generateAccessCode(): string {
  for (;;) {
    const code = String(randomInt(0, 10 ** ACCESS_CODE_LENGTH)).padStart(ACCESS_CODE_LENGTH, "0");
    if (!isGuessableCode(code)) return code;
  }
}

export type ChosenCodeProblem = "format" | "weak" | "mismatch";

/**
 * Un código elegido por el propio socio: 8 cifras, no de los obvios y escrito igual dos veces.
 * (Que no lo tenga ya otro socio lo comprueba el servidor contra los hashes.)
 */
export function chosenCodeProblem(code: string, repeat: string): ChosenCodeProblem | null {
  const normalized = normalizeAccessCode(code);
  if (!normalized) return "format";
  if (isGuessableCode(normalized)) return "weak";
  if (normalizeAccessCode(repeat) !== normalized) return "mismatch";
  return null;
}

/** "1234 5678", "12-34-56-78"… → "12345678", o null si no son exactamente 8 cifras. */
export function normalizeAccessCode(input: string): string | null {
  const digits = input.replace(/[\s.\-·]/g, "");
  return new RegExp(`^\\d{${ACCESS_CODE_LENGTH}}$`).test(digits) ? digits : null;
}

/** Hash que se guarda: "scrypt$N$r$p$sal$hash" (base64url). */
export async function hashAccessCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(code, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: MAXMEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** ¿Es `code` el del hash? En tiempo constante; un hash con otro formato, nunca. */
export async function verifyAccessCode(code: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, saltText, keyText] = stored.split("$");
  if (kind !== "scrypt" || !n || !r || !p || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, "base64url");
  const key = await scrypt(code, Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Token aleatorio (cookie de dispositivo, enlace de confirmación) y su SHA-256, que es lo que se guarda. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** "marcsanjuan@gmail.com" → "m•••@gmail.com": para decir a dónde ha ido el enlace sin enseñarlo entero. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "•••";
  return `${user[0]}•••@${domain}`;
}
