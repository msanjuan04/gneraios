const FIRST_LETTER = /[\p{L}\p{N}]/u;
const MAX_INITIALS_LENGTH = 3;

/**
 * Avatar initials: the first letter of the first two words, uppercased for es-ES with
 * accents kept ("Marc Cortada" → "MC", "álvaro ñúñez" → "ÁÑ"). For an email, the words
 * come from the local part split on . _ - ("hugo.lago@x.com" → "HL"), ignoring any
 * "+tag". At most 3 characters (uppercasing "ß" gives "SS"); "U" when nothing is usable.
 */
export function initialsFrom(nameOrEmail: string): string {
  const text = nameOrEmail.normalize("NFC").trim();
  const at = text.indexOf("@");
  const words = at === -1 ? text.split(/\s+/) : text.slice(0, at).split("+")[0].split(/[._\-\s]+/);
  const initials = words
    .map((word) => FIRST_LETTER.exec(word)?.[0] ?? "")
    .filter((letter) => letter !== "")
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("es-ES");
  return Array.from(initials).slice(0, MAX_INITIALS_LENGTH).join("") || "U";
}
