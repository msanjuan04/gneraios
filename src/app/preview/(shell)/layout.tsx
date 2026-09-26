import { brand } from "@/brand";
import { AppShell } from "@/components/app-shell/app-shell";

/** La interfaz real con datos de ejemplo, para verla sin base de datos. */
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
