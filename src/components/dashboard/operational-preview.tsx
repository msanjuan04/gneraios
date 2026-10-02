import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, FileText, MessageSquareText, WalletCards } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Vista sin base de datos: enseña estructura y estados vacíos; nunca inventa clientes ni cifras. */
export function OperationalPreview() {
  return (
    <div className="mx-auto max-w-[88rem] space-y-6 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-4xl font-extrabold heading-tight md:text-5xl">Inicio</h2><p className="mt-2 text-muted-foreground">Trabajo prioritario, clientes y próximos cobros.</p></div>
        <Link href="/preview/projects" className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold hover:bg-muted">Abrir proyectos <ArrowRight aria-hidden className="size-4" /></Link>
      </header>

      <section aria-label="Resumen de caja y urgencias" className="grid gap-3 sm:grid-cols-3">
        <Metric icon={<WalletCards aria-hidden className="size-4" />} title="Entrado este mes" value="—" caption="Cobros confirmados del emisor activo." />
        <Metric icon={<CalendarClock aria-hidden className="size-4" />} title="Queda por entrar este mes" value="—" caption="Saldo de facturas abiertas con vencimiento este mes." />
        <Metric icon={<CircleAlert aria-hidden className="size-4" />} title="Urgente hoy" value="—" caption="Entregas vencidas y próximas acciones prioritarias." />
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-start justify-between border-b">
          <div><CardTitle>Entregas y proyectos próximos</CardTitle><CardDescription>Atrasado primero, después entregas de esta semana y siguientes.</CardDescription></div>
          <Link href="/preview/projects" className="hidden text-sm font-semibold text-primary hover:underline sm:inline-flex">Ver todos <ArrowRight className="ml-1 size-4" /></Link>
        </CardHeader>
        <CardContent className="flex min-h-28 items-center justify-center py-8 text-center text-sm text-muted-foreground">Las entregas aparecerán aquí al conectar la organización.</CardContent>
        <div className="border-t bg-muted/20 px-5 py-3 text-xs text-muted-foreground"><CheckCircle2 className="mr-1 inline size-3.5" />Últimos siete días · solo elementos registrados como entregados.</div>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="border-b"><CardTitle>Leads y seguimientos</CardTitle><CardDescription>Mensaje recibido, propuesta enviada, respuestas y próximo paso en un mismo expediente.</CardDescription></CardHeader>
          <CardContent className="space-y-4 py-5">
            <p className="text-sm text-muted-foreground">Empresas que has mencionado para enseñar el CRM. Estado, mensajes, presupuesto e importes salen de registros existentes; esta preview no los inventa.</p>
            <div className="flex flex-wrap gap-2">{["Little", "Metrickal", "BAKoffice"].map((name) => <Link key={name} href="/preview/leads" className="rounded-full border bg-muted/30 px-3 py-1.5 text-sm font-medium hover:bg-muted">{name}</Link>)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b"><CardTitle>Entregado recientemente</CardTitle><CardDescription>Documentos compartidos, con enlace a la versión enviada.</CardDescription></CardHeader>
          <CardContent className="flex min-h-32 items-center justify-center py-8 text-center text-sm text-muted-foreground"><FileText aria-hidden className="mr-2 size-4" />No hay datos demo. El historial real se carga desde proyectos.</CardContent>
        </Card>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4">
        <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><MessageSquareText aria-hidden className="size-4" /></span><div><p className="text-sm font-semibold">Previsión comercial</p><p className="text-xs text-muted-foreground">Oportunidades ponderadas por probabilidad; ingresos puntuales y MRR separados.</p></div></div>
        <Link href="/preview/pipeline" className="rounded-full border px-3 py-2 text-sm font-semibold hover:bg-muted">Abrir CRM <ArrowRight className="ml-1 inline size-4" /></Link>
      </section>
    </div>
  );
}

export function LeadsPreview() {
  const names = ["Little", "Metrickal", "BAKoffice"];
  return (
    <div className="mx-auto max-w-[88rem] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-4xl font-extrabold heading-tight">Leads y oportunidades</h2><p className="mt-2 text-muted-foreground">Expediente comercial, propuesta enviada, respuestas y siguiente acción.</p></div><Link href="/preview/pipeline" className="rounded-full border px-4 py-2 text-sm font-semibold hover:bg-muted">Abrir pipeline <ArrowRight className="ml-1 inline size-4" /></Link></header>
      <div className="grid gap-3 sm:grid-cols-3"><Metric icon={<MessageSquareText className="size-4" />} title="Oportunidades abiertas" value="—" caption="Se calcula desde deals existentes." /><Metric icon={<FileText className="size-4" />} title="Presupuestos enviados" value="—" caption="Estado enlazado al presupuesto real." /><Metric icon={<CircleAlert className="size-4" />} title="Seguimientos pendientes" value="—" caption="Próxima acción y vencimiento del lead." /></div>
      <Card className="overflow-hidden"><CardHeader className="border-b"><CardTitle>CRM · Leads</CardTitle><CardDescription>Estos nombres vienen de lo que has mencionado. La preview no inventa estado, propuesta, importe ni actividad.</CardDescription></CardHeader><ul className="divide-y sm:hidden">{names.map((name) => <li key={name} className="px-5 py-4"><p className="font-semibold">{name}</p><p className="mt-1 text-xs text-muted-foreground">Etapa, presupuesto y próxima acción se cargan desde la organización.</p></li>)}</ul><div className="hidden overflow-x-auto sm:block"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-5 py-3">Empresa</th><th className="px-5 py-3">Etapa</th><th className="px-5 py-3">Presupuesto</th><th className="px-5 py-3">Próxima acción</th><th className="px-5 py-3 text-right">Expediente</th></tr></thead><tbody className="divide-y">{names.map((name) => <tr key={name}><td className="px-5 py-4 font-semibold">{name}</td><td className="px-5 py-4 text-muted-foreground">—</td><td className="px-5 py-4 text-muted-foreground">—</td><td className="px-5 py-4 text-muted-foreground">—</td><td className="px-5 py-4 text-right"><span className="text-xs text-muted-foreground">Se carga desde la organización</span></td></tr>)}</tbody></table></div></Card>
      <Card><CardHeader><CardTitle>Expediente comercial</CardTitle><CardDescription>La ficha real enlaza actividad CRM, oportunidades, presupuestos, contratos y proyectos. Permite registrar mensajes por canal y conserva la versión exacta de las propuestas enviadas por email o marcadas como enviadas manualmente. La sincronización automática de respuestas y sus adjuntos sigue pendiente.</CardDescription></CardHeader></Card>
    </div>
  );
}

function Metric({ icon, title, value, caption }: { icon: React.ReactNode; title: string; value: string; caption: string }) {
  return <Card><CardHeader className="pb-1"><CardDescription className="flex items-center gap-2 font-semibold">{icon}{title}</CardDescription></CardHeader><CardContent><p className="text-3xl font-bold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{caption}</p></CardContent></Card>;
}
