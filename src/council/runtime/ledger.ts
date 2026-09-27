// Libro de una ejecución: cada resultado de tool recibe un id (t1, t2…) y cada métrica otro (m1,
// m2…). El modelo ve las cifras ya escritas y las cita por su id; al terminar, el runner resuelve
// esos ids (o las claves estables de las métricas) a evidencia completa: valor, unidad, periodo,
// tool, fuente y enlace. Lo que no está en el libro no existe para el consejo.

import type { ToolCallLog } from "../store/types";
import { formatMetric } from "../tools/format";
import type { ToolOutcome } from "../tools/registry";
import type { Metric, ToolResult } from "../tools/types";
import type { EvidenceItem } from "../types";

type Entry = { id: string; tool: string; callId: string; metric: Metric; source: string; href: string };

type Call = { id: string; tool: string; input: unknown; result: ToolResult | null; error: string | null };

export class RunLedger {
  private readonly calls: Call[] = [];
  private readonly byId = new Map<string, Entry>();
  private readonly byKey = new Map<string, Entry>();
  private readonly subjectSet = new Set<string>();
  private readonly literalSet = new Set<string>();
  private metricCount = 0;

  /** Guarda el resultado de una llamada y devuelve lo que ve el modelo (JSON compacto). */
  record(tool: string, input: unknown, outcome: ToolOutcome, durationMs: number): { content: string; isError: boolean; log: ToolCallLog } {
    const id = `t${this.calls.length + 1}`;
    if (!outcome.ok) {
      this.calls.push({ id, tool, input, result: null, error: outcome.error });
      return {
        content: JSON.stringify({ call: id, tool, error: outcome.error }),
        isError: true,
        log: { id, name: tool, input, status: "error", summary: outcome.error.slice(0, 300), durationMs },
      };
    }
    const result = outcome.result;
    this.calls.push({ id, tool, input, result, error: null });
    this.subjectSet.add(result.subject);
    const register = (metric: Metric) => {
      this.metricCount += 1;
      const entry: Entry = { id: `m${this.metricCount}`, tool, callId: id, metric, source: result.source, href: metric.href ?? result.href };
      this.byId.set(entry.id, entry);
      this.byKey.set(metric.key, entry);
      this.literal(metric.label);
      return { id: entry.id, label: metric.label, value: formatMetric(metric), period: metric.period };
    };
    const view = {
      call: id,
      tool,
      status: result.status,
      subject: result.subject,
      period: result.period ? `${result.period.from}/${result.period.to}` : null,
      source: result.source,
      summary: result.summary,
      metrics: result.metrics.map(register),
      rows: result.rows.map((row) => {
        this.subjectSet.add(row.subject);
        this.literal(row.label);
        for (const value of Object.values(row.fields)) if (typeof value === "string") this.literal(value);
        return { subject: row.subject, label: row.label, fields: row.fields, metrics: row.metrics.map(register) };
      }),
      missing: result.missing,
      notes: result.notes,
    };
    if (result.missing) this.literal(result.missing.what);
    return {
      content: JSON.stringify(view),
      isError: false,
      log: { id, name: tool, input, status: result.status, summary: result.summary.slice(0, 300), durationMs },
    };
  }

  /** Una llamada que el agente no puede hacer (tool fuera de su lista). */
  deny(tool: string, input: unknown, reason: string): { content: string; isError: boolean; log: ToolCallLog } {
    const id = `t${this.calls.length + 1}`;
    this.calls.push({ id, tool, input, result: null, error: reason });
    return { content: JSON.stringify({ call: id, tool, error: reason }), isError: true, log: { id, name: tool, input, status: "denied", summary: reason, durationMs: 0 } };
  }

  /** Evidencia heredada (la que revisa el abogado del diablo): entra en el libro con ids nuevos. */
  preload(items: readonly EvidenceItem[]): Map<string, string> {
    const ids = new Map<string, string>();
    for (const item of items) {
      if (item.value === null) continue;
      this.metricCount += 1;
      const entry: Entry = {
        id: `m${this.metricCount}`,
        tool: item.tool,
        callId: "inherited",
        metric: { key: item.key, label: item.label, value: item.value, unit: item.unit as Metric["unit"], period: item.period },
        source: item.source,
        href: item.href ?? "/",
      };
      this.byId.set(entry.id, entry);
      this.byKey.set(item.key, entry);
      this.literal(item.label);
      ids.set(item.ref, entry.id);
    }
    return ids;
  }

  private literal(text: string | null | undefined) {
    if (text && /\d/.test(text)) this.literalSet.add(text);
  }

  /** Resuelve un id de métrica (m12), de llamada (t3) o una clave estable a evidencia; null si no existe. */
  resolve(ref: string): EvidenceItem | null {
    const clean = ref.trim().replace(/^@/, "");
    const entry = this.byId.get(clean) ?? this.byKey.get(clean);
    if (entry) {
      return {
        ref: entry.id,
        tool: entry.tool,
        key: entry.metric.key,
        label: entry.metric.label,
        value: entry.metric.value,
        unit: entry.metric.unit,
        display: formatMetric(entry.metric),
        period: entry.metric.period,
        source: entry.source,
        href: entry.href,
      };
    }
    const call = this.calls.find((c) => c.id === clean);
    if (call?.result && call.result.status === "missing_data") {
      const r = call.result;
      return {
        ref: call.id,
        tool: call.tool,
        key: `missing:${call.tool}`,
        label: r.missing?.what ?? r.summary,
        value: null,
        unit: "missing",
        display: "sin datos",
        period: r.period ? `${r.period.from}/${r.period.to}` : "",
        source: r.source,
        href: r.missing?.href ?? r.href,
      };
    }
    return null;
  }

  /** Textos de las tools que el agente puede copiar tal cual (etiquetas, nombres, números de factura…). */
  literals(): string[] {
    return [...this.literalSet].sort((a, b) => b.length - a.length);
  }

  subjects(): ReadonlySet<string> {
    return this.subjectSet;
  }

  calledTools(): string[] {
    return this.calls.filter((c) => c.result !== null).map((c) => c.tool);
  }

  /** Resultados de una tool en esta ejecución (el último, el más reciente). */
  results(tool: string): ToolResult[] {
    return this.calls.filter((c) => c.tool === tool && c.result !== null).map((c) => c.result!);
  }

  metricCountTotal(): number {
    return this.metricCount;
  }

  /** Toda la evidencia (cada métrica) de la última llamada a una tool. */
  itemsOf(tool: string): EvidenceItem[] {
    const call = this.calls.filter((c) => c.tool === tool && c.result !== null).at(-1);
    if (!call) return [];
    return [...this.byId.values()].filter((e) => e.callId === call.id).map((e) => this.resolve(e.id)!);
  }
}
