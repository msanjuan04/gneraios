-- GNERAI OS · Informe mensual del cliente
-- El informe no se guarda: se monta al momento con los datos del mes (src/domain/reports) para
-- verlo, descargarlo o adjuntarlo, y el PDF del email se genera al enviarlo (src/server/email/send.ts),
-- igual que el de una factura se lee de Storage al enviarla. Lo único que hay que recordar es el
-- email: de qué cliente es (outbound_emails.client_id, que ya existe), de qué mes y si lleva las
-- horas dedicadas. Un socio lo revisa y lo envía desde Facturas → Por enviar.

-- Plantilla nueva. No se usa como valor del enum en esta migración (Postgres no deja usarlo en la
-- misma transacción que lo añade): la comprobación de abajo compara su texto.
alter type public.email_template add value if not exists 'client_report';

alter table public.outbound_emails
  -- Mes del informe: su primer día, como metrics_snapshots.month.
  add column report_month date check (report_month is null or extract(day from report_month) = 1),
  -- Si el PDF lleva las horas dedicadas del mes (lo decide el socio al prepararlo; por defecto no).
  add column report_hours boolean not null default false,
  -- Un informe es siempre de un cliente y de un mes, y no va con factura ni presupuesto.
  add constraint outbound_emails_report_check check (
    (report_month is not null) = (template::text = 'client_report')
    and (report_month is null or (client_id is not null and invoice_id is null and quote_id is null))
    and (report_month is not null or not report_hours)
  );

-- Uno por revisar por cliente y mes: «Preparar email» dos veces devuelve el mismo. Enviado o
-- descartado, se puede preparar otro (una corrección, un reenvío).
create unique index outbound_emails_report_pending_idx on public.outbound_emails (org_id, client_id, report_month)
  where report_month is not null and status = 'pending_approval';
