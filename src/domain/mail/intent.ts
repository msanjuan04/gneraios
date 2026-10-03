// Qué nos está diciendo un correo: si acepta, si dice que no, si pregunta o si pide reunión. Reglas
// por palabras, no un modelo: es gratis, es igual cada vez y se puede leer y discutir. Lo que decide
// es de quién es el turno y qué se le propone hacer a la persona; nada se aplica solo.

export type MailIntent = "accepted" | "rejected" | "question" | "meeting" | "pricing" | "other";

export type MailReading = {
  intent: MailIntent;
  /** Lo que ha disparado la lectura, para poder enseñarlo: «lo dice porque pone “adelante”». */
  evidence: string[];
};

/** Señales por intención, en los tres idiomas en los que escribimos. Sin acentos: se normaliza antes. */
const SIGNALS: { intent: MailIntent; phrases: string[] }[] = [
  {
    intent: "accepted",
    phrases: [
      "aceptamos el presupuesto", "aceptamos la propuesta", "acepto el presupuesto", "acepto la propuesta",
      "adelante con", "tiramos adelante", "seguimos adelante", "nos lo queda", "nos quedamos con",
      "damos el ok", "te doy el ok", "ok al presupuesto", "firmamos", "podeis empezar", "podemos empezar",
      "acceptem el pressupost", "endavant amb", "donem el vist-i-plau",
      "we accept", "happy to proceed", "lets proceed", "go ahead with", "approved the quote", "sounds good, lets",
    ],
  },
  {
    intent: "rejected",
    phrases: [
      "no seguimos adelante", "hemos decidido no", "lo dejamos", "no nos encaja", "nos quedamos con otra",
      "hemos elegido otra", "demasiado caro", "fuera de presupuesto", "lo descartamos", "de momento no",
      "no tirem endavant", "ho descartem", "massa car",
      "we have decided not", "we will pass", "going with another", "too expensive", "not moving forward",
    ],
  },
  {
    intent: "meeting",
    phrases: [
      "podemos hacer una llamada", "una reunion", "nos vemos", "agendar", "quedamos", "videollamada",
      "disponibilidad para", "te llamo", "llamada esta semana", "una call",
      "podem fer una trucada", "una reunio", "quedem",
      "book a call", "schedule a call", "jump on a call", "set up a meeting", "available for a call",
    ],
  },
  {
    intent: "pricing",
    phrases: [
      "cuanto costaria", "cuanto cuesta", "que precio", "presupuesto para", "presupuestar", "tarifa",
      "una oferta", "cotizacion", "nos podeis pasar precio", "cuanto seria",
      "quant costaria", "quin preu", "pressupost per",
      "how much would", "what is the price", "send a quote", "quote for", "your rates",
    ],
  },
];

/** Una pregunta de verdad: interrogación, o una fórmula de pregunta al principio de una línea. */
const QUESTION_STARTS = /(^|\n)\s*(que |qué |como |cómo |cuando |cuándo |donde |dónde |por que |por qué |podriais|podríais|podeis|podéis|puedes|seria posible|sería posible|what |how |when |where |could you|can you|would it be)/i;

/** Texto comparable: minúsculas, sin acentos y con los espacios normalizados. */
const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Lee un correo entrante. Solo se mira lo que ha escrito la persona: la parte citada de la
 * respuesta («> …») se quita, porque si no se acabaría leyendo nuestro propio presupuesto como si
 * lo hubiera dicho el cliente.
 */
export function readMailIntent(message: { subject: string; bodyText: string }): MailReading {
  const own = ownText(message.bodyText);
  const haystack = normalize(`${message.subject}\n${own}`);
  const evidence: string[] = [];

  // El orden importa: aceptar o rechazar manda sobre pedir precio o reunión.
  for (const { intent, phrases } of SIGNALS) {
    const hits = phrases.filter((phrase) => haystack.includes(phrase));
    if (hits.length > 0) return { intent, evidence: hits };
  }
  if (haystack.includes("?") || QUESTION_STARTS.test(own)) {
    evidence.push("?");
    return { intent: "question", evidence };
  }
  return { intent: "other", evidence };
}

/** El texto que ha escrito esta persona: sin lo citado y sin la firma. */
export function ownText(bodyText: string): string {
  return bodyText
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .split(/^-- $/m)[0]!
    // «El 3 de octubre, X escribió:» abre la cita en casi todos los clientes de correo.
    .split(/\n[^\n]{0,80}(escribio|escribió|escrigue|escrigué|wrote):\s*(\n|$)/i)[0]!
    .trim();
}

/**
 * Un resumen de lo que piden, para la ficha: las frases con más sustancia del correo, sin saludos
 * ni despedidas, cortadas a lo que se lee de un vistazo.
 */
export function summarizeRequest(bodyText: string, maxLines = 4): string[] {
  const lines = ownText(bodyText)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 12 && !COURTESY.test(line));
  const picked: string[] = [];
  for (const line of lines) {
    picked.push(line.length > 220 ? `${line.slice(0, 219).trimEnd()}…` : line);
    if (picked.length >= maxLines) break;
  }
  return picked;
}

const COURTESY =
  /^(hola|buenas|buenos dias|buenas tardes|hi|hello|hey|bon dia|gracias|moltes gracies|muchas gracias|thanks|thank you|un saludo|saludos|atentament|atentamente|best|regards|cordialmente)\b/i;

/**
 * La plantilla de presupuesto que mejor encaja con lo que piden: se puntúa cuántas de sus palabras
 * propias aparecen en el correo. Sin coincidencias no se elige ninguna (mejor nada que una al azar).
 */
export function suggestTemplate<T extends { id: string; name: string; summary?: string | null }>(
  text: string,
  templates: readonly T[],
): { template: T; score: number } | null {
  const haystack = normalize(text);
  let best: { template: T; score: number } | null = null;
  for (const template of templates) {
    const words = [...new Set(normalize(`${template.name} ${template.summary ?? ""}`).split(/[^a-z0-9]+/))].filter(
      (word) => word.length >= 4 && !STOP_WORDS.has(word),
    );
    if (words.length === 0) continue;
    const score = words.filter((word) => haystack.includes(word)).length;
    if (score > 0 && (best === null || score > best.score)) best = { template, score };
  }
  return best;
}

const STOP_WORDS = new Set([
  "para", "con", "los", "las", "una", "unos", "unas", "del", "por", "que", "mas", "este", "esta",
  "plantilla", "propuesta", "presupuesto", "servicio", "servicios", "cliente", "mensual", "basico",
  "template", "proposal", "quote", "service", "services", "monthly", "basic",
]);
