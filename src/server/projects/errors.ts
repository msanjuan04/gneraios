import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Errores esperados de la base de datos (supabase/migrations/20260926280000_proyectos.sql) →
 * claves de i18n (`projects.errors.*`). Lo que no esté aquí sale como error genérico.
 */
export function knownProjectError(error: PostgrestError): string | undefined {
  switch (error.hint) {
    case "task_not_in_project":
      return "projects.errors.taskNotInProject";
    case "project_archived":
      return "projects.errors.projectArchived";
    case "project_not_found":
      return "projects.errors.notFound";
    case "template_not_found":
      return "projects.errors.templateNotFound";
    case "task_project_fixed":
      return "projects.errors.taskProjectFixed";
  }
  const where = `${error.message} ${error.details ?? ""}`;
  if (error.code === "23505" && where.includes("time_entries_one_running_idx")) return "projects.errors.timerRunning";
  if (error.code === "23505" && where.includes("project_templates_name_idx")) return "projects.errors.templateNameTaken";
  if (error.code === "23503" && where.includes("contract")) return "projects.errors.contractMismatch";
  if (error.code === "23503") return "projects.errors.invalidReference";
  if (error.code === "42501" || /row-level security/.test(error.message)) return "common.errorPermission";
  return undefined;
}
