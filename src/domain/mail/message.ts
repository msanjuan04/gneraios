// Reglas del correo: cómo se agrupa un hilo, de quién es un mensaje y cómo se resume. Puro: sin
// IMAP, sin red y sin base de datos, para poder probarlo entero.

/** Una dirección tal y como viene en una cabecera: «Nombre <correo>» o solo el correo. */
export type MailAddress = { name: string; address: string };

/** La dirección en minúsculas, venga sola o dentro de «Nombre <correo>». */
export function normalizeAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value);
  return (angled?.[1] ?? value).trim().toLowerCase();
}

/**
 * Con qué agrupar un mensaje en un hilo. Lo ideal es la cadena de referencias (lo que usan los
 * clientes de correo); si no hay, el asunto sin los «Re:» y «Fwd:», que es lo que hace la gente
 * al mirar su bandeja.
 */
export function threadKeyOf(message: {
  messageId: string | null;
  inReplyTo: string | null;
  references: readonly string[];
  subject: string;
}): string {
  const first = message.references.find((reference) => reference.trim().length > 0) ?? message.inReplyTo;
  if (first?.trim()) return first.trim().slice(0, 998);
  if (message.messageId?.trim()) return message.messageId.trim().slice(0, 998);
  const subject = baseSubject(message.subject);
  return (subject || "(sin asunto)").slice(0, 998);
}

const PREFIXES = /^\s*(re|rv|rsp|fwd|fw|reenv|tr)\s*(\[\d+\])?\s*:\s*/i;

/** El asunto sin los prefijos de respuesta y reenvío, en cualquier idioma de los que usamos. */
export function baseSubject(subject: string): string {
  let result = subject.trim();
  for (let i = 0; i < 10 && PREFIXES.test(result); i++) result = result.replace(PREFIXES, "").trim();
  return result;
}

/** Saliente si lo enviamos nosotros (el remitente es una de nuestras direcciones). */
export function directionOf(from: string, ourAddresses: readonly string[]): "incoming" | "outgoing" {
  const sender = normalizeAddress(from);
  return ourAddresses.some((address) => normalizeAddress(address) === sender) ? "outgoing" : "incoming";
}

/**
 * Las direcciones del otro lado de la conversación: las de fuera de casa. Con ellas se busca a qué
 * cliente o lead pertenece el mensaje.
 */
export function counterpartAddresses(
  message: { from: string; to: readonly string[]; cc: readonly string[] },
  ourAddresses: readonly string[],
): string[] {
  const ours = new Set(ourAddresses.map(normalizeAddress));
  const all = [message.from, ...message.to, ...message.cc].map(normalizeAddress).filter(Boolean);
  return [...new Set(all.filter((address) => !ours.has(address)))];
}

/** El dominio de una dirección, para reconocer a una empresa cuando el contacto no está apuntado. */
export function domainOf(address: string): string | null {
  const at = normalizeAddress(address).lastIndexOf("@");
  if (at < 0) return null;
  const domain = normalizeAddress(address).slice(at + 1);
  return domain.length > 2 ? domain : null;
}

/** Dominios de correo de toda la vida: que dos personas usen gmail no las hace la misma empresa. */
const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.es", "outlook.com", "outlook.es", "live.com",
  "yahoo.com", "yahoo.es", "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me", "gmx.com", "gmx.es",
  "telefonica.net", "terra.es", "ya.com", "wanadoo.es",
]);

export const isPublicDomain = (domain: string): boolean => PUBLIC_DOMAINS.has(domain.toLowerCase());

/**
 * Un resumen corto del cuerpo para la lista: sin saltos de más, sin la parte citada de la respuesta
 * y sin la firma, que es lo que estorba cuando lees de un vistazo.
 */
export function snippetOf(bodyText: string, length = 200): string {
  const clean = bodyText
    .split(/\n/)
    // Fuera lo citado («> …») y la cabecera de «El día X escribió:».
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n")
    .split(/^-- $/m)[0]!
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > length ? `${clean.slice(0, length - 1).trimEnd()}…` : clean;
}

/** El texto citado al responder, como lo escriben todos los clientes de correo. */
export function quoteForReply(original: { fromName: string; fromAddress: string; sentAt: Date; bodyText: string }, locale: string): string {
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(original.sentAt);
  const who = original.fromName ? `${original.fromName} <${original.fromAddress}>` : original.fromAddress;
  const quoted = original.bodyText
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nEl ${when}, ${who} escribió:\n${quoted}\n`;
}

/** El asunto de una respuesta: «Re: …», sin encadenar «Re: Re:». */
export function replySubject(subject: string): string {
  const base = baseSubject(subject);
  return base ? `Re: ${base}` : "Re:";
}
