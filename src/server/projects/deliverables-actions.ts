"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import { dbFailure, failure, forbidden, invalidInput, partnerContext } from "@/server/action-utils";

const createSchema = z.object({
  project_id: z.guid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000),
  due_on: z.union([z.literal(""), z.iso.date()]),
  assignee_member_id: z.union([z.literal(""), z.guid()]),
});
const statusSchema = z.enum(["planned", "in_progress", "review", "sent", "accepted", "cancelled"]);
const updateSchema = z.object({
  deliverable_id: z.guid(),
  status: statusSchema,
  client_file_id: z.union([z.literal(""), z.guid()]),
});

function refresh(slug: string, projectId: string, clientId: string) {
  revalidatePath(`/${slug}/projects/${projectId}`);
  revalidatePath(`/${slug}/projects`);
  revalidatePath(`/${slug}`);
  revalidatePath(`/${slug}/clients/${clientId}`);
}

export async function createProjectDeliverable(slug: string, input: z.input<typeof createSchema>): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase.from("projects").select("client_id").eq("org_id", ctx.org.id).eq("id", parsed.data.project_id).maybeSingle();
  if (projectError) return dbFailure(projectError, "deliverables.project");
  if (!project) return failure("projects.errors.notFound");
  if (!project.client_id) return failure("projects.deliverables.clientRequired");
  const { error } = await supabase.from("project_deliverables").insert({
    org_id: ctx.org.id,
    project_id: parsed.data.project_id,
    client_id: project.client_id,
    title: parsed.data.title,
    description: parsed.data.description || null,
    due_on: parsed.data.due_on || null,
    assignee_member_id: parsed.data.assignee_member_id || null,
  });
  if (error) return dbFailure(error, "deliverables.create");
  refresh(ctx.org.slug, parsed.data.project_id, project.client_id);
  return { ok: true };
}

export async function updateProjectDeliverable(slug: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const ctx = await partnerContext(slug);
  if (!ctx) return forbidden();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_deliverables")
    .update({ status: parsed.data.status, client_file_id: parsed.data.client_file_id || null })
    .eq("id", parsed.data.deliverable_id)
    .eq("org_id", ctx.org.id)
    .select("project_id, client_id")
    .maybeSingle();
  if (error) return dbFailure(error, "deliverables.update");
  if (!data) return failure("projects.errors.notFound");
  refresh(ctx.org.slug, data.project_id, data.client_id);
  return { ok: true };
}
