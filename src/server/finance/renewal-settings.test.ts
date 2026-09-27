import { describe, expect, it } from "vitest";
import { readOrgSettings } from "@/app/[org]/settings/schema";
import { renewalSettings } from "./renewal-settings";

describe("avisos de renovación (orgs.settings.finance)", () => {
  it("sin nada guardado, 14 días de aviso y las mensuales desde 50 €", () => {
    expect(renewalSettings({})).toEqual({ warningDays: 14, monthlyMinCents: 5000 });
    expect(renewalSettings(null)).toEqual(renewalSettings({}));
  });

  it("lo guardado manda; lo que falta o no es válido toma su valor por defecto, clave a clave", () => {
    expect(renewalSettings({ finance: { renewal_warning_days: 30, monthly_renewal_min_cents: 20_000 } })).toEqual({
      warningDays: 30,
      monthlyMinCents: 20_000,
    });
    expect(renewalSettings({ finance: { renewal_warning_days: 0, monthly_renewal_min_cents: -1 } })).toEqual({
      warningDays: 14,
      monthlyMinCents: 5000,
    });
    expect(renewalSettings({ finance: { renewal_warning_days: 7 } })).toEqual({ warningDays: 7, monthlyMinCents: 5000 });
    expect(renewalSettings({ finance: "14" })).toEqual(renewalSettings({}));
  });

  it("no toca el resto de ajustes de la org", () => {
    const settings = readOrgSettings({ payment_terms_days: 15, finance: { renewal_warning_days: 21 } });
    expect(settings.payment_terms_days).toBe(15);
    expect(settings.sites.ssl_warn_days).toBe(14);
    expect(settings.finance).toEqual({ renewal_warning_days: 21, monthly_renewal_min_cents: 5000 });
  });
});
