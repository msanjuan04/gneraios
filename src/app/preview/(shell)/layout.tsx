import { brand } from "@/brand";
import { AppShell } from "@/components/app-shell/app-shell";

/** Estructura de la interfaz sin base de datos ni cifras inventadas. */
export default function PreviewShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      org={{ id: "preview", slug: "preview", name: brand.name }}
      member={{ fullName: "Socio de ejemplo", initials: "SE", role: "owner" }}
      orgs={[{ slug: "preview", name: brand.name }]}
      basePath="/preview"
      preview
    >
      {children}
    </AppShell>
  );
}
