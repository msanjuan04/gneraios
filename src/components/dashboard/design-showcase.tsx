import { ArrowRight, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { brand } from "@/brand";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBps, formatMoney } from "@/domain/money";

const SWATCHES = [
  { name: "Negro", value: brand.palette.black },
  { name: "Azul brillante", value: brand.palette.blueBright },
  { name: "Azul profundo", value: brand.palette.blueDeep },
  { name: "Azul eléctrico", value: brand.palette.blue },
  { name: "Violeta", value: brand.palette.violet },
  { name: "Cobrada", value: brand.palette.green },
  { name: "Pendiente", value: brand.palette.amber },
  { name: "Vencida", value: brand.palette.red },
];

// Importes de ejemplo: el segundo es el caso "4.730,00 €" que Intl no agrupa por defecto.
const SAMPLE_ROWS = [
  { concept: "Mantenimiento web", type: "Mensual", base: 15_000, vat: 2100 },
  { concept: "Identidad de marca · fase 1", type: "One-off", base: 473_000, vat: 2100 },
  { concept: "Campaña Meta Ads", type: "Por uso", base: 37_500, vat: 2100 },
  { concept: "Hosting anual", type: "Anual", base: 24_000, vat: 2100 },
];

/** Tokens y componentes con la estética de gnerai.com (solo en la vista previa). */
export async function DesignShowcase() {
  const t = await getTranslations("preview");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader title={t("designTitle")} description={t("designSubtitle")} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SWATCHES.map((s) => (
          <div key={s.name} className="overflow-hidden rounded-2xl border">
            <div className="h-16" style={{ background: s.value }} />
            <div className="p-3">
              <p className="text-sm font-semibold">{s.name}</p>
              <p className="font-mono text-xs text-muted-foreground uppercase">{s.value}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tipografía · Manrope</CardTitle>
            <CardDescription>Titulares con el tracking negativo de la web; texto de trabajo compacto.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-5xl font-extrabold heading-tight">Diseñamos marcas.</p>
            <p className="text-2xl font-bold heading-tight text-muted-foreground">Creamos webs y software.</p>
            <p className="text-sm text-muted-foreground">
              Texto de interfaz a 14 px, etiquetas a 12 px y cifras tabulares en importes.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Controles</CardTitle>
            <CardDescription>Botones en píldora; el primario lleva el degradado de marca.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button>
                Hablar con nosotros
                <ArrowRight data-icon="inline-end" />
              </Button>
              <Button variant="secondary">
                <Plus data-icon="inline-start" />
                Nuevo cliente
              </Button>
              <Button variant="outline">Exportar</Button>
              <Button variant="ghost">Cancelar</Button>
              <Button variant="destructive">Anular</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>Principal</Badge>
              <Badge variant="secondary">1.2</Badge>
              <Badge variant="outline">Autónomo</Badge>
              <Badge className="bg-success/15 text-success">Cobrada</Badge>
              <Badge className="bg-warning/15 text-warning">Pendiente</Badge>
              <Badge className="bg-destructive/15 text-destructive">Vencida</Badge>
            </div>
            <Input placeholder="Buscar clientes, facturas…" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listados</CardTitle>
          <CardDescription>Densidad tipo Linear: filas compactas, importes alineados.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Base</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SAMPLE_ROWS.map((r) => {
                const vat = Math.round((r.base * r.vat) / 10_000);
                return (
                  <TableRow key={r.concept}>
                    <TableCell className="font-medium">{r.concept}</TableCell>
                    <TableCell className="text-muted-foreground">{r.type}</TableCell>
                    <TableCell className="text-right tabular">{formatMoney(r.base)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{formatBps(r.vat)}</TableCell>
                    <TableCell className="text-right font-semibold tabular">{formatMoney(r.base + vat)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
