-- GNERAI OS · Cobros · Adeudos directos SEPA (esquema básico, CORE)
-- Mandatos de los clientes, datos de acreedor de cada emisor y remesas pain.008.001.02 con sus
-- recibos: se preparan, se genera el fichero para el banco, se marcan enviadas y, cuando el banco
-- abona, se cobran de una vez; los recibos devueltos dejan la factura pendiente con su motivo.
-- Ver ARCHITECTURE.md §6.3 (payments es la única fuente de «cobrada»; admite parciales y
-- devoluciones) y §6.4 (lo derivado no se guarda).
--
-- Reparto de responsabilidades:
-- - El fichero (XML, juego de caracteres SEPA, importes con dos decimales) y la validación de
--   IBAN, BIC, ICS y referencias los hace TS, una sola implementación (src/domain/collections).
-- - Aquí viven los invariantes y lo que tiene que ser atómico: una factura en una sola remesa
--   abierta, un mandato activo por cliente y acreedor, la referencia única por acreedor, lo que se
--   congela al generar (importe = pendiente de la factura, secuencia = la derivada, mandato
--   vigente, ICS confirmado) y que cobrar una remesa cree sus cobros una sola vez.
-- - Se derivan y no se guardan: la secuencia de un mandato (FRST hasta que un adeudo suyo va en
--   una remesa generada y no se devuelve; RCUR después), lo que cobraría un recibo en borrador
--   (el pendiente de su factura) y los totales de una remesa. Lo que se guarda de un recibo al
--   generar es lo que dice el fichero enviado al banco, como el snapshot de una factura emitida.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.sepa_sequence_type as enum ('FRST', 'RCUR');
create type public.sepa_remittance_status as enum ('draft', 'generated', 'sent', 'settled');
-- Estado derivado de un recibo (nunca se guarda): sale de sepa_remittance_items_overview.
create type public.sepa_item_state as enum ('pending', 'collected', 'returned');

-- ---------------------------------------------------------------------------
-- Datos de acreedor de cada emisor
-- ---------------------------------------------------------------------------
create table public.sepa_creditors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  issuer_id uuid not null,
  -- Identificador de acreedor (ICS). Vacío: la app propone el que sale del NIF del emisor, pero
  -- no se genera ningún fichero hasta que el owner lo guarda y confirma que es el de su banco.
  creditor_identifier text check (
    creditor_identifier is null or creditor_identifier ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$'
  ),
  creditor_identifier_confirmed_at timestamptz,
  creditor_identifier_confirmed_by uuid references auth.users (id) on delete set null,
  -- Vacíos: la razón social y el IBAN del emisor.
  name text check (name is null or char_length(btrim(name)) between 1 and 70),
  iban text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bic text check (bic is null or bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (issuer_id),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  check (creditor_identifier_confirmed_at is null or creditor_identifier is not null)
);
-- Dos emisores no comparten identificador de acreedor.
create unique index sepa_creditors_identifier_idx
  on public.sepa_creditors (org_id, creditor_identifier) where creditor_identifier is not null;

