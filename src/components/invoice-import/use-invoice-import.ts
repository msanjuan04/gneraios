"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type { PaymentMethod } from "@/domain/dataio/values";
import {
  centsToInput,
  computeTotals,
  type FormIssue,
  type FormMatches,
  type FormTotals,
  type ImportForm,
  initialForm,
  readiness,
  type ReviewReason,
  validateForm,
} from "@/domain/invoice-import/form";
import { type ImportSetup, taxIdKey } from "@/domain/invoice-import/match";
import type { ExtractedInvoice } from "@/domain/invoice-import/types";
import { createClientsForImport, recordImportPayment } from "@/server/invoice-import/actions";
import type { AttachResponse, CreatedClient, ExistingInvoice, ExtractionEngine, ExtractResponse, RowStatus, SaveResponse, SAVED_KINDS } from "./types";

/** Cuántos PDF se leen a la vez (Claude tarda unos segundos por factura). */
const CONCURRENCY = 3;

export type ItemPhase = "queued" | "reading" | "failed" | "extracted" | "saving" | "saved";

/** Qué hacer con una factura que ya está en la org: registrar su cobro y guardar su PDF. */
export type ExistingAction = {
  status: "paid" | "partial";
  paidOn: string;
  amount: string;
  method: PaymentMethod;
  reference: string;
  attach: boolean;
};

export type SavedResult = { kind: (typeof SAVED_KINDS)[number]; invoiceId: string; number: string; attached: boolean };

export type ImportItem = {
  id: string;
  file: File;
  phase: ItemPhase;
  error: string | null;
  engine: ExtractionEngine | null;
  extraction: ExtractedInvoice | null;
  existing: ExistingInvoice | null;
  existingAction: ExistingAction | null;
  /** Otra factura con el emisor y el número que ha escrito el socio. */
  numberTaken: ExistingInvoice | null;
  form: ImportForm | null;
  matches: FormMatches | null;
  /** Campos que el socio ha tocado: ya no enseñan lo seguro que era lo leído. */
  edited: string[];
  selected: boolean;
  result: SavedResult | null;
};

export type RowView = {
  status: RowStatus;
  reasons: ReviewReason[];
  issues: FormIssue[];
  totals: FormTotals | null;
};

type Action =
  | { type: "add"; items: ImportItem[] }
  | { type: "update"; id: string; fn: (item: ImportItem) => ImportItem }
  | { type: "map"; fn: (item: ImportItem) => ImportItem }
  | { type: "remove"; id: string };

function reducer(state: ImportItem[], action: Action): ImportItem[] {
  switch (action.type) {
    case "add":
      return [...state, ...action.items];
    case "update":
      return state.map((item) => (item.id === action.id ? action.fn(item) : item));
    case "map":
      return state.map(action.fn);
    case "remove":
      return state.filter((item) => item.id !== action.id);
  }
}

export function defaultExistingAction(existing: ExistingInvoice, extraction: ExtractedInvoice | null): ExistingAction {
  return {
    status: "paid",
    paidOn: extraction?.paidOn?.value ?? "",
    amount: centsToInput(Math.max(0, existing.outstandingCents)),
    method: existing.paymentMethod,
    reference: "",
    attach: existing.source === "import" && !existing.hasOriginal,
  };
}

/** Lo que falta por cobrar de una factura que ya estaba (0 si está cobrada o anulada). */
export function openAmount(existing: ExistingInvoice): number {
  return existing.status === "voided" || existing.status === "draft" ? 0 : Math.max(0, existing.outstandingCents);
}

/** Estado de la fila: leyendo, error, lista, a revisar, ya estaba (con o sin cobro pendiente), guardada. */
export function rowView(item: ImportItem, setup: ImportSetup | null): RowView {
  const none = { reasons: [], issues: [], totals: null };
  if (item.phase === "queued" || item.phase === "reading") return { status: "reading", ...none };
  if (item.phase === "failed") return { status: "error", ...none };
  if (item.phase === "saving") return { status: "saving", ...none };
  if (item.phase === "saved") return { status: "saved", ...none };
  if (item.existing) return { status: openAmount(item.existing) > 0 ? "payment" : "existing", ...none };
  if (!item.form || !item.matches || !item.extraction || !setup) return { status: "reading", ...none };
  const totals = computeTotals(item.form, setup);
  const issues = validateForm(item.form, setup, totals);
  if (item.numberTaken) issues.push({ code: "number_taken", severity: "error", field: "number", params: { number: item.numberTaken.number } });
  const ready = readiness(item.form, item.extraction, item.matches, issues, totals, item.edited.length > 0);
  return { status: ready.status, reasons: ready.reasons, issues, totals };
}

