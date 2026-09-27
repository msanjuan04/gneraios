"use client";

import { useParams } from "next/navigation";
import { ErrorPanel } from "@/components/app-shell/error-panel";

/** Una pantalla de la org ha fallado: el error se ve dentro de la app, con la barra lateral. */
export default function OrgError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { org } = useParams<{ org: string }>();
  return <ErrorPanel error={error} retry={retry} homeHref={org ? `/${org}` : "/"} />;
}
