-- GNERAI OS · Repercutir gastos a los clientes
-- Completa 20260927100000_gastos_clientes.sql: un gasto de un cliente con «Repercutir» se le
-- factura con una línea en un borrador suyo. Aquí van tres cosas que esa migración no tenía:
--
-- 1. expenses_overview enseña a quién sirve cada gasto y en qué punto está su repercusión
--    (estado derivado, nunca guardado: por repercutir, en un borrador o ya facturado).
-- 2. rebill_expenses: guarda el borrador con save_invoice_draft (las líneas llegan calculadas de
--    TS, src/domain/finance/rebill.ts) y enlaza cada gasto con su línea en la MISMA transacción.
--    Es idempotente: si algún gasto ya no está pendiente (otro socio se ha adelantado o se ha
--    pulsado dos veces), no se guarda nada (hint rebill_taken).
-- 3. Un gasto repercutido no cambia de cliente ni de condiciones, no se borra y no se desengancha
--    a mano mientras su línea exista: se quita la línea del borrador (o se borra el borrador) y
--    la clave ajena lo deja otra vez pendiente.

-- ---------------------------------------------------------------------------
-- 1. Estado derivado de la repercusión y columnas nuevas de expenses_overview
-- ---------------------------------------------------------------------------
create type public.expense_rebill_state as enum (
  'pending',  -- por repercutir: sin línea de factura
  'drafted',  -- en un borrador del cliente
  'invoiced'  -- en una factura emitida (o emitiéndose)
);

-- Mismas columnas que antes (en el mismo orden) y, al final, las de a quién sirve el gasto.
create or replace view public.expenses_overview with (security_invoker = true) as
select
  e.id,
  e.org_id,
  e.issuer_id,
  coalesce(iss.trade_name, iss.legal_name) as issuer_name,
  e.vendor_id,
  v.name as vendor_name,
  e.category_id,
  c.name as category_name,
  c.expense_group,
  c.is_fixed,
  e.description,
  e.vendor_invoice_number,
  e.issued_on,
  e.due_on,
  coalesce(e.due_on, e.issued_on) as payable_on,
  date_trunc('month', e.issued_on::timestamp)::date as month,
  date_trunc('quarter', e.issued_on::timestamp)::date as quarter,
  e.base_cents,
  e.vat_bps,
  e.vat_cents,
  e.vat_deductible,
  (case when e.vat_deductible then e.vat_cents else 0 end)::bigint as deductible_vat_cents,
  (e.base_cents + case when e.vat_deductible then 0 else e.vat_cents end)::bigint as cost_cents,
  e.irpf_bps,
  e.irpf_cents,
  e.total_cents,
  e.paid_on,
  e.payment_method,
  e.member_id,
  m.full_name as member_name,
  m.initials as member_initials,
  e.subscription_id,
  e.period_start,
  e.attachment_path,
  e.source,
  e.external_id,
  e.notes,
  e.created_at,
  e.updated_at,
  case
    when e.paid_on is not null then 'paid'
    when coalesce(e.due_on, e.issued_on) < (now() at time zone o.timezone)::date then 'overdue'
    else 'pending'
  end::public.expense_status as status,
  e.allocation,
  e.client_id,
  cl.display_name as client_name,
  e.rebill,
  e.rebill_markup_bps,
  e.rebill_invoice_line_id,
  il.invoice_id as rebill_invoice_id,
  inv.number as rebill_invoice_number,
  case
    when not e.rebill then null
    when e.rebill_invoice_line_id is null then 'pending'
    when inv.lifecycle = 'draft' then 'drafted'
    else 'invoiced'
  end::public.expense_rebill_state as rebill_state
from public.expenses e
join public.orgs o on o.id = e.org_id
join public.issuers iss on iss.id = e.issuer_id
join public.expense_categories c on c.id = e.category_id
left join public.vendors v on v.id = e.vendor_id
left join public.members m on m.id = e.member_id
left join public.clients cl on cl.id = e.client_id
left join public.invoice_lines il on il.id = e.rebill_invoice_line_id
left join public.invoices inv on inv.id = il.invoice_id;

revoke all on public.expenses_overview from anon;

-- ---------------------------------------------------------------------------
-- 2. Repercutir: borrador + enlace de cada gasto con su línea, en una transacción
-- ---------------------------------------------------------------------------
-- Contrato del JSON (p):
--   draft: el mismo JSON que save_invoice_draft (un borrador nuevo del cliente, con su cabecera,
--          o uno suyo abierto con invoice_id, expected_updated_at y TODAS sus líneas),
--   links: [{ expense_id, line_id }]: cada gasto con la línea nueva del borrador que lo factura.
-- security invoker: la RLS de quien repercute (socio) manda en los gastos; el borrador lo
-- escribe save_invoice_draft, que comprueba sus propios permisos.
create function public.rebill_expenses(p jsonb) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft jsonb := coalesce(p -> 'draft', '{}'::jsonb);
  v_links jsonb := coalesce(p -> 'links', '[]'::jsonb);
  v_expected integer;
  v_found integer;
  v_org uuid;
  v_client uuid;
  v_invoice uuid;
