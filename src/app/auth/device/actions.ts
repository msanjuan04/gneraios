"use server";

import { redirect } from "next/navigation";
import { confirmDevice } from "@/server/auth/access-code";

/** "Sí, soy yo": confirma el dispositivo y, si es este mismo navegador, entra. */
export async function confirmDeviceAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = await confirmDevice(token);
  if (result.status === "signed_in") redirect("/");
  redirect(result.status === "confirmed" ? "/auth/device?done=1" : "/auth/device?invalid=1");
}
