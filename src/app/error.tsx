"use client";

import { ErrorPanel } from "@/components/app-shell/error-panel";

/** Fallo fuera de una org (entrada, onboarding…): la misma tarjeta, con vuelta al inicio. */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} homeHref="/" />;
}
