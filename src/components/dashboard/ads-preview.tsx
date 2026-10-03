import { Eye, Megaphone, MousePointerClick, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Diseño sin acceso a datos de la cuenta publicitaria. */
export function AdsPreview() {
  return (
    <div className="w-full space-y-6">
      <header><h2 className="text-4xl font-extrabold heading-tight">Ads</h2><p className="mt-2 text-muted-foreground">Operación interna y resultados que se comparten con cada cliente.</p></header>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { icon: Eye, label: "Impresiones" },
          { icon: MousePointerClick, label: "Clics" },
          { icon: Wallet, label: "Inversión" },
          { icon: Megaphone, label: "CTR" },
        ].map(({ icon: Icon, label }) => <Card key={label}><CardHeader className="pb-1"><CardDescription className="flex items-center gap-2"><Icon className="size-4" />{label}</CardDescription></CardHeader><CardContent className="text-3xl font-extrabold">—</CardContent></Card>)}
      </div>
      <Card><CardHeader className="border-b"><CardTitle>Campañas</CardTitle><CardDescription>Resultados medidos por ChatGPT Ads, con asignación a cliente y publicación separada.</CardDescription></CardHeader><CardContent className="py-10 text-center text-sm text-muted-foreground">Las campañas reales solo aparecen en la aplicación autenticada.</CardContent></Card>
      <Card><CardHeader><CardTitle>Vista para clientes</CardTitle><CardDescription>El cliente ve únicamente campañas vinculadas a su ficha y marcadas como visibles; la sección de su portal está apagada por defecto.</CardDescription></CardHeader></Card>
    </div>
  );
}
