// Definiciones versionadas de las métricas (ARCHITECTURE.md §7.8). Cada foto mensual
// (`metrics_snapshots`) guarda la versión con la que se calculó: si una definición cambia,
// sube METRICS_DEFINITION_VERSION y las fotos antiguas no se reescriben.
//
// Versión 1 (26/09/2026):
// - Fecha de corte: el último día del mes (o hoy, en el mes en curso). Todo se mide como lo
//   habría mostrado el dashboard ese día.
// - MRR: la definición v1 de mrr.ts (Σ mensuales + Σ anuales / 12 activas, netas de descuento,
//   sin IVA, redondeo único), sobre las líneas de contratos firmados en la fecha de corte y no
//   archivados. ARR = MRR × 12.
// - Movimientos de MRR (del cierre del mes anterior al corte), por cliente:
//     · nuevo: el cliente no tenía MRR ni líneas en pausa y ahora sí tiene MRR;
//     · expansión: sube el MRR de un cliente que ya lo tenía, o vuelve de una pausa;
//     · contracción: baja sin llegar a 0, o llega a 0 porque todo lo que le queda está en pausa;
//     · churn: llega a 0 sin nada en pausa.
//   Una versión nueva de una línea (replaces_line_id) es el mismo cliente: expansión o
//   contracción por la diferencia, nunca churn + nuevo. Se cumple siempre
//   MRR inicial + nuevo + expansión − contracción − churn = MRR final, al céntimo.
// - Ingresos del mes: Σ base imponible de las líneas de las facturas emitidas en el mes (las
//   rectificativas restan en el suyo), separada en recurrente (monthly + yearly), uso y one-off.
// - Clientes activos: clientes en estado activo en la fecha de corte (§6.4).
// - Pendiente de cobro: Σ (total a cobrar − cobrado) de las facturas emitidas no cobradas, con
//   IVA y neto de IRPF. Vencido: la parte con vencimiento anterior a la fecha de corte.
// - Pipeline ponderado: Σ importe × probabilidad de los deals abiertos, en dos cifras (one-off
//   y MRR), exacto y redondeado una sola vez.
export const METRICS_DEFINITION_VERSION = 1;

/**
 * Una foto tomada más de estos días después del cierre del mes es una reconstrucción con los
 * datos de ese momento, no la foto del cierre: se marca `is_estimated`.
 */
export const SNAPSHOT_GRACE_DAYS = 7;
