import { describe, expect, it } from "vitest";
import { COMPANY_ASSIGNMENT, costAssignmentIssues, MAX_REBILL_MARKUP_BPS, normalizeCostAssignment, type CostAssignment } from "./allocation";

const forClient: CostAssignment = { allocation: "client", clientId: "acme", rebill: true, rebillMarkupBps: 1000 };

describe("a quién sirve un gasto (los mismos checks que la base de datos)", () => {
  it("de la empresa, de un cliente o de las webs alojadas, bien formados", () => {
    expect(costAssignmentIssues(COMPANY_ASSIGNMENT)).toEqual([]);
    expect(costAssignmentIssues(forClient)).toEqual([]);
    expect(costAssignmentIssues({ ...forClient, rebill: false, rebillMarkupBps: 0 })).toEqual([]);
    expect(costAssignmentIssues({ allocation: "hosted_sites", clientId: null, rebill: false, rebillMarkupBps: 0 })).toEqual([]);
  });

  it("un cliente si y solo si es de un cliente", () => {
    expect(costAssignmentIssues({ ...forClient, clientId: null })).toEqual(["clientRequired"]);
    expect(costAssignmentIssues({ ...forClient, clientId: "" })).toEqual(["clientRequired"]);
    expect(costAssignmentIssues({ ...COMPANY_ASSIGNMENT, clientId: "acme" })).toEqual(["clientNotAllowed"]);
    expect(costAssignmentIssues({ allocation: "hosted_sites", clientId: "acme", rebill: false, rebillMarkupBps: 0 })).toEqual(["clientNotAllowed"]);
  });

  it("solo se repercute lo que es de un cliente", () => {
    expect(costAssignmentIssues({ ...COMPANY_ASSIGNMENT, rebill: true })).toEqual(["rebillClientOnly"]);
    expect(costAssignmentIssues({ allocation: "hosted_sites", clientId: null, rebill: true, rebillMarkupBps: 0 })).toEqual(["rebillClientOnly"]);
  });

  it("el margen va del 0 al 1.000 %, en puntos básicos enteros", () => {
    expect(costAssignmentIssues({ ...forClient, rebillMarkupBps: MAX_REBILL_MARKUP_BPS })).toEqual([]);
    expect(costAssignmentIssues({ ...forClient, rebillMarkupBps: MAX_REBILL_MARKUP_BPS + 1 })).toEqual(["markupRange"]);
    expect(costAssignmentIssues({ ...forClient, rebillMarkupBps: -1 })).toEqual(["markupRange"]);
    expect(costAssignmentIssues({ ...forClient, rebillMarkupBps: 12.5 })).toEqual(["markupRange"]);
  });

  it("lo que se guarda: sin cliente fuera de «un cliente» y sin margen si no se repercute", () => {
    expect(normalizeCostAssignment({ allocation: "company", clientId: "acme", rebill: true, rebillMarkupBps: 500 })).toEqual(COMPANY_ASSIGNMENT);
    expect(normalizeCostAssignment({ ...forClient, rebill: false })).toEqual({ allocation: "client", clientId: "acme", rebill: false, rebillMarkupBps: 0 });
    expect(normalizeCostAssignment(forClient)).toEqual(forClient);
    expect(normalizeCostAssignment({ allocation: "hosted_sites", clientId: "x", rebill: true, rebillMarkupBps: 10 })).toEqual({
      allocation: "hosted_sites",
      clientId: null,
      rebill: false,
      rebillMarkupBps: 0,
    });
  });
});
