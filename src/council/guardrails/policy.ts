// Coherencia con la política financiera de los socios: subir la retribución o contratar solo se
// proponen si la regla de la política se cumple con los datos de hoy (get_policy la evalúa). Y si
// la política es la de ejemplo, el texto tiene que decirlo.

import type { RunLedger } from "../runtime/ledger";
import type { PolicyRule, RuleStatus } from "../tools/council";

/** Propone subir la retribución de los socios (lo usan también los evals). */
export const RAISE = /(?:subir|aumentar|incrementar|mejorar)[^.]{0,40}(?:retribuci[oó]n|sueldo|salario|n[oó]mina)[^.]{0,40}socios|(?:retribuci[oó]n|sueldo|salario)[^.]{0,20}(?:de los|a los) socios[^.]{0,30}(?:subir|aumentar|incrementar)/i;
/** Propone contratar. */
export const HIRE = /contratar a (?:una persona|alguien|un[ao]?\s)|nueva contrataci[oó]n|ampliar (?:el )?equipo|incorporar a (?:una persona|alguien)|contrataci[oó]n de (?:personal|una persona|alguien|un[ao]? (?:empleado|trabajador|freelance|perfil))/i;

const RULE_TEXT: Record<Exclude<PolicyRule, "cushion">, string> = {
  raise_partner_pay: "subir la retribución de los socios",
  hire: "contratar",
};

/** El estado de una regla en esta ejecución (null si no se llamó a get_policy). */
function ruleStatus(ledger: RunLedger, rule: PolicyRule): RuleStatus | null {
  const result = ledger.results("get_policy").at(-1);
  const rules = (result?.data?.rules ?? null) as Record<PolicyRule, RuleStatus> | null;
  return rules?.[rule] ?? null;
}

/** Problemas de una recomendación con la política (vacío = coherente). */
export function policyIssues(opts: {
  text: string;
  policyRule: "raise_partner_pay" | "hire" | null;
  ledger: RunLedger;
  version: number | null;
  isExample: boolean;
  citesPolicy: boolean;
}): string[] {
  const issues: string[] = [];
  const detected: ("raise_partner_pay" | "hire")[] = [];
  if (RAISE.test(opts.text)) detected.push("raise_partner_pay");
  if (HIRE.test(opts.text)) detected.push("hire");
  for (const rule of detected) {
    if (opts.policyRule !== rule) issues.push(`Propones ${RULE_TEXT[rule]}: pon policy_rule = "${rule}" y cita la regla de get_policy.`);
  }
  const rule = opts.policyRule;
  if (rule) {
    const status = ruleStatus(opts.ledger, rule);
    const policyName = opts.version === null ? "la política de ejemplo" : `la política v${opts.version}`;
    if (status === null) issues.push(`Para proponer ${RULE_TEXT[rule]} llama antes a get_policy: la regla tiene que cumplirse.`);
    else if (status === "no_cumple") issues.push(`Contradice ${policyName}: la regla para ${RULE_TEXT[rule]} no se cumple. No lo propongas; si acaso, di qué condición falta.`);
    else if (status === "sin_datos") issues.push(`No se puede proponer ${RULE_TEXT[rule]}: faltan datos para saber si se cumple la regla de ${policyName}. Explícalo como dato que falta (kind data_gap), sin proponerlo.`);
  }
  if (opts.isExample && opts.citesPolicy && !/ejemplo/i.test(opts.text)) {
    issues.push("La política es la de EJEMPLO (los socios aún no la han fijado): dilo en el texto.");
  }
  return issues;
}
