import { describe, expect, it } from "vitest";
import {
  clientInvoiceStatus,
  enabledPortalSections,
  formatPortalDate,
  negotiatePortalLocale,
  nextPlannedOn,
  normalizeEmail,
  normalizeIp,
  normalizeName,
  paymentInstruction,
  phaseProgress,
  projectPhases,
  publicLinkState,
  publicQuoteState,
  requestEvidence,
  resolvePortalSections,
} from "./index";

const headers = (values: Record<string, string>) => (name: string) => values[name] ?? null;

describe("evidencia de la petición", () => {
  it("toma la IP del proxy de la plataforma y, si no, la primera de X-Forwarded-For; guarda la cadena entera", () => {
    expect(requestEvidence(headers({ "do-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.2" }))).toEqual({
      ipAddress: "203.0.113.7",
      forwardedFor: "198.51.100.1, 10.0.0.2",
      userAgent: null,
    });
    expect(requestEvidence(headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.2", "user-agent": "Mozilla/5.0" }))).toMatchObject({
      ipAddress: "198.51.100.1",
      userAgent: "Mozilla/5.0",
    });
    expect(requestEvidence(headers({}))).toEqual({ ipAddress: null, forwardedFor: null, userAgent: null });
  });

  it("no se cree cualquier cosa como IP, recorta y limpia los caracteres de control", () => {
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("203.0.113.7:8080")).toBe("203.0.113.7");
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("<script>")).toBeNull();
    const ua = requestEvidence(headers({ "user-agent": `Bot\u0000\n${"x".repeat(900)}` })).userAgent!;
    expect(ua).toHaveLength(500);
    expect(ua).not.toMatch(/[\u0000-\u001f]/);
  });

  it("normaliza nombre y email como los guarda la base de datos", () => {
    expect(normalizeName("  Laura   Puig ")).toBe("Laura Puig");
    expect(normalizeEmail(" Laura@Example.COM ")).toBe("laura@example.com");
  });
});

describe("estados", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  it("un enlace revocado lo es aunque no haya caducado; si no, caduca con su fecha", () => {
    expect(publicLinkState({ revokedAt: "2026-09-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" }, now)).toBe("revoked");
    expect(publicLinkState({ revokedAt: null, expiresAt: "2026-09-26T10:00:00Z" }, now)).toBe("expired");
    expect(publicLinkState({ revokedAt: null, expiresAt: "2026-09-26T10:00:01Z" }, now)).toBe("active");
  });

  it("un enviado con la validez vencida está caducado; el último día aún se acepta", () => {
    expect(publicQuoteState({ status: "sent", validUntil: "2026-09-26" }, "2026-09-26")).toBe("open");
    expect(publicQuoteState({ status: "sent", validUntil: "2026-09-25" }, "2026-09-26")).toBe("expired");
    expect(publicQuoteState({ status: "accepted", validUntil: "2026-01-01" }, "2026-09-26")).toBe("accepted");
    expect(publicQuoteState({ status: "rejected", validUntil: null }, "2026-09-26")).toBe("rejected");
    expect(publicQuoteState({ status: "draft", validUntil: null }, "2026-09-26")).toBe("closed");
  });

  it("elige el idioma del navegador que hablamos, por peso", () => {
    expect(negotiatePortalLocale("ca-ES,ca;q=0.9,es;q=0.8")).toBe("ca");
    expect(negotiatePortalLocale("fr-FR,fr;q=0.9,en;q=0.8,es;q=0.7")).toBe("en");
    expect(negotiatePortalLocale("de;q=0.9,es;q=0")).toBe("es");
    expect(negotiatePortalLocale(null, "en")).toBe("en");
  });

  it("formatea fechas civiles en el idioma del cliente, sin desfases de zona", () => {
    expect(formatPortalDate("2026-10-01", "es")).toBe("1 de octubre de 2026");
    expect(formatPortalDate("2026-10-01", "ca")).toMatch(/^1 d.octubre (de|del) 2026$/);
    expect(formatPortalDate("2026-10-01", "en")).toBe("1 October 2026");
    expect(formatPortalDate("2026-01-31", "es", "short")).toBe("31/01/2026");
  });
});

describe("secciones", () => {
  it("lo guardado manda sobre el valor por defecto; lo desconocido o raro se ignora", () => {
    const flags = resolvePortalSections({ web_data: true, files: false, other: true, progress: "no" });
    expect(flags).toMatchObject({ web_data: true, files: false, progress: true, documents: true });
    expect(enabledPortalSections(flags)).toEqual(["progress", "work_log", "services", "documents", "requests", "web_data"]);
    expect(enabledPortalSections(resolvePortalSections(null))).not.toContain("web_data");
    expect(resolvePortalSections(["files"]).files).toBe(true);
  });
});

