// Fiscal, laboral y legal (CONSEJO.md §1): lo que toca estos temas sale marcado "Validar con
// gestoría" y nunca se presenta como asesoramiento profesional. El marcado lo pone el runner aunque
// el agente se olvide; presentarlo como asesoramiento se rechaza.

const PROFESSIONAL: RegExp[] = [
  /\biva\b/i,
  /\birpf\b/i,
  /impuesto/i,
  /hacienda/i,
  /\baeat\b/i,
  /\bmodelos?\s+\d{3}\b/i,
  /sociedades/i,
  /retenci[oó]n|retenciones/i,
  /tribut/i,
  /fiscal/i,
  /verifactu/i,
  /declaraci[oó]n/i,
  /n[oó]mina/i,
  /seguridad social/i,
  /salari/i,
  /retribuci[oó]n/i,
  /dividendo/i,
  /reparto (?:del? )?(?:beneficio|resultado)/i,
  /contratar a (?:una persona|alguien|un[ao]?\s)|nueva contrataci[oó]n|ampliar (?:el )?equipo|contrataci[oó]n de (?:personal|una persona|alguien|un[ao]? (?:empleado|trabajador|freelance|perfil))/i,
  /despid/i,
  /laboral/i,
  /\blegal\b|legalmente|normativa/i,
  /contrato mercantil|cl[aá]usula|penalizaci[oó]n/i,
  /rgpd|protecci[oó]n de datos/i,
  /reclamaci[oó]n judicial|monitorio|demanda\b/i,
];

/** Frases que presentarían la recomendación como asesoramiento profesional (se rechazan). */
const ADVICE: RegExp[] = [
  /no (?:hace falta|es necesario|necesit[aá]is) (?:consultar|validar|preguntar)/i,
  /(?:os|te) asesor(?:o|amos)\b/i,
  /asesoramiento (?:fiscal|legal|laboral) (?:profesional )?(?:de este|del) consejo/i,
  /es (?:totalmente )?legal\b/i,
];

/** ¿El texto trata algo fiscal, laboral o legal? */
export function needsProfessionalReview(text: string): boolean {
  const cleaned = text.replace(/abogado del diablo/gi, " ");
  return PROFESSIONAL.some((re) => re.test(cleaned));
}

/** Frases que presentan la recomendación como asesoramiento (para devolvérselas al agente). */
export function adviceClaims(text: string): string[] {
  return ADVICE.flatMap((re) => {
    const match = re.exec(text);
    return match ? [match[0]] : [];
  });
}
