// Política de acceso de los socios. Sin dependencias: la usan el proxy, las pantallas de acceso y
// sus acciones de servidor.

/**
 * ¿Se obliga a todos a configurar la verificación en dos pasos (TOTP)? Solo con
 * AUTH_MFA_REQUIRED=true. Por defecto no: los socios entran con su código personal y un
 * dispositivo de confianza confirmado por email (src/server/auth/access-code.ts), que ya son dos
 * factores. Quien la tiene configurada la pasa siempre, se exija o no.
 */
export function mfaRequired(): boolean {
  return process.env.AUTH_MFA_REQUIRED === "true";
}

/**
 * ¿Hay que confirmar por email cada dispositivo nuevo (y avisar por email de los cambios de
 * código)? Solo con AUTH_DEVICE_CONFIRMATION=email, que necesita un proveedor de email
 * configurado. Por defecto no: el código basta, el dispositivo queda como de confianza al entrar
 * y los socios lo ven en los avisos de la app.
 */
export function deviceConfirmationByEmail(): boolean {
  return process.env.AUTH_DEVICE_CONFIRMATION === "email";
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72; // lo máximo que admite bcrypt (Supabase Auth)

export type PasswordProblem = "length" | "tooLong" | "lower" | "upper" | "digit";

/**
 * Lo que le falta a una contraseña (vacío = vale). La misma regla que Supabase Auth en
 * producción (mínimo 12, minúsculas, mayúsculas y números); Supabase además rechaza las filtradas.
 */
export function passwordProblems(password: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push("length");
  if (password.length > PASSWORD_MAX_LENGTH) problems.push("tooLong");
  if (!/\p{Ll}/u.test(password)) problems.push("lower");
  if (!/\p{Lu}/u.test(password)) problems.push("upper");
  if (!/\p{Nd}/u.test(password)) problems.push("digit");
  return problems;
}
