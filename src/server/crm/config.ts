import "server-only";
import { cache } from "react";
import type { Enums } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type StageOption = {
  id: string;
  name: string;
  position: number;
  kind: Enums<"stage_kind">;
  defaultProbabilityBps: number;
};
export type NamedOption = { id: string; name: string };
export type MemberOption = { id: string; fullName: string; initials: string };

export type CrmConfig = {
  stages: StageOption[];
  sources: NamedOption[];
  lossReasons: NamedOption[];
  members: MemberOption[];
};

/** Etapas, fuentes, motivos de pérdida y socios activos de una org (una vez por petición). */
export const getCrmConfig = cache(async (orgId: string): Promise<CrmConfig> => {
  const supabase = await createClient();
  const [stages, sources, reasons, members] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, position, kind, default_probability_bps")
      .eq("org_id", orgId)
      .is("archived_at", null)
      .order("position"),
    supabase.from("acquisition_sources").select("id, name").eq("org_id", orgId).is("archived_at", null).order("position"),
    supabase.from("loss_reasons").select("id, name").eq("org_id", orgId).is("archived_at", null).order("position"),
    supabase
      .from("members")
      .select("id, full_name, initials")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("full_name"),
  ]);
  for (const r of [stages, sources, reasons, members]) if (r.error) throw r.error;

  return {
    stages: (stages.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
      defaultProbabilityBps: s.default_probability_bps,
    })),
    sources: sources.data ?? [],
    lossReasons: reasons.data ?? [],
    members: (members.data ?? []).map((m) => ({ id: m.id, fullName: m.full_name, initials: m.initials })),
  };
});
