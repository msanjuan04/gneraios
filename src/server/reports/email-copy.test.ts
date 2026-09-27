import { describe, expect, it } from "vitest";
import { renderClientReportEmail } from "@/server/email/templates";

// El email del informe (plantilla 'client_report') en los tres idiomas: cada uno nombra el mes a su
// manera y el año nunca lleva separador de miles.

const params = { clientName: "Clínica Dental Mar Blau", senderName: "GNERAI" };

describe("renderClientReportEmail", () => {
  it("español", () => {
    const { subject, body } = renderClientReportEmail("es", { ...params, month: "2026-08-01" });
    expect(subject).toBe("Informe mensual · agosto de 2026 · GNERAI");
    expect(body).toContain("Te enviamos el informe de agosto de 2026: lo que hemos hecho para Clínica Dental Mar Blau");
    expect(body.trim().endsWith("GNERAI")).toBe(true);
  });

  it("catalán, con el apóstrofo delante de vocal", () => {
    expect(renderClientReportEmail("ca", { ...params, month: "2026-08-01" }).body).toContain("Us enviem l’informe d’agost de 2026:");
    expect(renderClientReportEmail("ca", { ...params, month: "2026-09-01" }).body).toContain("l’informe de setembre de 2026:");
    expect(renderClientReportEmail("ca", { ...params, month: "2026-10-01" }).subject).toBe("Informe mensual · octubre de 2026 · GNERAI");
  });

  it("inglés", () => {
    const { subject, body } = renderClientReportEmail("en", { ...params, month: "2027-01-01" });
    expect(subject).toBe("Monthly report · January 2027 · GNERAI");
    expect(body).toContain("Please find attached your report for January 2027: what we have done for Clínica Dental Mar Blau");
  });
});
