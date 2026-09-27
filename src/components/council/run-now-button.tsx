"use client";

import { LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { runAgentNow } from "@/app/[org]/council/actions";
import { Button } from "@/components/ui/button";
import type { AgentName } from "@/council/types";

/** "Ejecutar ahora" para un agente concreto (el trabajo va a la cola y se hace fuera de la petición). */
export function RunNowButton({ slug, agent, disabled, variant = "default" }: { slug: string; agent: AgentName; disabled?: boolean; variant?: "default" | "outline" }) {
  const t = useTranslations("council.strip");
  const tAgents = useTranslations("council.agents");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = () =>
    startTransition(async () => {
      const result = await runAgentNow(slug, agent);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("queued", { agent: tAgents(`${agent}.name`) }));
      router.refresh();
    });
  return (
    <Button onClick={run} disabled={disabled || pending} variant={variant} size="sm">
      {pending ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
      {t("runNowShort")}
    </Button>
  );
}
