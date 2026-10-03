"use client";

import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";

/**
 * Filtrar la bandeja por cliente o lead. Es un desplegable nativo a propósito: se abre con un clic,
 * se busca escribiendo la primera letra y funciona igual en el móvil.
 */
export function MailClientFilter({ clients, value }: { clients: { id: string; name: string }[]; value: string }) {
  const t = useTranslations("mail");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const change = (next: string) => {
    const search = new URLSearchParams(params.toString());
    if (next) search.set("client", next);
    else search.delete("client");
    // Cambiar de filtro vuelve a la primera página y cierra la conversación abierta.
    search.delete("page");
    search.delete("thread");
    start(() => router.push(`${pathname}${search.size ? `?${search}` : ""}`));
  };

  return (
    <label className="relative block">
      <span className="sr-only">{t("clientFilter")}</span>
      <Users className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <select
        value={value}
        onChange={(event) => change(event.target.value)}
        disabled={pending}
        className={cn(
          "h-10 w-full appearance-none rounded-full border bg-card/60 pl-9 pr-4 text-sm font-medium outline-none transition-colors",
          "hover:bg-card focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30",
          value && "border-primary/50 text-primary",
        )}
      >
        <option value="">{t("allClients")}</option>
        <option value="none">{t("noClient")}</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </select>
    </label>
  );
}
