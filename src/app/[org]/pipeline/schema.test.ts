import { describe, expect, it } from "vitest";
import { dealFormSchema, moneyToCents, percentToBps } from "./schema";

const base = {
  title: "Web + SEO",
  client_id: "",
  new_client_name: "Cafetería del Port",
  stage_id: "7b2a4f1e-3c1d-4b8e-9a6f-2d5c8e1f0a3b",
  est_one_off: "",
  est_mrr: "",
  probability: "",
  source_id: "",
  brought_by_member_id: "",
  owner_member_id: "",
  next_action: "",
  next_action_on: "",
  loss_reason_id: "",
  loss_note: "",
};

describe("importes y probabilidad del deal", () => {
  it("lee importes escritos a la española; vacío es 0", () => {
    expect(moneyToCents("")).toBe(0);
    expect(moneyToCents("2.400")).toBe(240_000);
    expect(moneyToCents("180,50")).toBe(18_050);
    expect(moneyToCents("mil")).toBeNull();
  });

  it("la probabilidad vacía usa la de la etapa; fuera de 0-100 no vale", () => {
    expect(percentToBps("")).toBeNull();
    expect(percentToBps("35")).toBe(3500);
    expect(percentToBps("12,5")).toBe(1250);
    expect(percentToBps("140")).toBeUndefined();
  });

  it("exige un cliente existente o el nombre de uno nuevo", () => {
    expect(dealFormSchema.safeParse(base).success).toBe(true);
    const noClient = dealFormSchema.safeParse({ ...base, new_client_name: "  " });
    expect(noClient.success).toBe(false);
    expect(noClient.error?.issues[0]?.message).toBe("clientRequired");
  });

  it("rechaza importes mal escritos con un mensaje propio", () => {
    const r = dealFormSchema.safeParse({ ...base, est_one_off: "12.00.0" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain("money");
  });
});