-- Normaliza y firma la confirmación: un ICS que cambia deja de estar confirmado salvo que se
-- confirme en el mismo cambio.
create function private.sepa_creditors_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.creditor_identifier := nullif(upper(regexp_replace(coalesce(new.creditor_identifier, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.iban := nullif(upper(regexp_replace(coalesce(new.iban, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.bic := nullif(upper(regexp_replace(coalesce(new.bic, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.name := nullif(btrim(coalesce(new.name, '')), '');
  if tg_op = 'UPDATE'
     and new.creditor_identifier is distinct from old.creditor_identifier
     and new.creditor_identifier_confirmed_at is not distinct from old.creditor_identifier_confirmed_at then
    new.creditor_identifier_confirmed_at := null;
  end if;
  if new.creditor_identifier_confirmed_at is null then
    new.creditor_identifier_confirmed_by := null;
  elsif tg_op = 'INSERT' or new.creditor_identifier_confirmed_at is distinct from old.creditor_identifier_confirmed_at then
    new.creditor_identifier_confirmed_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger sepa_creditors_normalize
  before insert or update on public.sepa_creditors
  for each row execute function private.sepa_creditors_normalize();

-- ---------------------------------------------------------------------------
-- Mandatos de los clientes
-- ---------------------------------------------------------------------------
create table public.client_mandates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  client_id uuid not null,
  -- Acreedor: el emisor que cobra. Un mandato autoriza a un acreedor concreto.
  issuer_id uuid not null,
  -- Única por acreedor para siempre (también la de un mandato revocado). Identificador SEPA:
  -- sin espacios, sin "/" en los extremos ni "//".
  reference text not null check (
    reference ~ '^[A-Za-z0-9/?:().,''+-]{1,35}$' and reference !~ '^/' and reference !~ '/$' and position('//' in reference) = 0
  ),
  -- Titular de la cuenta, tal y como irá en el fichero.
  debtor_name text not null check (char_length(btrim(debtor_name)) between 1 and 70),
  iban text not null check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bic text check (bic is null or bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  signed_on date not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 500),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, client_id) references public.clients (org_id, id),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  check (revoke_reason is null or revoked_at is not null)
);
create unique index client_mandates_reference_idx on public.client_mandates (issuer_id, upper(reference));
-- Un solo mandato activo por cliente y acreedor: el que se usa al generar.
create unique index client_mandates_active_idx on public.client_mandates (client_id, issuer_id) where revoked_at is null;
create index client_mandates_client_idx on public.client_mandates (client_id);

create function private.client_mandates_normalize() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.reference := btrim(new.reference);
  new.debtor_name := btrim(new.debtor_name);
  new.iban := upper(regexp_replace(new.iban, '[^A-Za-z0-9]', '', 'g'));
  new.bic := nullif(upper(regexp_replace(coalesce(new.bic, ''), '[^A-Za-z0-9]', '', 'g')), '');
  new.revoke_reason := nullif(btrim(coalesce(new.revoke_reason, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  return new;
end;
$$;

create trigger client_mandates_normalize
  before insert or update on public.client_mandates
  for each row execute function private.client_mandates_normalize();

-- ---------------------------------------------------------------------------
-- Remesas y sus recibos
-- ---------------------------------------------------------------------------
create table public.sepa_remittances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  issuer_id uuid not null,
  -- Fecha de cobro pedida al banco (ReqdColltnDt).
  collection_on date not null,
  status public.sepa_remittance_status not null default 'draft',
  notes text check (notes is null or char_length(notes) <= 1000),
  -- Lo que se congela al generar el fichero.
  message_id text check (message_id is null or message_id ~ '^[A-Za-z0-9?:().,''+-]{1,30}$'),
  creditor_snapshot jsonb,
  -- Copia exacta del fichero en el bucket privado `remittances`: <org>/<remesa>/<MsgId>.xml.
  file_path text,
  generated_at timestamptz,
  sent_at timestamptz,
  -- Día en que el banco abonó la remesa: la fecha de los cobros.
  settled_on date,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, issuer_id) references public.issuers (org_id, id),
  check ((status = 'draft') = (message_id is null)),
  check ((status = 'draft') = (creditor_snapshot is null)),
  check ((status = 'draft') = (file_path is null)),
  check ((status = 'draft') = (generated_at is null)),
  check ((status in ('sent', 'settled')) = (sent_at is not null)),
  check ((status = 'settled') = (settled_on is not null)),
  check ((status = 'settled') = (settled_at is not null))
);
create unique index sepa_remittances_message_id_idx on public.sepa_remittances (org_id, message_id) where message_id is not null;
create index sepa_remittances_org_idx on public.sepa_remittances (org_id, collection_on desc);

create table public.sepa_remittance_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  remittance_id uuid not null,
  invoice_id uuid not null,
  -- Congelado al generar el fichero (vacío en borrador): el mandato, el importe (el pendiente de
  -- la factura en ese momento), la secuencia y la referencia del adeudo.
  mandate_id uuid,
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  sequence_type public.sepa_sequence_type,
  end_to_end_id text check (end_to_end_id is null or end_to_end_id ~ '^[A-Za-z0-9/?:().,''+-]{1,35}$'),
  -- Devolución (un rechazo antes del abono o una devolución después): la factura vuelve a
  -- quedar pendiente. El código es el motivo SEPA que da el banco (AM04, MD06…).
  returned_on date,
  return_code text check (return_code is null or return_code ~ '^[A-Z0-9]{4}$'),
  return_reason text check (return_reason is null or char_length(return_reason) <= 500),
  -- El cobro que creó la remesa al cobrarse y, si después se devolvió, su contrapartida negativa.
  payment_id uuid,
  reversal_payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (remittance_id, invoice_id),
  unique (payment_id),
  unique (reversal_payment_id),
  foreign key (org_id, remittance_id) references public.sepa_remittances (org_id, id) on delete cascade,
  foreign key (org_id, invoice_id) references public.invoices (org_id, id),
  foreign key (org_id, mandate_id) references public.client_mandates (org_id, id),
  -- Un cobro de una remesa se deshace con una devolución, no borrándolo.
  foreign key (org_id, payment_id) references public.payments (org_id, id),
  foreign key (org_id, reversal_payment_id) references public.payments (org_id, id),
  check ((mandate_id is null) = (amount_cents is null)),
  check ((mandate_id is null) = (sequence_type is null)),
  check ((mandate_id is null) = (end_to_end_id is null)),
  check ((return_code is null and return_reason is null) or returned_on is not null),
  check (payment_id is null or mandate_id is not null),
  check (reversal_payment_id is null or (payment_id is not null and returned_on is not null))
);
create unique index sepa_remittance_items_e2e_idx
  on public.sepa_remittance_items (org_id, end_to_end_id) where end_to_end_id is not null;
create index sepa_remittance_items_invoice_idx on public.sepa_remittance_items (invoice_id);
create index sepa_remittance_items_mandate_idx on public.sepa_remittance_items (mandate_id) where mandate_id is not null;

-- ---------------------------------------------------------------------------
-- Reglas derivadas (una sola implementación: las vistas y las RPC las comparten)
-- ---------------------------------------------------------------------------

-- Lo que falta por cobrar de una factura: el mismo cálculo que invoices_overview (se lee de ella).
-- security invoker, como la secuencia: con RLS para quien consulta; dentro de las RPC, sin ella.
create function private.invoice_outstanding(p_invoice uuid) returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce((select o.outstanding_cents from public.invoices_overview o where o.id = p_invoice), 0)::bigint
$$;

-- Secuencia del próximo adeudo de un mandato: FRST hasta que un adeudo suyo va en una remesa ya
-- generada (o enviada, o cobrada) y no se ha devuelto; RCUR después.
create function private.mandate_sequence_type(p_mandate uuid) returns public.sepa_sequence_type
language sql
stable
set search_path = ''
as $$
  select case when exists (
    select 1
    from public.sepa_remittance_items i
    join public.sepa_remittances r on r.id = i.remittance_id
    where i.mandate_id = p_mandate
      and i.returned_on is null
      and r.status <> 'draft'
  ) then 'RCUR' else 'FRST' end::public.sepa_sequence_type
$$;

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------

-- Un mandato ya usado en un fichero no cambia sus datos: se revoca y se firma otro.
create function private.client_mandates_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.sepa_remittance_items i where i.mandate_id = old.id) then
    if tg_op = 'DELETE' then
      raise exception 'Este mandato ya se ha usado en una remesa: revócalo en lugar de borrarlo'
        using errcode = 'P0001', hint = 'mandate_in_use';
    end if;
    if (new.client_id, new.issuer_id, new.reference, new.debtor_name, new.iban, new.bic, new.signed_on)
       is distinct from
       (old.client_id, old.issuer_id, old.reference, old.debtor_name, old.iban, old.bic, old.signed_on) then
      raise exception 'Este mandato ya se ha usado en una remesa: para cambiar sus datos, revócalo y registra otro'
        using errcode = 'P0001', hint = 'mandate_in_use';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger client_mandates_guard
  before update or delete on public.client_mandates
  for each row execute function private.client_mandates_guard();

-- Ciclo de vida de una remesa: borrador ⇄ generada → enviada → cobrada. Lo generado no cambia
-- (salvo las notas); una remesa enviada ya está en el banco y no se borra.
create function private.sepa_remittances_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_free constant text[] := array['notes', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.status in ('sent', 'settled') then
      raise exception 'Una remesa enviada al banco no se borra' using errcode = 'P0001', hint = 'remittance_locked';
    end if;
    return old;
  end if;

  if new.issuer_id <> old.issuer_id or new.org_id <> old.org_id then
    raise exception 'Una remesa no cambia de emisor' using errcode = 'P0001', hint = 'remittance_locked';
  end if;

  if new.status = old.status then
    if old.status <> 'draft' and (to_jsonb(new) - v_free) <> (to_jsonb(old) - v_free) then
      raise exception 'Una remesa generada no se modifica: vuelve a borrador para cambiarla'
        using errcode = 'P0001', hint = 'remittance_locked';
    end if;
  elsif (old.status, new.status) = ('generated'::public.sepa_remittance_status, 'sent'::public.sepa_remittance_status) then
    if (to_jsonb(new) - (v_free || array['status', 'sent_at'])) <> (to_jsonb(old) - (v_free || array['status', 'sent_at'])) then
      raise exception 'Al enviarla, una remesa no cambia' using errcode = 'P0001', hint = 'remittance_locked';
    end if;
  elsif (old.status, new.status) = ('sent'::public.sepa_remittance_status, 'settled'::public.sepa_remittance_status) then
    if (to_jsonb(new) - (v_free || array['status', 'settled_on', 'settled_at']))
       <> (to_jsonb(old) - (v_free || array['status', 'settled_on', 'settled_at'])) then
      raise exception 'Al cobrarla, una remesa no cambia' using errcode = 'P0001', hint = 'remittance_locked';
    end if;
  elsif (old.status, new.status) not in (
    ('draft'::public.sepa_remittance_status, 'generated'::public.sepa_remittance_status),
    ('generated'::public.sepa_remittance_status, 'draft'::public.sepa_remittance_status)
  ) then
    raise exception 'Cambio de estado no válido para una remesa' using errcode = 'P0001', hint = 'remittance_status_invalid';
  elsif new.collection_on <> old.collection_on then
    raise exception 'La fecha de cobro solo cambia en borrador' using errcode = 'P0001', hint = 'remittance_locked';
  end if;
  return new;
end;
$$;

create trigger sepa_remittances_guard
  before update or delete on public.sepa_remittances
  for each row execute function private.sepa_remittances_guard();

-- Recibos: se añaden y se quitan en borrador; lo congelado cambia solo en borrador; las
-- devoluciones, una vez enviada; los cobros, una vez cobrada. Y una factura va en una sola
-- remesa abierta (sin cobrar) a la vez, salvo que allí se haya devuelto.
create function private.sepa_remittance_items_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.sepa_remittance_status;
  v_issuer uuid;
begin
  if tg_op = 'DELETE' then
    select r.status into v_status from public.sepa_remittances r where r.id = old.remittance_id;
    -- Sin remesa: se está borrando la remesa entera (cascada).
    if v_status is not null and v_status <> 'draft' then
      raise exception 'Los recibos de una remesa generada no se quitan: vuelve a borrador'
        using errcode = 'P0001', hint = 'remittance_locked';
    end if;
    return old;
  end if;

  select r.status, r.issuer_id into v_status, v_issuer from public.sepa_remittances r where r.id = new.remittance_id;

  if tg_op = 'INSERT' then
    if v_status <> 'draft' then
      raise exception 'Solo se añaden recibos a una remesa en borrador' using errcode = 'P0001', hint = 'remittance_locked';
    end if;
    if not exists (
      select 1 from public.invoices i
      where i.id = new.invoice_id and i.org_id = new.org_id and i.issuer_id = v_issuer
        and i.lifecycle = 'issued' and i.kind = 'ordinary'
    ) then
      raise exception 'Solo se domicilian facturas emitidas (no rectificativas) del emisor de la remesa'
        using errcode = 'P0001', hint = 'invoice_not_collectible';
    end if;
  else
    if new.remittance_id <> old.remittance_id or new.invoice_id <> old.invoice_id or new.org_id <> old.org_id then
      raise exception 'Un recibo no cambia de remesa ni de factura' using errcode = 'P0001', hint = 'remittance_locked';
    end if;
    if (new.mandate_id, new.amount_cents, new.sequence_type, new.end_to_end_id)
       is distinct from (old.mandate_id, old.amount_cents, old.sequence_type, old.end_to_end_id)
       and v_status <> 'draft' then
      raise exception 'Un recibo generado no cambia' using errcode = 'P0001', hint = 'remittance_locked';
    end if;
    if (new.returned_on, new.return_code, new.return_reason) is distinct from (old.returned_on, old.return_code, old.return_reason)
       and v_status not in ('sent', 'settled') then
      raise exception 'Solo se devuelve un recibo de una remesa enviada' using errcode = 'P0001', hint = 'remittance_not_sent';
    end if;
    if (new.payment_id, new.reversal_payment_id) is distinct from (old.payment_id, old.reversal_payment_id)
       and v_status <> 'settled' then
      raise exception 'Los cobros de una remesa se registran al cobrarla' using errcode = 'P0001', hint = 'remittance_not_settled';
    end if;
  end if;

  if new.mandate_id is not null and not exists (
    select 1 from public.client_mandates m
    join public.invoices i on i.id = new.invoice_id
    where m.id = new.mandate_id and m.client_id = i.client_id and m.issuer_id = v_issuer
  ) then
    raise exception 'El mandato no es de este cliente con este acreedor' using errcode = 'P0001', hint = 'mandate_invalid';
  end if;

  -- Una factura, en una sola remesa abierta. El bloqueo ordena dos altas simultáneas de la misma
  -- factura: la segunda ya ve la primera al comprobar.
  if new.returned_on is null and (tg_op = 'INSERT' or old.returned_on is not null) then
    perform pg_advisory_xact_lock(hashtextextended('sepa-invoice:' || new.invoice_id::text, 0));
    if exists (
      select 1
      from public.sepa_remittance_items i
      join public.sepa_remittances r on r.id = i.remittance_id
      where i.invoice_id = new.invoice_id
        and i.id <> new.id
        and i.remittance_id <> new.remittance_id
        and i.returned_on is null
        and r.status <> 'settled'
    ) then
      raise exception 'Esta factura ya está en otra remesa sin cobrar' using errcode = 'P0001', hint = 'invoice_in_open_remittance';
    end if;
  end if;
  return new;
end;
$$;

create trigger sepa_remittance_items_guard
  before insert or update or delete on public.sepa_remittance_items
  for each row execute function private.sepa_remittance_items_guard();

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.sepa_creditors for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.client_mandates for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.sepa_remittances for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.sepa_remittance_items for each row execute function private.set_updated_at();

create trigger audit after insert or update or delete on public.sepa_creditors for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.client_mandates for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.sepa_remittances for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.sepa_remittance_items for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.sepa_creditors enable row level security;
alter table public.client_mandates enable row level security;
alter table public.sepa_remittances enable row level security;
alter table public.sepa_remittance_items enable row level security;

-- Datos de acreedor: configuración fiscal, la cambia un owner.
create policy sepa_creditors_select on public.sepa_creditors for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy sepa_creditors_insert on public.sepa_creditors for insert to authenticated with check (private.has_role(org_id, 'owner'));
create policy sepa_creditors_update on public.sepa_creditors for update to authenticated
  using (private.has_role(org_id, 'owner')) with check (private.has_role(org_id, 'owner'));
create policy sepa_creditors_delete on public.sepa_creditors for delete to authenticated using (private.has_role(org_id, 'owner'));

-- Mandatos: los lleva un socio, como la ficha del cliente.
create policy client_mandates_select on public.client_mandates for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy client_mandates_insert on public.client_mandates for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy client_mandates_update on public.client_mandates for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy client_mandates_delete on public.client_mandates for delete to authenticated using (private.has_role(org_id, 'partner'));

-- Remesas y recibos: se leen con RLS y se escriben solo con las RPC. Un socio puede borrar una
-- remesa que aún no ha enviado (el trigger impide borrar lo enviado).
create policy sepa_remittances_select on public.sepa_remittances for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy sepa_remittances_delete on public.sepa_remittances for delete to authenticated
  using (private.has_role(org_id, 'partner') and status in ('draft', 'generated'));
create policy sepa_remittance_items_select on public.sepa_remittance_items for select to authenticated
  using (private.has_role(org_id, 'viewer'));
revoke insert, update on public.sepa_remittances from authenticated;
revoke insert, update, delete on public.sepa_remittance_items from authenticated;

-- ---------------------------------------------------------------------------
-- Vistas derivadas (security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------------

-- Mandatos con su secuencia derivada y su uso.
create view public.client_mandates_overview with (security_invoker = true) as
select
  m.id,
  m.org_id,
  m.client_id,
  m.issuer_id,
  m.reference,
  m.debtor_name,
  m.iban,
  m.bic,
  m.signed_on,
  m.revoked_at,
  m.revoke_reason,
  m.notes,
  m.created_at,
  m.updated_at,
  c.display_name as client_name,
  coalesce(iss.trade_name, iss.legal_name) as issuer_name,
  m.revoked_at is null as is_active,
  private.mandate_sequence_type(m.id) as next_sequence_type,
  coalesce(u.collections_count, 0)::integer as collections_count,
  u.last_collection_on,
  coalesce(u.used, false) as in_use
from public.client_mandates m
join public.clients c on c.id = m.client_id
join public.issuers iss on iss.id = m.issuer_id
left join lateral (
  select
    count(*) filter (where i.returned_on is null) as collections_count,
    max(r.collection_on) filter (where i.returned_on is null) as last_collection_on,
    count(*) > 0 as used
  from public.sepa_remittance_items i
  join public.sepa_remittances r on r.id = i.remittance_id
  where i.mandate_id = m.id
) u on true;

-- Recibos con su factura y su estado. En borrador, el importe es el pendiente de hoy (derivado).
create view public.sepa_remittance_items_overview with (security_invoker = true) as
select
  it.id,
  it.org_id,
  it.remittance_id,
  it.invoice_id,
  it.mandate_id,
  coalesce(it.amount_cents, io.outstanding_cents)::bigint as amount_cents,
  it.amount_cents is not null as frozen,
  it.sequence_type,
  it.end_to_end_id,
  it.returned_on,
  it.return_code,
  it.return_reason,
  it.payment_id,
  it.reversal_payment_id,
  it.created_at,
  r.status as remittance_status,
  r.collection_on,
  r.issuer_id,
  io.number as invoice_number,
  io.client_id,
  io.client_name,
  io.issued_on,
  io.due_on,
  io.outstanding_cents,
  io.status as invoice_status,
  case
    when it.returned_on is not null then 'returned'
    when r.status = 'settled' then 'collected'
    else 'pending'
  end::public.sepa_item_state as state
from public.sepa_remittance_items it
join public.sepa_remittances r on r.id = it.remittance_id
join public.invoices_overview io on io.id = it.invoice_id;

-- Remesas con sus totales (derivados de los recibos).
create view public.sepa_remittances_overview with (security_invoker = true) as
select
  r.id,
  r.org_id,
  r.issuer_id,
  r.collection_on,
  r.status,
  r.notes,
  r.message_id,
  r.creditor_snapshot,
  r.file_path,
  r.generated_at,
  r.sent_at,
  r.settled_on,
  r.settled_at,
  r.created_at,
  r.updated_at,
  coalesce(iss.trade_name, iss.legal_name) as issuer_name,
  coalesce(t.items_count, 0)::integer as items_count,
  coalesce(t.total_cents, 0)::bigint as total_cents,
  coalesce(t.returned_count, 0)::integer as returned_count,
  coalesce(t.returned_cents, 0)::bigint as returned_cents
from public.sepa_remittances r
join public.issuers iss on iss.id = r.issuer_id
left join lateral (
  select
    count(*) as items_count,
    sum(i.amount_cents) as total_cents,
    count(*) filter (where i.returned_on is not null) as returned_count,
    sum(i.amount_cents) filter (where i.returned_on is not null) as returned_cents
  from public.sepa_remittance_items_overview i
  where i.remittance_id = r.id
) t on true;

revoke all on public.client_mandates_overview, public.sepa_remittance_items_overview, public.sepa_remittances_overview from anon;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Crea o actualiza una remesa en borrador con el conjunto completo de sus facturas (lo que no
-- viene se quita). Con `remittance_id` de una remesa que aún no existe, la crea con ese id: así
-- repetir el alta (doble clic, reintento) no duplica nada.
--   p: { remittance_id?, expected_updated_at?, issuer_id, collection_on, notes?, invoice_ids: [] }
create function public.sepa_save_remittance(p jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'remittance_id', '')::uuid;
  v_issuer uuid := nullif(p ->> 'issuer_id', '')::uuid;
  v_on date := nullif(p ->> 'collection_on', '')::date;
  v_notes text := nullif(btrim(coalesce(p ->> 'notes', '')), '');
  v_org uuid;
  v_r public.sepa_remittances;
  v_ids uuid[];
begin
  select i.org_id into v_org from public.issuers i where i.id = v_issuer;
  if v_org is null or not private.has_role(v_org, 'partner') then
    raise exception 'Sin permiso para domiciliar en esta organización' using errcode = '42501';
  end if;
  if v_on is null or v_on <= private.org_today(v_org) then
    raise exception 'La fecha de cobro tiene que ser posterior a hoy' using errcode = 'P0001', hint = 'collection_date_past';
  end if;
  select coalesce(array_agg(distinct x::uuid), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(p -> 'invoice_ids', '[]'::jsonb)) x;

  if v_id is not null then
    select * into v_r from public.sepa_remittances where id = v_id for update;
  end if;
  if v_r.id is not null then
    if v_r.org_id <> v_org or v_r.issuer_id <> v_issuer then
      raise exception 'Remesa no encontrada' using errcode = 'P0002', hint = 'remittance_not_found';
    end if;
    if v_r.status <> 'draft' then
      raise exception 'Solo se edita una remesa en borrador' using errcode = 'P0001', hint = 'remittance_not_draft';
    end if;
    if nullif(p ->> 'expected_updated_at', '') is not null
       and (p ->> 'expected_updated_at')::timestamptz <> v_r.updated_at then
      raise exception 'La remesa ha cambiado mientras la editabas' using errcode = 'P0001', hint = 'remittance_changed';
    end if;
    update public.sepa_remittances set collection_on = v_on, notes = v_notes where id = v_id;
  else
    insert into public.sepa_remittances (id, org_id, issuer_id, collection_on, notes)
    values (coalesce(v_id, gen_random_uuid()), v_org, v_issuer, v_on, v_notes)
    returning id into v_id;
  end if;

  delete from public.sepa_remittance_items i where i.remittance_id = v_id and not (i.invoice_id = any (v_ids));
  insert into public.sepa_remittance_items (org_id, remittance_id, invoice_id)
  select v_org, v_id, x.id
  from unnest(v_ids) as x (id)
  where not exists (select 1 from public.sepa_remittance_items i where i.remittance_id = v_id and i.invoice_id = x.id);

  -- Cualquier cambio en los recibos cuenta como cambio de la remesa (bloqueo optimista).
  update public.sepa_remittances set updated_at = clock_timestamp() where id = v_id;
  return v_id;
end;
$$;

-- Congela una remesa al generar su fichero (borrador → generada). El fichero lo ha hecho TS con
-- estos mismos datos y ya está en Storage; aquí se comprueba que todo sigue siendo verdad (el
-- ICS confirmado, cada mandato vigente, cada importe igual al pendiente de su factura y cada
-- secuencia la derivada) y se guarda. Si algo ha cambiado, no se congela nada.
--   p: { remittance_id, expected_updated_at?, message_id, generated_at, file_path,
--        creditor: { creditor_id, name, iban, bic },
--        items: [{ id, mandate_id, amount_cents, sequence_type, end_to_end_id }] }
create function public.sepa_mark_generated(p jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.sepa_remittances;
  v_creditor public.sepa_creditors;
  v_issuer_iban text;
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
  v_count integer;
  v_distinct integer;
  v_valid integer;
begin
  select * into v_r from public.sepa_remittances where id = nullif(p ->> 'remittance_id', '')::uuid for update;
  if not found or not private.has_role(v_r.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta remesa' using errcode = '42501';
  end if;
  if v_r.status <> 'draft' then
    raise exception 'Esta remesa ya tiene su fichero' using errcode = 'P0001', hint = 'remittance_not_draft';
  end if;
  if nullif(p ->> 'expected_updated_at', '') is not null
     and (p ->> 'expected_updated_at')::timestamptz <> v_r.updated_at then
    raise exception 'La remesa ha cambiado: revísala y vuelve a generarla' using errcode = 'P0001', hint = 'remittance_changed';
  end if;
  if v_r.collection_on <= private.org_today(v_r.org_id) then
    raise exception 'La fecha de cobro tiene que ser posterior a hoy' using errcode = 'P0001', hint = 'collection_date_past';
  end if;

  select * into v_creditor from public.sepa_creditors c where c.issuer_id = v_r.issuer_id;
  if v_creditor.id is null or v_creditor.creditor_identifier_confirmed_at is null then
    raise exception 'Falta confirmar el identificador de acreedor (ICS) con el banco'
      using errcode = 'P0001', hint = 'creditor_unconfirmed';
  end if;
  select iss.iban into v_issuer_iban from public.issuers iss where iss.id = v_r.issuer_id;
  if (p #>> '{creditor,creditor_id}') is distinct from v_creditor.creditor_identifier
     or (p #>> '{creditor,iban}') is distinct from coalesce(v_creditor.iban, v_issuer_iban) then
    raise exception 'Los datos del acreedor han cambiado: vuelve a generarla' using errcode = 'P0001', hint = 'remittance_changed';
  end if;

  select count(*) into v_count from public.sepa_remittance_items i where i.remittance_id = v_r.id;
  if v_count = 0 then
    raise exception 'La remesa no tiene recibos' using errcode = 'P0001', hint = 'remittance_empty';
  end if;
  select count(distinct x.id) into v_distinct from jsonb_to_recordset(v_items) as x (id uuid);
  select count(*) into v_valid
  from jsonb_to_recordset(v_items) as x (
    id uuid, mandate_id uuid, amount_cents bigint, sequence_type public.sepa_sequence_type, end_to_end_id text
  )
  join public.sepa_remittance_items it on it.id = x.id and it.remittance_id = v_r.id
  join public.invoices inv on inv.id = it.invoice_id
  join public.client_mandates m on m.id = x.mandate_id
  where m.client_id = inv.client_id
    and m.issuer_id = v_r.issuer_id
    and m.revoked_at is null
    and m.signed_on <= v_r.collection_on
    and x.amount_cents > 0
    and x.amount_cents = private.invoice_outstanding(it.invoice_id)
    and x.sequence_type = private.mandate_sequence_type(m.id)
    and nullif(x.end_to_end_id, '') is not null;
  if v_distinct <> v_count or v_valid <> v_count or jsonb_array_length(v_items) <> v_count then
    raise exception 'La remesa ha cambiado (mandatos o importes pendientes): revísala y vuelve a generarla'
      using errcode = 'P0001', hint = 'remittance_changed';
  end if;

  update public.sepa_remittance_items it set
    mandate_id = x.mandate_id,
    amount_cents = x.amount_cents,
    sequence_type = x.sequence_type,
    end_to_end_id = x.end_to_end_id
  from jsonb_to_recordset(v_items) as x (
    id uuid, mandate_id uuid, amount_cents bigint, sequence_type public.sepa_sequence_type, end_to_end_id text
  )
  where it.id = x.id and it.remittance_id = v_r.id;

  update public.sepa_remittances set
    status = 'generated',
    message_id = p ->> 'message_id',
    creditor_snapshot = p -> 'creditor',
    file_path = p ->> 'file_path',
    generated_at = coalesce(nullif(p ->> 'generated_at', '')::timestamptz, now())
  where id = v_r.id;
end;
$$;

-- Generada → borrador (aún no se ha enviado): se descongelan sus recibos. Devuelve la ruta del
-- fichero descartado para que el servidor lo borre de Storage.
create function public.sepa_revert_to_draft(p_remittance_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.sepa_remittances;
begin
  select * into v_r from public.sepa_remittances where id = p_remittance_id for update;
  if not found or not private.has_role(v_r.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta remesa' using errcode = '42501';
  end if;
  if v_r.status = 'draft' then
    return null;
  end if;
  if v_r.status <> 'generated' then
    raise exception 'Una remesa enviada al banco ya no vuelve a borrador' using errcode = 'P0001', hint = 'remittance_locked';
  end if;
  update public.sepa_remittances set
    status = 'draft', message_id = null, creditor_snapshot = null, file_path = null, generated_at = null
  where id = v_r.id;
  update public.sepa_remittance_items set
    mandate_id = null, amount_cents = null, sequence_type = null, end_to_end_id = null
  where remittance_id = v_r.id;
  return v_r.file_path;
end;
$$;

-- Generada → enviada (el socio ha subido el fichero al banco). Idempotente.
create function public.sepa_mark_sent(p_remittance_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.sepa_remittances;
begin
  select * into v_r from public.sepa_remittances where id = p_remittance_id for update;
  if not found or not private.has_role(v_r.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta remesa' using errcode = '42501';
  end if;
  if v_r.status in ('sent', 'settled') then
    return;
  end if;
  if v_r.status <> 'generated' then
    raise exception 'Primero hay que generar el fichero' using errcode = 'P0001', hint = 'remittance_not_generated';
  end if;
  update public.sepa_remittances set status = 'sent', sent_at = now() where id = v_r.id;
end;
$$;

-- Enviada → cobrada: registra de una vez un cobro (domiciliación, con la referencia del adeudo)
-- por cada recibo no devuelto. Idempotente: una remesa cobrada no vuelve a crear cobros.
-- Devuelve cuántos cobros ha creado.
create function public.sepa_settle_remittance(p_remittance_id uuid, p_settled_on date) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.sepa_remittances;
  v_count integer := 0;
  it record;
  v_payment uuid;
begin
  select * into v_r from public.sepa_remittances where id = p_remittance_id for update;
  if not found or not private.has_role(v_r.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta remesa' using errcode = '42501';
  end if;
  if v_r.status = 'settled' then
    return 0;
  end if;
  if v_r.status <> 'sent' then
    raise exception 'Solo se cobra una remesa enviada al banco' using errcode = 'P0001', hint = 'remittance_not_sent';
  end if;
  if p_settled_on is null or p_settled_on > private.org_today(v_r.org_id) then
    raise exception 'La fecha de abono no puede ser futura' using errcode = 'P0001', hint = 'settle_date_invalid';
  end if;

  update public.sepa_remittances set status = 'settled', settled_on = p_settled_on, settled_at = now() where id = v_r.id;

  for it in
    select i.id, i.invoice_id, i.amount_cents, i.end_to_end_id
    from public.sepa_remittance_items i
    where i.remittance_id = v_r.id and i.returned_on is null and i.payment_id is null
    order by i.created_at, i.id
    for update
  loop
    insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method, reference)
    values (v_r.org_id, it.invoice_id, it.amount_cents, p_settled_on, 'sepa_debit', it.end_to_end_id)
    returning id into v_payment;
    update public.sepa_remittance_items set payment_id = v_payment where id = it.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Devolución de un recibo (rechazo antes del abono o devolución después): la factura vuelve a
-- quedar pendiente. Si la remesa ya estaba cobrada, se registra el cobro negativo. Idempotente.
create function public.sepa_return_item(p_item_id uuid, p_returned_on date, p_code text default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.sepa_remittance_items;
  v_r public.sepa_remittances;
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_payment uuid;
begin
  select * into v_item from public.sepa_remittance_items where id = p_item_id;
  if not found then
    raise exception 'Sin permiso sobre esta remesa' using errcode = '42501';
  end if;
  select * into v_r from public.sepa_remittances where id = v_item.remittance_id for update;
  if not private.has_role(v_r.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta remesa' using errcode = '42501';
  end if;
  select * into v_item from public.sepa_remittance_items where id = p_item_id for update;
  if v_item.returned_on is not null then
    return;
  end if;
  if v_r.status not in ('sent', 'settled') then
    raise exception 'Solo se devuelve un recibo de una remesa enviada' using errcode = 'P0001', hint = 'remittance_not_sent';
  end if;
  if p_returned_on is null or p_returned_on > private.org_today(v_r.org_id) then
    raise exception 'La fecha de la devolución no puede ser futura' using errcode = 'P0001', hint = 'return_date_invalid';
  end if;

  if v_item.payment_id is not null then
    insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method, reference, notes)
    values (
      v_r.org_id, v_item.invoice_id, -v_item.amount_cents, p_returned_on, 'sepa_debit', v_item.end_to_end_id,
      nullif(concat_ws(' · ', v_code, v_reason), '')
    )
    returning id into v_payment;
  end if;
  update public.sepa_remittance_items set
    returned_on = p_returned_on, return_code = v_code, return_reason = v_reason, reversal_payment_id = v_payment
  where id = v_item.id;
end;
$$;

-- Deshace una devolución registrada por error. Si la remesa está cobrada, el recibo vuelve a
-- contar como cobrado: se borra el cobro negativo o, si se devolvió antes del abono, se registra
-- el cobro con la fecha de abono. Idempotente.
create function public.sepa_undo_return(p_item_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.sepa_remittance_items;
  v_r public.sepa_remittances;
  v_payment uuid;
  v_reversal uuid;
begin
  select * into v_item from public.sepa_remittance_items where id = p_item_id;
  if not found then
    raise exception 'Sin permiso sobre esta remesa' using errcode = '42501';
  end if;
  select * into v_r from public.sepa_remittances where id = v_item.remittance_id for update;
  if not private.has_role(v_r.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta remesa' using errcode = '42501';
  end if;
  select * into v_item from public.sepa_remittance_items where id = p_item_id for update;
  if v_item.returned_on is null then
    return;
  end if;

  v_payment := v_item.payment_id;
  v_reversal := v_item.reversal_payment_id;
  if v_r.status = 'settled' and v_payment is null then
    insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method, reference)
    values (v_r.org_id, v_item.invoice_id, v_item.amount_cents, v_r.settled_on, 'sepa_debit', v_item.end_to_end_id)
    returning id into v_payment;
  end if;
  update public.sepa_remittance_items set
    returned_on = null, return_code = null, return_reason = null, reversal_payment_id = null, payment_id = v_payment
  where id = v_item.id;
  if v_reversal is not null then
    delete from public.payments where id = v_reversal;
  end if;
end;
$$;

revoke all on function private.invoice_outstanding(uuid) from public;
revoke all on function private.mandate_sequence_type(uuid) from public;
grant execute on function private.invoice_outstanding(uuid) to authenticated;
grant execute on function private.mandate_sequence_type(uuid) to authenticated;

revoke all on function public.sepa_save_remittance(jsonb) from public, anon;
revoke all on function public.sepa_mark_generated(jsonb) from public, anon;
revoke all on function public.sepa_revert_to_draft(uuid) from public, anon;
revoke all on function public.sepa_mark_sent(uuid) from public, anon;
revoke all on function public.sepa_settle_remittance(uuid, date) from public, anon;
revoke all on function public.sepa_return_item(uuid, date, text, text) from public, anon;
revoke all on function public.sepa_undo_return(uuid) from public, anon;
grant execute on function public.sepa_save_remittance(jsonb) to authenticated;
grant execute on function public.sepa_mark_generated(jsonb) to authenticated;
grant execute on function public.sepa_revert_to_draft(uuid) to authenticated;
grant execute on function public.sepa_mark_sent(uuid) to authenticated;
grant execute on function public.sepa_settle_remittance(uuid, date) to authenticated;
grant execute on function public.sepa_return_item(uuid, date, text, text) to authenticated;
grant execute on function public.sepa_undo_return(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: ficheros de remesas (copia exacta de lo enviado al banco). Privado: solo el servidor
-- lee y escribe, después de comprobar con RLS que la remesa es de la org de quien lo pide.
-- En PGlite (tests) no existe el esquema storage y esto se salta.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $sql$
      insert into storage.buckets (id, name, public)
      values ('remittances', 'remittances', false)
      on conflict (id) do nothing
    $sql$;
  end if;
end;
$$;

revoke all on all tables in schema public from anon;
