import type { z } from "zod";
import { onboardingSchema } from "@/lib/validation/onboarding";

/** El perfil del miembro: el mismo bloque que rellena el owner en el onboarding. */
export const profileSchema = onboardingSchema.shape.owner;

export type ProfileInput = z.input<typeof profileSchema>;
