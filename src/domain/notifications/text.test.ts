import { describe, expect, it } from "vitest";
import { notificationMessageKey, notificationValues } from "./text";

const fmt = { date: (d: string) => `fecha:${d}`, money: (c: number) => `${c / 100} €` };

describe("texto de un aviso", () => {
  it("formatea fecha e importe y deja el resto de parámetros como vienen", () => {
    expect(notificationValues({ client: "Clínica", date: "2026-10-01", amount_cents: 45_000, days: 7 }, fmt)).toEqual({
      client: "Clínica",
      date: "fecha:2026-10-01",
      amount: "450 €",
      amount_cents: 45_000,
      days: 7,
    });
  });

  it("sin fecha, importe o días no rompe el mensaje", () => {
    expect(notificationValues({ number: "GS2026-0004", note: null }, fmt)).toEqual({ number: "GS2026-0004", date: "", amount: "", days: 0 });
  });

  it("Verifactu a 0 días cambia de mensaje", () => {
    expect(notificationMessageKey("verifactu_deadline", { days: 0 })).toBe("verifactu_required");
    expect(notificationMessageKey("verifactu_deadline", { days: 30 })).toBe("verifactu_deadline");
    expect(notificationMessageKey("quote_accepted", {})).toBe("quote_accepted");
  });

  it("un rechazo con motivo lo cita", () => {
    expect(notificationMessageKey("quote_rejected", { reason: "Muy caro" })).toBe("quote_rejected_reason");
    expect(notificationMessageKey("quote_rejected", { reason: " " })).toBe("quote_rejected");
    expect(notificationMessageKey("quote_rejected", {})).toBe("quote_rejected");
  });

  it("un certificado o un dominio ya caducado cambia de mensaje", () => {
    expect(notificationMessageKey("ssl_expiring", { days: 14 })).toBe("ssl_expiring");
    expect(notificationMessageKey("ssl_expiring", { days: 0 })).toBe("ssl_expiring");
    expect(notificationMessageKey("ssl_expiring", { days: -1 })).toBe("ssl_expired");
    expect(notificationMessageKey("domain_expiring", { days: 30 })).toBe("domain_expiring");
    expect(notificationMessageKey("domain_expiring", { days: -3 })).toBe("domain_expired");
    expect(notificationMessageKey("site_down", { error: "timeout" })).toBe("site_down");
  });

  it("lo que estuvo caída una web se lee como una duración", () => {
    expect(notificationValues({ site: "Clínica", minutes: 95 }, fmt)).toMatchObject({ site: "Clínica", minutes: 95, duration: "1 h 35 min" });
    expect(notificationValues({ site: "Clínica", minutes: 12.4 }, fmt)).toMatchObject({ duration: "12 min" });
    expect(notificationValues({ site: "Clínica" }, fmt)).not.toHaveProperty("duration");
  });
});
