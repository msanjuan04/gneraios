import { describe, expect, it } from "vitest";
import { domainExpiry, expirySeverity, parseCertificateDate, sslExpiry } from "./expiry";

const tz = "Europe/Madrid";

describe("sslExpiry", () => {
  const now = new Date("2026-09-26T10:00:00Z");

  it("cuenta días naturales de la org hasta el día en que caduca", () => {
    expect(sslExpiry("2026-10-10T09:00:00Z", now, tz)).toEqual({ expiresOn: "2026-10-10", daysLeft: 14, expired: false });
    // 23:30 UTC ya es el día siguiente en Madrid.
    expect(sslExpiry("2026-10-10T23:30:00Z", now, tz)).toEqual({ expiresOn: "2026-10-11", daysLeft: 15, expired: false });
  });

  it("hoy más tarde son 0 días; pasado el instante, caducado", () => {
    expect(sslExpiry("2026-09-26T15:00:00Z", now, tz)).toEqual({ expiresOn: "2026-09-26", daysLeft: 0, expired: false });
    expect(sslExpiry("2026-09-26T09:59:59Z", now, tz)).toEqual({ expiresOn: "2026-09-26", daysLeft: 0, expired: true });
    expect(sslExpiry("2026-09-20T09:00:00Z", now, tz)).toEqual({ expiresOn: "2026-09-20", daysLeft: -6, expired: true });
  });

  it("sin certificado (o con una fecha rota) no se sabe", () => {
    expect(sslExpiry(null, now, tz)).toBeNull();
    expect(sslExpiry("mañana", now, tz)).toBeNull();
  });
});

describe("domainExpiry", () => {
  it("vale hasta el día apuntado, incluido", () => {
    expect(domainExpiry("2026-10-26", "2026-09-26")).toEqual({ expiresOn: "2026-10-26", daysLeft: 30, expired: false });
    expect(domainExpiry("2026-09-26", "2026-09-26")).toEqual({ expiresOn: "2026-09-26", daysLeft: 0, expired: false });
    expect(domainExpiry("2026-09-25", "2026-09-26")).toEqual({ expiresOn: "2026-09-25", daysLeft: -1, expired: true });
    expect(domainExpiry(null, "2026-09-26")).toBeNull();
    expect(domainExpiry("2026-02-30", "2026-09-26")).toBeNull();
  });
});

describe("expirySeverity", () => {
  it("dentro de los días de aviso es un aviso (el borde incluido); caducado es caducado", () => {
    const info = (daysLeft: number, expired = daysLeft < 0) => ({ expiresOn: "2026-10-10", daysLeft, expired });
    expect(expirySeverity(info(15), 14)).toBe("ok");
    expect(expirySeverity(info(14), 14)).toBe("warning");
    expect(expirySeverity(info(0), 14)).toBe("warning");
    expect(expirySeverity(info(0, true), 14)).toBe("expired");
    expect(expirySeverity(info(-3), 14)).toBe("expired");
    expect(expirySeverity(null, 14)).toBeNull();
  });
});

describe("parseCertificateDate", () => {
  it("entiende la fecha de OpenSSL que da Node", () => {
    expect(parseCertificateDate("Dec  3 23:59:59 2026 GMT")).toBe("2026-12-03T23:59:59.000Z");
    expect(parseCertificateDate("Sep 26 08:05:00 2027 GMT")).toBe("2027-09-26T08:05:00.000Z");
    expect(parseCertificateDate("Feb 29 12:00:00 2028 GMT")).toBe("2028-02-29T12:00:00.000Z");
  });

  it("lo demás no", () => {
    expect(parseCertificateDate(undefined)).toBeNull();
    expect(parseCertificateDate("")).toBeNull();
    expect(parseCertificateDate("Foo  3 23:59:59 2026 GMT")).toBeNull();
    expect(parseCertificateDate("Feb 30 12:00:00 2026 GMT")).toBeNull();
    expect(parseCertificateDate("2026-12-03T23:59:59Z")).toBeNull();
  });
});