begin
  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) = 0 then
    raise exception 'No hay gastos que repercutir' using errcode = 'P0001', hint = 'rebill_empty';
  end if;
  v_expected := jsonb_array_length(v_links);
  if (select count(distinct x ->> 'expense_id') from jsonb_array_elements(v_links) x where nullif(x ->> 'expense_id', '') is not null) <> v_expected
     or (select count(distinct x ->> 'line_id') from jsonb_array_elements(v_links) x where nullif(x ->> 'line_id', '') is not null) <> v_expected then
    raise exception 'Cada gasto va con una línea distinta' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_links) x
    where not exists (
      select 1 from jsonb_array_elements(coalesce(v_draft -> 'lines', '[]'::jsonb)) l where l ->> 'id' = x ->> 'line_id'
    )
  ) then
    raise exception 'La línea de cada gasto tiene que ir en el borrador' using errcode = '22023';
  end if;

  -- El cliente: el del borrador al que se añade o el de la cabecera del borrador nuevo.
  if nullif(v_draft ->> 'invoice_id', '') is not null then
    select i.org_id, i.client_id into v_org, v_client from public.invoices i where i.id = (v_draft ->> 'invoice_id')::uuid;
  else
    select c.org_id, c.id into v_org, v_client from public.clients c where c.id = nullif(v_draft #>> '{header,client_id}', '')::uuid;
  end if;
  if v_org is null or not private.has_role(v_org, 'partner') then
    raise exception 'Sin permiso para facturar en esta organización' using errcode = '42501';
  end if;

  -- Bloquea los gastos y comprueba que siguen pendientes y son de este cliente. Si otra
  -- repercusión los tenía, espera a que termine y ya no los cuenta como pendientes.
  select count(*) into v_found
  from (
    select e.id
    from public.expenses e
    where e.id in (select (x ->> 'expense_id')::uuid from jsonb_array_elements(v_links) x)
      and e.org_id = v_org
      and e.client_id = v_client
      and e.allocation = 'client'
      and e.rebill
      and e.rebill_invoice_line_id is null
    for update of e
  ) pending;
  if v_found <> v_expected then
    raise exception 'Algún gasto ya se ha repercutido o ya no es de este cliente' using errcode = 'P0001', hint = 'rebill_taken';
  end if;

  v_invoice := public.save_invoice_draft(v_draft);

  if not exists (
    select 1 from public.invoices i
    where i.id = v_invoice and i.client_id = v_client and i.kind = 'ordinary' and i.lifecycle = 'draft'
  ) then
    raise exception 'Solo se repercute en un borrador ordinario del mismo cliente' using errcode = 'P0001', hint = 'rebill_draft_invalid';
  end if;

  update public.expenses e
     set rebill_invoice_line_id = (x ->> 'line_id')::uuid
    from jsonb_array_elements(v_links) x
   where e.id = (x ->> 'expense_id')::uuid;

  return v_invoice;
end;
$$;

revoke all on function public.rebill_expenses(jsonb) from public, anon;
grant execute on function public.rebill_expenses(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Un gasto repercutido queda como se facturó
-- ---------------------------------------------------------------------------
create function private.expenses_rebill_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.rebill_invoice_line_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Este gasto ya está en una factura del cliente: quita antes su línea de la factura'
      using errcode = 'P0001', hint = 'expense_rebilled';
  end if;
  -- El enlace solo lo quita la clave ajena, al borrar la línea (o su borrador).
  if new.rebill_invoice_line_id is distinct from old.rebill_invoice_line_id
     and exists (select 1 from public.invoice_lines l where l.id = old.rebill_invoice_line_id) then
    raise exception 'Este gasto ya está en una factura del cliente: quita antes su línea de la factura'
      using errcode = 'P0001', hint = 'expense_rebilled';
  end if;
  if new.rebill_invoice_line_id is not distinct from old.rebill_invoice_line_id
     and (new.allocation, new.client_id, new.rebill, new.rebill_markup_bps)
         is distinct from (old.allocation, old.client_id, old.rebill, old.rebill_markup_bps) then
    raise exception 'Este gasto ya está en una factura del cliente: quita antes su línea de la factura'
      using errcode = 'P0001', hint = 'expense_rebilled';
  end if;
  return new;
end;
$$;

create trigger expenses_rebill_guard before update or delete on public.expenses
  for each row execute function private.expenses_rebill_guard();