let counter = 0;
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`;

export function useInvoiceImport(opts: {
  slug: string;
  projectId: string | null;
  lockedClientId: string | null;
  setup: ImportSetup | null;
  defaultDescription: string;
  onClientsCreated: (clients: { id: string; name: string; taxId: string | null }[]) => void;
}) {
  const t = useTranslations("invoiceImport.errors");
  const [items, dispatch] = useReducer(reducer, []);
  const started = useRef(new Set<string>());
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  }, [items]);
  const get = useCallback((id: string) => latest.current.find((i) => i.id === id) ?? null, []);
  const patch = useCallback((id: string, fn: (item: ImportItem) => ImportItem) => dispatch({ type: "update", id, fn }), []);
  const { slug, projectId, lockedClientId, setup, defaultDescription, onClientsCreated } = opts;

  const addFiles = useCallback((files: File[]) => {
    dispatch({
      type: "add",
      items: files.map((file) => ({
        id: newId(),
        file,
        phase: "queued",
        error: null,
        engine: null,
        extraction: null,
        existing: null,
        existingAction: null,
        numberTaken: null,
        form: null,
        matches: null,
        edited: [],
        selected: false,
        result: null,
      })),
    });
  }, []);

  // Cola de lectura: como mucho CONCURRENCY a la vez; un fallo no para a las demás.
  useEffect(() => {
    const reading = items.filter((i) => i.phase === "reading").length;
    const next = items.filter((i) => i.phase === "queued" && !started.current.has(i.id)).slice(0, Math.max(0, CONCURRENCY - reading));
    for (const item of next) {
      started.current.add(item.id);
      patch(item.id, (i) => ({ ...i, phase: "reading" }));
      const body = new FormData();
      body.set("file", item.file);
      void (async () => {
        try {
          const res = await fetch(`/api/invoice-import/${slug}/extract`, { method: "POST", body });
          const json = (await res.json().catch(() => ({ ok: false, error: t(res.status === 413 ? "too_large" : "generic") }))) as ExtractResponse;
          if (!json.ok) {
            patch(item.id, (i) => ({ ...i, phase: "failed", error: json.error }));
            return;
          }
          patch(item.id, (i) => ({
            ...i,
            phase: "extracted",
            error: null,
            engine: json.engine,
            extraction: json.extraction,
            existing: json.existing,
            existingAction: json.existing ? defaultExistingAction(json.existing, json.extraction) : null,
          }));
        } catch {
          patch(item.id, (i) => ({ ...i, phase: "failed", error: t("network") }));
        }
      })();
    }
  }, [items, patch, slug, t]);

  // Con lo leído y los datos de la org, el formulario de cada factura.
  useEffect(() => {
    if (!setup) return;
    for (const item of items) {
      if (!item.extraction || item.form) continue;
      const { form, matches } = initialForm(item.extraction, setup, { lockedClientId, defaultDescription, keyPrefix: item.id });
      patch(item.id, (i) => (i.form ? i : { ...i, form, matches }));
    }
  }, [items, setup, lockedClientId, defaultDescription, patch]);

  const updateForm = useCallback(
    (id: string, field: string, fn: (form: ImportForm) => ImportForm) =>
      patch(id, (i) => (i.form ? { ...i, form: fn(i.form), error: null, edited: i.edited.includes(field) ? i.edited : [...i.edited, field] } : i)),
    [patch],
  );

  /** Guarda una factura nueva (con su PDF). true si ha ido bien. */
  const saveItem = useCallback(
    async (id: string): Promise<boolean> => {
      const item = get(id);
      if (!item?.form || item.phase === "saving" || item.phase === "saved") return false;
      patch(id, (i) => ({ ...i, phase: "saving", error: null }));
      const body = new FormData();
      body.set("file", item.file);
      body.set("form", JSON.stringify({ ...item.form, newClient: null }));
      if (projectId) body.set("projectId", projectId);
      try {
        const res = await fetch(`/api/invoice-import/${slug}/save`, { method: "POST", body });
        const json = (await res.json().catch(() => ({ ok: false, error: t("generic"), code: "generic" }))) as SaveResponse;
        if (json.ok) {
          patch(id, (i) => ({ ...i, phase: "saved", error: null, result: { kind: "imported", invoiceId: json.invoiceId, number: json.number, attached: json.attached } }));
          return true;
        }
        patch(id, (i) => ({
          ...i,
          phase: "extracted",
          error: json.error,
          ...(json.code === "duplicate" && json.existing ? { existing: json.existing, existingAction: defaultExistingAction(json.existing, i.extraction) } : {}),
        }));
        return false;
      } catch {
        patch(id, (i) => ({ ...i, phase: "extracted", error: t("network") }));
        return false;
      }
    },
    [get, patch, projectId, slug, t],
  );

  /** Guarda el PDF en una factura importada que aún no lo tiene. */
  const attachItem = useCallback(
    async (id: string, invoiceId: string): Promise<boolean> => {
      const item = get(id);
      if (!item) return false;
      const body = new FormData();
      body.set("file", item.file);
      body.set("invoiceId", invoiceId);
      if (projectId) body.set("projectId", projectId);
      try {
        const res = await fetch(`/api/invoice-import/${slug}/attach`, { method: "POST", body });
        const json = (await res.json().catch(() => ({ ok: false, error: t("generic") }))) as AttachResponse;
        if (!json.ok) patch(id, (i) => ({ ...i, error: json.error }));
        return json.ok;
      } catch {
        patch(id, (i) => ({ ...i, error: t("network") }));
        return false;
      }
    },
    [get, patch, projectId, slug, t],
  );

  /** Registra el cobro de una factura que ya estaba (y, si se pide, guarda su PDF). */
  const settleExisting = useCallback(
    async (id: string, withPayment: boolean): Promise<boolean> => {
      const item = get(id);
      const existing = item?.existing;
      const action = item?.existingAction;
      if (!item || !existing || !action || item.phase === "saving") return false;
      patch(id, (i) => ({ ...i, phase: "saving", error: null }));
      if (withPayment) {
        const amount = action.status === "paid" ? centsToInput(openAmount(existing)) : action.amount;
        const result = await recordImportPayment(slug, existing.id, { amount, paid_on: action.paidOn, method: action.method, reference: action.reference }, { projectId });
        if (!result.ok) {
          patch(id, (i) => ({ ...i, phase: "extracted", error: result.error }));
          return false;
        }
      }
      const attached = action.attach ? await attachItem(id, existing.id) : false;
      patch(id, (i) => ({
        ...i,
        phase: "saved",
        result: { kind: withPayment ? "payment" : "attached", invoiceId: existing.id, number: existing.number, attached: attached || existing.hasOriginal },
      }));
      return true;
    },
    [attachItem, get, patch, projectId, slug],
  );

  /** Da de alta los clientes que faltan (uno por NIF) y los pone en sus facturas. */
  const createClients = useCallback(
    async (ids: string[]): Promise<{ ok: true; results: CreatedClient[] } | { ok: false; error: string }> => {
      const drafts = ids.flatMap((id) => {
        const item = get(id);
        return item?.form && !item.form.clientId && item.form.newClient ? [{ key: id, draft: item.form.newClient }] : [];
      });
      if (drafts.length === 0) return { ok: true, results: [] };
      const result = await createClientsForImport(slug, drafts);
      if (!result.ok) return result;
      const created: { id: string; name: string; taxId: string | null }[] = [];
      for (const r of result.results) {
        if (!("clientId" in r)) {
          patch(r.key, (i) => ({ ...i, error: r.error }));
          continue;
        }
        const draft = drafts.find((d) => d.key === r.key)!.draft;
        if (!created.some((c) => c.id === r.clientId)) created.push({ id: r.clientId, name: r.name, taxId: draft.taxId || null });
        patch(r.key, (i) => (i.form ? { ...i, error: null, form: { ...i.form, clientId: r.clientId, newClient: null } } : i));
      }
      // Otras facturas del mismo cliente (mismo NIF) que aún no lo tenían.
      dispatch({
        type: "map",
        fn: (i) => {
          if (!i.form || i.form.clientId || !i.form.newClient) return i;
          const key = taxIdKey(i.form.newClient.taxId);
          const match = key ? created.find((c) => taxIdKey(c.taxId) === key) : undefined;
          return match ? { ...i, form: { ...i.form, clientId: match.id, newClient: null } } : i;
        },
      });
      onClientsCreated(created);
      return { ok: true, results: result.results };
    },
    [get, onClientsCreated, patch, slug],
  );

  /** «Marcar como cobradas el día…» en las seleccionadas. */
  const markPaid = useCallback((ids: string[], paidOn: string) => {
    dispatch({
      type: "map",
      fn: (i) => {
        if (!ids.includes(i.id) || i.phase === "saved" || i.phase === "saving") return i;
        if (i.existing && i.existingAction) return { ...i, existingAction: { ...i.existingAction, status: "paid", paidOn } };
        if (!i.form) return i;
        return { ...i, form: { ...i.form, payment: { ...i.form.payment, status: "paid", paidOn } } };
      },
    });
  }, []);

  const remove = useCallback((id: string) => dispatch({ type: "remove", id }), []);
  const setSelected = useCallback((ids: string[], selected: boolean) => dispatch({ type: "map", fn: (i) => (ids.includes(i.id) ? { ...i, selected } : i) }), []);
  const setExistingAction = useCallback(
    (id: string, fn: (a: ExistingAction) => ExistingAction) => patch(id, (i) => (i.existingAction ? { ...i, existingAction: fn(i.existingAction), error: null } : i)),
    [patch],
  );
  const setNumberTaken = useCallback((id: string, existing: ExistingInvoice | null) => patch(id, (i) => ({ ...i, numberTaken: existing })), [patch]);
  const retry = useCallback(
    (id: string) => {
      started.current.delete(id);
      patch(id, (i) => ({ ...i, phase: "queued", error: null }));
    },
    [patch],
  );

  return { items, addFiles, updateForm, saveItem, settleExisting, attachItem, createClients, markPaid, remove, setSelected, setExistingAction, setNumberTaken, retry };
}
