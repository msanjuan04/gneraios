import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUiPreviewEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Vista previa" };

/** Toda la vista previa (con y sin shell) solo existe en desarrollo o si se activa a propósito. */
export default function PreviewRootLayout({ children }: LayoutProps<"/preview">) {
  if (!isUiPreviewEnabled()) notFound();
  return children;
}
