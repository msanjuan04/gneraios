-- Registro interno y auditable de movimientos económicos con socios, separado de gastos y equity.
create type public.partner_movement_kind as enum (
  'capital_contribution', 'shareholder_funds_contribution', 'partner_loan', 'loan_repayment', 'expense_reimbursement', 'dividend'
);
create type public.partner_movement_status as enum ('proposed', 'approved', 'paid', 'void');

create table public.partner_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  member_id uuid not null,
  kind public.partner_movement_kind not null,
  status public.partner_movement_status not null default 'proposed',
  amount_cents bigint not null check (amount_cents > 0),
  effective_on date not null,
  reference text check (reference is null or char_length(reference) <= 200),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, member_id) references public.members (org_id, id)
);
create index partner_movements_org_date_idx on public.partner_movements (org_id, effective_on desc, member_id);
alter table public.partner_movements enable row level security;
-- Capital, préstamos y dividendos son información societaria: los leen los socios (partner u
-- owner), nunca un viewer (gestoría, colaborador externo).
create policy partner_movements_select on public.partner_movements for select to authenticated
  using (private.has_role(org_id, 'partner'));
create policy partner_movements_insert on public.partner_movements for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy partner_movements_update on public.partner_movements for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));
create policy partner_movements_delete on public.partner_movements for delete to authenticated
  using (private.has_role(org_id, 'owner') and status in ('proposed', 'void'));

create function private.partner_movements_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status <> 'proposed' then
    raise exception 'Un movimiento empieza como propuesta' using errcode = 'P0001', hint = 'partner_movement_transition';
  end if;
  if tg_op = 'UPDATE' then
    if (new.id, new.org_id, new.created_at, new.created_by)
       is distinct from (old.id, old.org_id, old.created_at, old.created_by) then
      raise exception 'La identidad y autoría del movimiento no se modifican' using errcode = 'P0001', hint = 'partner_movement_identity_immutable';
    end if;
    if old.status in ('paid', 'void') then
      raise exception 'Un movimiento pagado o anulado no se reescribe' using errcode = 'P0001', hint = 'partner_movement_immutable';
    end if;
    if old.status = 'approved' and new.status not in ('approved', 'paid', 'void') then
      raise exception 'Un movimiento aprobado solo se puede pagar o anular' using errcode = 'P0001', hint = 'partner_movement_transition';
    end if;
    if old.status = 'proposed' and new.status not in ('proposed', 'approved', 'void') then
      raise exception 'Una propuesta debe aprobarse antes de marcarse pagada' using errcode = 'P0001', hint = 'partner_movement_transition';
    end if;
    if (new.org_id, new.member_id, new.kind, new.amount_cents, new.effective_on, new.reference, new.notes)
       is distinct from (old.org_id, old.member_id, old.kind, old.amount_cents, old.effective_on, old.reference, old.notes)
       and old.status <> 'proposed' then
      raise exception 'Un movimiento aprobado conserva sus datos; anúlalo y registra otro' using errcode = 'P0001', hint = 'partner_movement_immutable';
    end if;
  end if;
  return new;
end;
$$;
create trigger partner_movements_guard before insert or update on public.partner_movements
  for each row execute function private.partner_movements_guard();
create trigger partner_movements_updated_at before update on public.partner_movements
  for each row execute function private.set_updated_at();
create trigger partner_movements_audit after insert or update or delete on public.partner_movements
  for each row execute function private.audit_row();

comment on table public.partner_movements is 'Control interno; no constituye asiento contable ni determina tratamiento fiscal. Confirmar con asesoría.';
