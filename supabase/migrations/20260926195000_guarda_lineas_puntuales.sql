-- Una línea que pasa a ser puntual en un contrato que ya ha empezado a facturar sus hitos
-- dejaría ese importe sin repartir entre los hitos ya facturados. Antes solo se comprobaba al
-- crear la línea; ahora también al cambiar su tipo.
create or replace function private.contract_lines_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.tax_rates t where t.id = new.tax_rate_id and t.kind = 'vat') then
    raise exception 'El impuesto de una línea tiene que ser un tipo de IVA'
      using errcode = 'P0001', hint = 'vat_rate_required';
  end if;

  if new.billing_type = 'one_off'
     and (tg_op = 'INSERT' or old.billing_type <> 'one_off')
     and exists (
       select 1 from public.billable_items b
       join public.contract_milestones m on m.id = b.milestone_id
       where m.contract_id = new.contract_id
     ) then
    raise exception 'Este contrato ya ha empezado a facturar sus hitos: el trabajo nuevo va en otro contrato'
      using errcode = 'P0001', hint = 'milestones_started';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.contract_id <> old.contract_id then
    raise exception 'Una línea no cambia de contrato' using errcode = 'P0001', hint = 'line_contract_fixed';
  end if;

  if (new.billing_type, new.quantity, new.unit_price_cents, new.discount_bps, new.tax_rate_id,
      new.irpf_applies, new.starts_on, new.billing_day, new.prorate_first)
     is distinct from
     (old.billing_type, old.quantity, old.unit_price_cents, old.discount_bps, old.tax_rate_id,
      old.irpf_applies, old.starts_on, old.billing_day, old.prorate_first)
     and exists (
       select 1 from public.billable_items b
       join public.invoice_lines il on il.id = b.invoice_line_id
       join public.invoices i on i.id = il.invoice_id
       where b.contract_line_id = old.id and i.lifecycle <> 'draft'
     ) then
    raise exception 'La línea ya se ha facturado: para cambiar sus condiciones, crea una versión nueva desde una fecha'
      using errcode = 'P0001', hint = 'line_billed';
  end if;
  return new;
end;
$$;

-- Un borrador que viene de un contrato (o que rectifica otra factura) no cambia de emisor ni
-- de cliente: sus conceptos son de ese cliente y los factura ese emisor por fecha.
create function private.invoices_draft_parties_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.lifecycle = 'draft'
     and (new.issuer_id, new.client_id) is distinct from (old.issuer_id, old.client_id)
     and (old.kind = 'rectifying' or exists (
       select 1 from public.invoice_lines l where l.invoice_id = old.id and l.contract_line_id is not null
     )) then
    raise exception 'Este borrador viene de un contrato o rectifica otra factura: su emisor y su cliente no se cambian'
      using errcode = 'P0001', hint = 'draft_party_locked';
  end if;
  return new;
end;
$$;

create trigger invoices_draft_parties_guard before update of issuer_id, client_id on public.invoices
  for each row execute function private.invoices_draft_parties_guard();

-- Timeline 360: una factura se pinta en su fecha legal (issued_on), no en el momento técnico
-- en que se registró (importaciones y demo emiten con fechas pasadas).
create or replace view public.client_timeline with (security_invoker = true) as
select
  a.org_id,
  a.client_id,
  a.deal_id,
  a.id::text as event_id,
  a.kind::text as kind,
  a.title,
  a.body,
  a.occurred_at as at,
  a.member_id,
  null::jsonb as meta
from public.activities a
union all
select
  h.org_id,
  d.client_id,
  d.id,
  'stage-' || h.id::text,
  case when h.from_stage_id is null then 'deal_created' else 'stage_change' end,
  d.title,
  null,
  h.changed_at,
  m.id,
  jsonb_build_object('from', fs.name, 'to', ts.name, 'to_kind', ts.kind)
from public.deal_stage_history h
join public.deals d on d.id = h.deal_id
join public.pipeline_stages ts on ts.id = h.to_stage_id
left join public.pipeline_stages fs on fs.id = h.from_stage_id
left join public.members m on m.org_id = h.org_id and m.user_id = h.changed_by
union all
select
  ct.org_id,
  ct.client_id,
  ct.deal_id,
  'contract-' || ct.id::text,
  'contract_signed',
  ct.title,
  null,
  ct.signed_on::timestamptz,
  null::uuid,
  jsonb_build_object('contract_id', ct.id)
from public.contracts ct
where ct.signed_on is not null
union all
select
  i.org_id,
  i.client_id,
  null::uuid,
  'invoice-' || i.id::text,
  case when i.kind = 'rectifying' then 'invoice_rectifying' else 'invoice_issued' end,
  i.number,
  null,
  -- La fecha que manda es la legal (issued_on); la hora, la de emisión si fue ese mismo día.
  case when (i.issued_at at time zone 'Europe/Madrid')::date = i.issued_on then i.issued_at
       else (i.issued_on::timestamp + interval '12 hours') at time zone 'Europe/Madrid' end,
  m.id,
  jsonb_build_object('invoice_id', i.id, 'total_cents', i.total_cents)
from public.invoices i
left join public.members m on m.org_id = i.org_id and m.user_id = i.created_by
where i.lifecycle = 'issued'
union all
select
  p.org_id,
  i.client_id,
  null::uuid,
  'payment-' || p.id::text,
  'payment',
  i.number,
  null,
  p.paid_on::timestamptz,
  m.id,
  jsonb_build_object('invoice_id', i.id, 'amount_cents', p.amount_cents, 'method', p.method)
from public.payments p
join public.invoices i on i.id = p.invoice_id
left join public.members m on m.org_id = p.org_id and m.user_id = p.created_by;

revoke all on public.client_timeline from anon;