describe("fases del proyecto", () => {
  const milestones = [
    { id: "b", position: 1, label: "Diseño ", plannedOn: "2026-10-15" },
    { id: "a", position: 0, label: "Inicio", plannedOn: "2026-09-26" },
    { id: "c", position: 2, label: "Entrega", plannedOn: null },
  ];

  it("hecha si su hito está facturado, en curso la primera sin facturar, el resto después", () => {
    const phases = projectPhases(milestones, new Set(["a"]));
    expect(phases.map((p) => [p.id, p.state, p.label])).toEqual([
      ["a", "done", "Inicio"],
      ["b", "current", "Diseño"],
      ["c", "upcoming", "Entrega"],
    ]);
    expect(phaseProgress(phases)).toEqual({ done: 1, total: 3, ratio: 1 / 3 });
    expect(nextPlannedOn(phases)).toBe("2026-10-15");
  });

  it("sin hitos no hay progreso; todo facturado, todo hecho", () => {
    expect(phaseProgress([])).toEqual({ done: 0, total: 0, ratio: 0 });
    const done = projectPhases(milestones, new Set(["a", "b", "c"]));
    expect(done.every((p) => p.state === "done")).toBe(true);
    expect(nextPlannedOn(done)).toBeNull();
  });
});

describe("cómo pagar una factura", () => {
  const base = {
    kind: "ordinary" as const,
    status: "issued" as const,
    number: "2026-0042",
    outstandingCents: 95_400,
    dueOn: "2026-10-26",
    paymentMethod: "transfer" as const,
    iban: "ES9121000418450200051332",
  };

  it("por transferencia: IBAN agrupado, lo que falta por cobrar y el número como concepto", () => {
    expect(paymentInstruction(base)).toEqual({
      kind: "transfer",
      iban: "ES91 2100 0418 4502 0005 1332",
      amountCents: 95_400,
      reference: "2026-0042",
      dueOn: "2026-10-26",
      overdue: false,
    });
    expect(paymentInstruction({ ...base, status: "overdue", outstandingCents: 10_000 })).toMatchObject({ overdue: true, amountCents: 10_000 });
    expect(paymentInstruction({ ...base, iban: null })).toMatchObject({ kind: "transfer", iban: null });
  });

  it("domiciliada: se carga sola", () => {
    expect(paymentInstruction({ ...base, paymentMethod: "sepa_debit" })).toEqual({
      kind: "sepa_debit",
      amountCents: 95_400,
      dueOn: "2026-10-26",
      overdue: false,
    });
  });

  it("cobrada, anulada, rectificativa o sin nada pendiente: nada que pagar", () => {
    expect(paymentInstruction({ ...base, status: "paid" })).toBeNull();
    expect(paymentInstruction({ ...base, status: "voided" })).toBeNull();
    expect(paymentInstruction({ ...base, kind: "rectifying" })).toBeNull();
    expect(paymentInstruction({ ...base, outstandingCents: 0 })).toBeNull();
  });

  it("el cliente ve pagada, pendiente, vencida, anulada o rectificativa, nunca un borrador", () => {
    expect(clientInvoiceStatus("ordinary", "issued")).toBe("pending");
    expect(clientInvoiceStatus("ordinary", "overdue")).toBe("overdue");
    expect(clientInvoiceStatus("ordinary", "paid")).toBe("paid");
    expect(clientInvoiceStatus("ordinary", "voided")).toBe("voided");
    expect(clientInvoiceStatus("rectifying", "issued")).toBe("rectifying");
    expect(clientInvoiceStatus("ordinary", "draft")).toBeNull();
    expect(clientInvoiceStatus("ordinary", "issuing")).toBeNull();
  });
});

describe("entregables", () => {
  it("nombres de fichero seguros para Storage", async () => {
    const { safeFileName } = await import("./files");
    expect(safeFileName("Propuesta final (v2).PDF")).toBe("Propuesta-final-v2.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\Marc\\Logotipo Mataró.svg")).toBe("Logotipo-Mataro.svg");
    expect(safeFileName(".env")).toBe("env");
    expect(safeFileName("???")).toBe("archivo");
    expect(safeFileName(`${"a".repeat(300)}.png`).length).toBeLessThanOrEqual(100);
  });

  it("solo enlaces http(s) con host", async () => {
    const { isSafeUrl } = await import("./files");
    expect(isSafeUrl("https://figma.com/file/abc")).toBe(true);
    expect(isSafeUrl("http://staging.example.com")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("ftp://example.com")).toBe(false);
    expect(isSafeUrl("https://exa mple.com")).toBe(false);
    expect(isSafeUrl("no es una url")).toBe(false);
  });

  it("tamaños legibles en el idioma del cliente", async () => {
    const { formatBytes } = await import("./files");
    expect(formatBytes(512, "es-ES")).toBe("512 B");
    expect(formatBytes(1536, "es-ES")).toBe("1,5 KB");
    expect(formatBytes(1536, "en-IE")).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024, "es-ES")).toBe("25 MB");
  });
});
