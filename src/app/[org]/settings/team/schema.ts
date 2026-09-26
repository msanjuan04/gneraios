import { z } from "zod";
import { invitationSchema } from "@/lib/validation/onboarding";

export const ROLES = ["owner", "partner", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export { invitationSchema };
export type InvitationInput = z.input<typeof invitationSchema>;

export const memberRoleSchema = z.object({ member_id: z.guid(), role: z.enum(ROLES) });
export type MemberRoleInput = z.input<typeof memberRoleSchema>;

export const memberAccessSchema = z.object({ member_id: z.guid(), active: z.boolean() });
export type MemberAccessInput = z.input<typeof memberAccessSchema>;

/** Una invitación caduca a los 14 días, como marca la base de datos por defecto. */
export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
