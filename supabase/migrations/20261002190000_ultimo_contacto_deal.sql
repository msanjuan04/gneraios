-- Seguimiento comercial: el tablero sabe cuándo fue el último contacto real de cada deal y de quién
-- es el turno. Se deriva de las actividades (no se guarda): el último correo, llamada o reunión del
-- deal (o del cliente, si la actividad no se colgó de ningún deal). Si fue un correo, su sentido dice
-- quién tiene la pelota: `outgoing` = esperamos respuesta, `incoming` = nos toca contestar.
-- Dos columnas nuevas al final: no rompe a nadie.

create or replace view public.deals_board with (security_invoker = true) as
select
  d.id,
  d.org_id,
  d.client_id,
  c.display_name as client_name,
  d.title,
  d.stage_id,
  s.kind as stage_kind,
  s.position as stage_position,
  d.est_one_off_cents,
  d.est_mrr_cents,
  coalesce(d.probability_bps, s.default_probability_bps) as probability_bps,
  d.source_id,
  d.brought_by_member_id,
  d.owner_member_id,
  m.initials as owner_initials,
  d.next_action,
  d.next_action_on,
  d.loss_reason_id,
  d.loss_note,
  d.created_at,
  entered.changed_at as stage_entered_at,
  case when s.kind in ('won', 'lost') then entered.changed_at end as closed_at,
  d.probability_bps as probability_override_bps,
  last_contact.occurred_at as last_contact_at,
  last_contact.direction as last_contact_direction
from public.deals d
join public.pipeline_stages s on s.id = d.stage_id
join public.clients c on c.id = d.client_id
left join public.members m on m.id = d.owner_member_id
left join lateral (
  select h.changed_at
  from public.deal_stage_history h
  where h.deal_id = d.id and h.to_stage_id = d.stage_id
  order by h.changed_at desc
  limit 1
) entered on true
left join lateral (
  select a.occurred_at, a.direction
  from public.activities a
  where a.client_id = d.client_id
    and (a.deal_id = d.id or a.deal_id is null)
    and a.kind in ('email', 'call', 'meeting')
    and a.occurred_at <= now()
  order by a.occurred_at desc
  limit 1
) last_contact on true
where d.archived_at is null;

revoke all on public.deals_board from anon;
