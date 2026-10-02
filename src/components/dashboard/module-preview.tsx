import Link from "next/link";
import { ArrowRight, CalendarClock, Landmark, UsersRound, WalletCards } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Module = "clients" | "pipeline" | "quotes" | "projects" | "contracts" | "invoices" | "finance";

const definitions: Record<Module, { title: string; description: string; columns: string[]; empty: string }> = {
  clients: {
    title: "Clientes", description: "Cobrado, pendiente, total comprometido y próxima entrega desde cada expediente.",
    columns: ["Cliente", "Estado", "Cobrado", "Pendiente", "Total", "Próxima entrega"],
    empty: "Los clientes existentes aparecerán aquí al abrir tu organización.",
  },
  pipeline: {
    title: "Pipeline comercial", description: "Cada oportunidad conserva etapa, propuesta, próxima acción y expediente del cliente.",
    columns: ["Oportunidad", "Etapa", "Propuesta", "Valor potencial", "Próxima acción"],
    empty: "Las oportunidades reales se cargarán desde el CRM.",
  },
  quotes: {
    title: "Presupuestos y propuestas", description: "Control de borradores, envíos, aceptación y versiones exactas entregadas.",
    columns: ["Presupuesto", "Cliente", "Estado", "Importe", "Envío", "Versión"],
    empty: "Los presupuestos reales se cargarán desde tu organización.",
  },
  projects: {
    title: "Proyectos y entregas", description: "Trabajo por cliente, entregables formales, vencimientos y archivos compartidos.",
    columns: ["Proyecto", "Cliente", "Estado", "Próxima entrega", "Responsable"],
    empty: "Los proyectos y entregables reales se cargarán desde tu organización.",
  },
  contracts: {
    title: "Contratos", description: "Acuerdos aceptados, hitos de pago, emisor y documentos vinculados al cliente.",
    columns: ["Contrato", "Cliente", "Emisor", "Estado", "Inicio", "Próximo hito"],
    empty: "Los contratos reales se cargarán desde tu organización.",
  },
  invoices: {
    title: "Facturas y cobros", description: "Facturación emitida, pagos parciales y saldo abierto por documento.",
    columns: ["Factura", "Cliente", "Emisor", "Total", "Cobrado", "Pendiente"],
    empty: "Las facturas reales se cargarán desde tu organización.",
  },
  finance: {
    title: "Finanzas y asesoría", description: "Caja, gastos, banco, emisores y paquete verificable para asesoría.",
    columns: ["Movimiento", "Emisor", "Cuenta", "Fecha", "Importe", "Conciliación"],
    empty: "Los movimientos reales se cargarán desde las cuentas de cada emisor.",
  },
};

export function ModulePreview({ module }: { module: Module }) {
  const section = definitions[module];
  const isFinance = module === "finance";
  return <div className="mx-auto max-w-[88rem] space-y-5 pb-8">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-4xl font-extrabold heading-tight md:text-5xl">{section.title}</h2><p className="mt-2 text-muted-foreground">{section.description}</p></div>
      <Link href={module === "clients" ? "/preview/leads" : "/preview"} className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold hover:bg-muted">{module === "clients" ? "Ver leads" : "Ir a Inicio"}<ArrowRight aria-hidden className="size-4" /></Link>
    </header>
    {isFinance ? <div className="grid gap-3 sm:grid-cols-3">
      <Summary icon={<WalletCards aria-hidden className="size-4" />} title="Caja registrada" note="Por cuenta y emisor" />
      <Summary icon={<CalendarClock aria-hidden className="size-4" />} title="Pendiente de cobro" note="Facturas abiertas" />
      <Summary icon={<Landmark aria-hidden className="size-4" />} title="Banco por conciliar" note="Movimientos sin asignar" />
    </div> : module === "clients" ? <div className="grid gap-3 sm:grid-cols-3">
      <Summary icon={<UsersRound aria-hidden className="size-4" />} title="Clientes activos" note="Solo registros existentes" />
      <Summary icon={<WalletCards aria-hidden className="size-4" />} title="Cobrado" note="Facturas y cobros registrados" />
      <Summary icon={<CalendarClock aria-hidden className="size-4" />} title="Próximas entregas" note="Fechas comprometidas" />
    </div> : null}
    <Card className="overflow-hidden">
      <CardHeader className="border-b"><CardTitle>{section.title}</CardTitle><CardDescription>Vista de estructura. Los datos, importes y estados proceden de la organización real.</CardDescription></CardHeader>
      <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b bg-muted/25 text-xs text-muted-foreground"><tr>{section.columns.map((column) => <th key={column} className="px-4 py-3 font-semibold">{column}</th>)}</tr></thead><tbody><tr><td colSpan={section.columns.length} className="px-5 py-12 text-center text-sm text-muted-foreground">{section.empty}</td></tr></tbody></table></div>
    </Card>
    {module === "finance" && <Card><CardHeader><CardTitle>Entrega a asesoría</CardTitle><CardDescription>Exportación por emisor y periodo con facturas, gastos, cobros, movimientos bancarios, justificantes disponibles y manifiesto de faltantes y totales. La validación fiscal corresponde a la asesoría.</CardDescription></CardHeader></Card>}
    {module === "projects" && <Card><CardHeader><CardTitle>Entregables al cliente</CardTitle><CardDescription>Fecha, estado, responsable y archivo o enlace de la versión enviada. Las tareas internas permanecen separadas.</CardDescription></CardHeader></Card>}
    {module === "quotes" && <Card><CardHeader><CardTitle>Historial de propuestas</CardTitle><CardDescription>Cada envío por email o marcado manualmente guarda la copia exacta del PDF y sus datos.</CardDescription></CardHeader></Card>}
  </div>;
}

function Summary({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return <Card><CardHeader className="pb-1"><CardDescription className="flex items-center gap-2 font-semibold">{icon}{title}</CardDescription></CardHeader><CardContent><p className="text-3xl font-bold tabular-nums">—</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></CardContent></Card>;
}
