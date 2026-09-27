"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/server/session";

export type SearchResult = {
  kind: "client" | "contact" | "deal" | "contract" | "invoice" | "quote" | "project";
  id: string;
  clientId: string;
  title: string;
  subtitle: string | null;
};

const querySchema = z.object({ slug: z.string().min(1).max(40), query: z.string().trim().min(2).max(80) });

/** Búsqueda de ⌘K: clientes, contactos, deals, contratos, facturas, presupuestos y proyectos (sin acentos; RLS aplica). */
export async function searchOrg(slug: string, query: string): Promise<SearchResult[]> {
  const parsed = querySchema.safeParse({ slug, query });
  if (!parsed.success) return [];
  const { org } = await getOrgContext(parsed.data.slug);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_org", { p_org: org.id, p_query: parsed.data.query, p_limit: 5 });
  if (error) {
    console.error("[search]", error);
    return [];
  }
  return (data ?? []).flatMap((r) =>
    r.kind === "client" ||
    r.kind === "contact" ||
    r.kind === "deal" ||
    r.kind === "contract" ||
    r.kind === "invoice" ||
    r.kind === "quote" ||
    r.kind === "project"
      ? [{ kind: r.kind, id: r.id, clientId: r.client_id, title: r.title, subtitle: r.subtitle }]
      : [],
  );
}
