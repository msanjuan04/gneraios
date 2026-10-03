"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { markThreadSeen } from "@/app/[org]/mail/actions";

/**
 * Al abrir una conversación con algo sin leer, se marca como leída (solo en nuestra copia: en el
 * servidor de correo todo sigue como estaba). No pinta nada.
 */
export function MailMarkSeen({ slug, threadKey, unread }: { slug: string; threadKey: string; unread: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!unread) return;
    let cancelled = false;
    // Un momento antes: si se pasa por la conversación sin pararse, no se da por leída.
    const timer = setTimeout(async () => {
      const result = await markThreadSeen(slug, threadKey);
      if (!cancelled && result.ok) router.refresh();
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, threadKey, unread, router]);
  return null;
}
