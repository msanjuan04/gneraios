-- GNERAI OS · Banco · Conciliación bancaria
-- Extractos del banco (Norma 43 o CSV) por cuenta de caja, sus movimientos sin duplicados aunque
-- los extractos se solapen, los enlaces de cada movimiento con lo que explica (un cobro, un gasto o
-- una remesa SEPA), los movimientos ignorados con su motivo y las reglas que se aprenden al
-- confirmar. GNERAI OS propone qué es cada movimiento; un socio lo confirma (nada se concilia solo).
-- Ver ARCHITECTURE.md §5 (seguridad), §6 (convenciones y lo derivado) y el módulo de Finanzas
-- (20260926210000_control.sql), de facturación (…140000) y de cobros SEPA (…260000).
--
-- Un dato, un sitio:
-- - El cobro (payments) y el gasto (expenses) siguen siendo el hecho contable. Un enlace
--   (bank_matches) solo dice «esta parte de este movimiento es ese cobro, ese gasto o esa remesa».
--   Si el enlace creó el cobro o el gasto, lo recuerda para que deshacerlo lo borre.
-- - El estado de un movimiento (sin conciliar, parcial, conciliado, ignorado) se deriva en
--   bank_transactions_overview: nunca se guarda.
-- - Los saldos del extracto son saldos de caja: el inicial va a cash_balances el día anterior al
--   periodo y el final, el último día (el del banco manda). El extracto no los copia: su vista los
--   lee de ahí por fecha y comprueba que saldo inicial + movimientos = saldo final.
-- - Las propuestas (qué factura paga cada movimiento, con qué confianza y por qué) las calcula TS
--   cada vez (src/domain/banking/matcher.ts): son derivadas y no se guardan.
--
-- Reparto de responsabilidades:
-- - Leer el fichero (Norma 43 / CSV), la huella de cada movimiento y las propuestas: TS puro
--   (src/domain/banking). La huella es (fecha, importe, nº de orden entre los iguales de ese día):
--   un extracto que se solapa con otro no duplica nada, ni siquiera dos movimientos idénticos del
--   mismo día, y no depende del texto del concepto (que cambia entre el N43 y el CSV del banco).
-- - Aquí, lo que tiene que ser atómico e invariable: importar (extracto + movimientos + saldos),
--   confirmar (crear el cobro y su enlace; cobrar la remesa y enlazarla; crear el gasto y su enlace)
--   y deshacer; y que lo conciliado nunca supere el movimiento, el cobro, el gasto, la remesa ni el
--   pendiente de la factura.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.bank_statement_format as enum ('n43', 'csv');
create type public.bank_direction as enum ('credit', 'debit');
-- Por qué un movimiento no se concilia con nada: traspaso entre cuentas propias, aportación o
-- retirada de un socio, financiación (préstamos, capital), liquidación de impuestos ya prevista,
-- gasto personal u otro motivo (con nota).
create type public.bank_ignore_reason as enum (
  'internal_transfer', 'partner_movement', 'financing', 'tax_settlement', 'personal', 'other'
);
create type public.bank_rule_field as enum ('counterparty', 'concept');
-- Estado derivado (nunca se guarda): sale de bank_transactions_overview.
create type public.bank_reconciliation_status as enum ('unmatched', 'partial', 'reconciled', 'ignored');

-- ---------------------------------------------------------------------------
-- Extractos importados
-- ---------------------------------------------------------------------------
create table public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  account_id uuid not null,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  -- SHA-256 del fichero: el mismo fichero dos veces en la misma cuenta es la misma importación.
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  format public.bank_statement_format not null,
  -- Días que cubre el extracto. Sus saldos inicial y final viven en cash_balances (ver cabecera).
  period_start date not null,
  period_end date not null,
  -- Movimientos que traía el fichero; los nuevos son los que llevan este statement_id.
  movements_in_file integer not null check (movements_in_file >= 0),
  -- created_by es quien lo importó y created_at, cuándo.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (org_id, id, account_id),
  unique (account_id, file_hash),
  foreign key (org_id, account_id) references public.cash_accounts (org_id, id),
  check (period_end >= period_start)
);
create index bank_statements_account_idx on public.bank_statements (account_id, period_end desc);

-- ---------------------------------------------------------------------------
-- Movimientos (lo que dice el banco: no se editan)
-- ---------------------------------------------------------------------------
create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  account_id uuid not null,
  -- El extracto que lo trajo por primera vez.
  statement_id uuid not null,
  -- Orden dentro de ese extracto (los del mismo día, como los lista el banco).
  position integer not null check (position >= 0),
  -- Fecha de operación (la que manda) y fecha valor.
  booked_on date not null,
  value_on date,
  -- Con signo: positivo es un abono (entra dinero) y negativo, un cargo.
  amount_cents bigint not null check (amount_cents <> 0),
  concept text not null default '' check (char_length(concept) <= 1000),
  counterparty text check (counterparty is null or char_length(counterparty) between 1 and 200),
  counterparty_iban text check (counterparty_iban is null or counterparty_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  -- Referencias del banco (nº de documento, referencias 1 y 2 de la Norma 43…).
  reference text check (reference is null or char_length(reference) between 1 and 100),
  -- Norma 43: concepto común (2 cifras) y, si lo hay, el propio del banco ("04", "12-105").
  bank_code text check (bank_code is null or bank_code ~ '^[0-9]{2}(-[0-9A-Z]{1,3})?$'),
  -- Saldo después del movimiento, si el extracto lo trae.
  balance_after_cents bigint,
  -- Huella (TS): fecha, importe y nº de orden entre los movimientos iguales de ese día.
  fingerprint text not null check (char_length(fingerprint) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  -- Un movimiento, una vez por cuenta, lo traiga el extracto que lo traiga.
  unique (account_id, fingerprint),
  foreign key (org_id, account_id) references public.cash_accounts (org_id, id),
  -- El movimiento es de la cuenta de su extracto.
  foreign key (org_id, statement_id, account_id) references public.bank_statements (org_id, id, account_id) on delete cascade,
  check (value_on is null or abs(value_on - booked_on) <= 366)
);
create index bank_transactions_account_booked_idx on public.bank_transactions (account_id, booked_on desc, position desc);
create index bank_transactions_statement_idx on public.bank_transactions (statement_id);
create index bank_transactions_org_booked_idx on public.bank_transactions (org_id, booked_on desc);

-- ---------------------------------------------------------------------------
-- Enlaces: qué parte de un movimiento es qué cobro, gasto o remesa
-- ---------------------------------------------------------------------------
-- Un movimiento puede pagar varias facturas (varios enlaces) y una factura puede cobrarse con
-- varios movimientos (varios enlaces a cobros suyos). El importe va en valor absoluto: el signo es
-- el del movimiento.
create table public.bank_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  transaction_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_id uuid,
  expense_id uuid,
  remittance_id uuid,
  -- Lo que hizo la confirmación, para que deshacerla lo revierta: crear el cobro, crear el gasto,
  -- dar por pagado un gasto pendiente o cobrar la remesa (esto último no se deshace: la remesa
  -- sigue cobrada).
  created_payment boolean not null default false,
  created_expense boolean not null default false,
  marked_paid boolean not null default false,
  settled_remittance boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (transaction_id, payment_id),
  unique (transaction_id, expense_id),
  unique (transaction_id, remittance_id),
  -- Un extracto con movimientos ya decididos no se borra (sin cascada).
  foreign key (org_id, transaction_id) references public.bank_transactions (org_id, id),
  -- El cobro y el gasto son el hecho contable: si se borran en su módulo, el enlace desaparece.
  foreign key (org_id, payment_id) references public.payments (org_id, id) on delete cascade,
  foreign key (org_id, expense_id) references public.expenses (org_id, id) on delete cascade,
  foreign key (org_id, remittance_id) references public.sepa_remittances (org_id, id),
  check (num_nonnulls(payment_id, expense_id, remittance_id) = 1),
  check (not created_payment or payment_id is not null),
  check (not (created_expense or marked_paid) or expense_id is not null),
  check (not (created_expense and marked_paid)),
  check (not settled_remittance or remittance_id is not null)
);
create index bank_matches_transaction_idx on public.bank_matches (transaction_id);
create index bank_matches_payment_idx on public.bank_matches (payment_id) where payment_id is not null;
create index bank_matches_expense_idx on public.bank_matches (expense_id) where expense_id is not null;
create index bank_matches_remittance_idx on public.bank_matches (remittance_id) where remittance_id is not null;
-- Lo que crea una confirmación es de ese enlace y de ningún otro.
create unique index bank_matches_created_payment_idx on public.bank_matches (payment_id) where created_payment;
create unique index bank_matches_created_expense_idx on public.bank_matches (expense_id) where created_expense;

-- ---------------------------------------------------------------------------
-- Movimientos ignorados (con su motivo)
-- ---------------------------------------------------------------------------
create table public.bank_ignores (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  transaction_id uuid not null,
  reason public.bank_ignore_reason not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (transaction_id),
  foreign key (org_id, transaction_id) references public.bank_transactions (org_id, id),
  check (reason <> 'other' or char_length(btrim(coalesce(note, ''))) > 0)
);

-- ---------------------------------------------------------------------------
-- Reglas aprendidas al confirmar
-- ---------------------------------------------------------------------------
-- «Los cargos cuyo concepto contiene ADOBE CREATIVE son del proveedor Adobe, categoría Software»;
-- «los abonos de RESTAURANT CAN SORRA son de ese cliente». Las propone el matcher; no concilian solas.
create table public.bank_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  direction public.bank_direction not null,
  field public.bank_rule_field not null,
  -- Palabras (normalizadas: mayúsculas, sin acentos) que tiene que contener el campo, en cualquier orden.
  pattern text not null check (pattern ~ '^[A-Z0-9]{2,40}( [A-Z0-9]{2,40}){0,5}$'),
  vendor_id uuid,
  category_id uuid,
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  unique (org_id, direction, field, pattern),
  foreign key (org_id, vendor_id) references public.vendors (org_id, id) on delete cascade,
  foreign key (org_id, category_id) references public.expense_categories (org_id, id) on delete cascade,
  foreign key (org_id, client_id) references public.clients (org_id, id) on delete cascade,
  -- Un cargo apunta a un proveedor y una categoría; un abono, a un cliente.
  check (
    (direction = 'debit' and category_id is not null and client_id is null)
    or (direction = 'credit' and client_id is not null and vendor_id is null and category_id is null)
  )
);

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------

-- Lo conciliado de un movimiento nunca supera su importe, ni lo de un cobro, un gasto o una remesa
-- el suyo; el signo tiene que cuadrar (un abono es un cobro o una remesa; un cargo, un gasto o una
-- devolución); y un movimiento ignorado no se concilia. Bloquea el movimiento y el destino, así que
-- dos confirmaciones a la vez se ordenan solas. security definer: suma todos los enlaces, los vea o
-- no quien escribe.
create function private.bank_matches_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount bigint;
  v_used bigint;
  v_target bigint;
  v_target_used bigint;
begin
  if tg_op = 'UPDATE' and (new.org_id, new.transaction_id, new.payment_id, new.expense_id, new.remittance_id)
     is distinct from (old.org_id, old.transaction_id, old.payment_id, old.expense_id, old.remittance_id) then
    raise exception 'Un enlace no cambia de movimiento ni de destino' using errcode = 'P0001', hint = 'bank_match_fixed';
  end if;

  select t.amount_cents into v_amount
  from public.bank_transactions t
  where t.id = new.transaction_id and t.org_id = new.org_id
  for update;
  if v_amount is null then
    raise exception 'Movimiento no encontrado' using errcode = 'P0002', hint = 'bank_transaction_not_found';
  end if;
  if exists (select 1 from public.bank_ignores i where i.transaction_id = new.transaction_id) then
    raise exception 'Este movimiento está ignorado: vuelve a tenerlo en cuenta antes de conciliarlo'
      using errcode = 'P0001', hint = 'bank_transaction_ignored';
  end if;
  select coalesce(sum(m.amount_cents), 0) into v_used
  from public.bank_matches m
  where m.transaction_id = new.transaction_id and m.id <> new.id;
  if v_used + new.amount_cents > abs(v_amount) then
    raise exception 'Lo conciliado supera el importe del movimiento' using errcode = 'P0001', hint = 'bank_match_exceeds_movement';
  end if;

  if new.payment_id is not null then
    select p.amount_cents into v_target from public.payments p where p.id = new.payment_id and p.org_id = new.org_id for update;
    if v_target is null then
      raise exception 'Cobro no encontrado' using errcode = 'P0002', hint = 'bank_allocation_invalid';
    end if;
    if sign(v_target) <> sign(v_amount) then
      raise exception 'Un abono concilia cobros y un cargo, devoluciones' using errcode = 'P0001', hint = 'bank_match_direction';
    end if;
    select coalesce(sum(m.amount_cents), 0) into v_target_used
    from public.bank_matches m where m.payment_id = new.payment_id and m.id <> new.id;
  elsif new.expense_id is not null then
    select e.total_cents into v_target from public.expenses e where e.id = new.expense_id and e.org_id = new.org_id for update;
    if v_target is null then
      raise exception 'Gasto no encontrado' using errcode = 'P0002', hint = 'bank_allocation_invalid';
    end if;
    -- Un cargo paga un gasto; un abono del proveedor (gasto negativo) lo devuelve.
    if v_target = 0 or sign(v_target) = sign(v_amount) then
      raise exception 'Un cargo concilia gastos y un abono, abonos de proveedores' using errcode = 'P0001', hint = 'bank_match_direction';
    end if;
    select coalesce(sum(m.amount_cents), 0) into v_target_used
    from public.bank_matches m where m.expense_id = new.expense_id and m.id <> new.id;
  else
    if v_amount < 0 then
      raise exception 'Una remesa se concilia con un abono' using errcode = 'P0001', hint = 'bank_match_direction';
    end if;
    perform 1 from public.sepa_remittances r where r.id = new.remittance_id and r.org_id = new.org_id for update;
    if not found then
      raise exception 'Remesa no encontrada' using errcode = 'P0002', hint = 'bank_allocation_invalid';
    end if;
    -- Lo que abona el banco: los recibos generados que no se han devuelto.
    select coalesce(sum(i.amount_cents), 0) into v_target
    from public.sepa_remittance_items i where i.remittance_id = new.remittance_id and i.returned_on is null;
    select coalesce(sum(m.amount_cents), 0) into v_target_used
    from public.bank_matches m where m.remittance_id = new.remittance_id and m.id <> new.id;
  end if;

  if v_target_used + new.amount_cents > abs(v_target) then
    raise exception 'Lo conciliado supera el importe de lo que se enlaza' using errcode = 'P0001', hint = 'bank_match_exceeds_target';
  end if;
  return new;
end;
$$;

create trigger bank_matches_guard before insert or update on public.bank_matches
  for each row execute function private.bank_matches_guard();

-- Un movimiento con algo conciliado no se ignora (primero se deshace lo conciliado).
create function private.bank_ignores_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.org_id, new.transaction_id) is distinct from (old.org_id, old.transaction_id) then
    raise exception 'Un movimiento ignorado no cambia' using errcode = 'P0001', hint = 'bank_match_fixed';
  end if;
  perform 1 from public.bank_transactions t where t.id = new.transaction_id and t.org_id = new.org_id for update;
  if not found then
    raise exception 'Movimiento no encontrado' using errcode = 'P0002', hint = 'bank_transaction_not_found';
  end if;
  if exists (select 1 from public.bank_matches m where m.transaction_id = new.transaction_id) then
    raise exception 'Este movimiento ya tiene algo conciliado: deshazlo antes de ignorarlo'
      using errcode = 'P0001', hint = 'bank_transaction_matched';
  end if;
  return new;
end;
$$;

create trigger bank_ignores_guard before insert or update on public.bank_ignores
  for each row execute function private.bank_ignores_guard();

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.bank_statements for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.bank_transactions for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.bank_matches for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.bank_ignores for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.bank_rules for each row execute function private.set_updated_at();

-- Auditoría de lo que decide una persona. Los movimientos los trae el extracto (su importación sí
-- queda en el log), así que no lo llenan.
create trigger audit after insert or update or delete on public.bank_statements for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.bank_matches for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.bank_ignores for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.bank_rules for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.bank_statements enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.bank_matches enable row level security;
alter table public.bank_ignores enable row level security;
alter table public.bank_rules enable row level security;

-- Lo ve cualquier miembro. Extractos, movimientos, enlaces e ignorados se escriben solo con las RPC
-- (atómicas y con sus comprobaciones), que exigen ser socio.
create policy bank_statements_select on public.bank_statements for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy bank_transactions_select on public.bank_transactions for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy bank_matches_select on public.bank_matches for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy bank_ignores_select on public.bank_ignores for select to authenticated using (private.has_role(org_id, 'viewer'));
revoke insert, update, delete on public.bank_statements, public.bank_transactions, public.bank_matches, public.bank_ignores from authenticated;

-- Reglas: configuración de la operativa. Las ve cualquier miembro y las lleva un socio.
create policy bank_rules_select on public.bank_rules for select to authenticated using (private.has_role(org_id, 'viewer'));
create policy bank_rules_insert on public.bank_rules for insert to authenticated with check (private.has_role(org_id, 'partner'));
create policy bank_rules_update on public.bank_rules for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy bank_rules_delete on public.bank_rules for delete to authenticated using (private.has_role(org_id, 'partner'));

-- ---------------------------------------------------------------------------
-- Vistas derivadas (security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------------

-- Movimientos con su estado derivado: ignorado, sin conciliar, parcial o conciliado.
create view public.bank_transactions_overview with (security_invoker = true) as
select
  t.id,
  t.org_id,
  t.account_id,
  t.statement_id,
  t.position,
  t.booked_on,
  t.value_on,
  t.amount_cents,
  t.concept,
  t.counterparty,
  t.counterparty_iban,
  t.reference,
  t.bank_code,
  t.balance_after_cents,
  t.fingerprint,
  t.created_at,
  a.name as account_name,
  a.issuer_id,
  a.is_active as account_is_active,
  (case when t.amount_cents > 0 then 'credit' else 'debit' end)::public.bank_direction as direction,
  coalesce(m.matched_cents, 0)::bigint as matched_cents,
  (abs(t.amount_cents) - coalesce(m.matched_cents, 0))::bigint as remaining_cents,
  coalesce(m.matches_count, 0)::integer as matches_count,
  m.last_matched_at,
  ig.reason as ignored_reason,
  ig.note as ignored_note,
  ig.created_at as ignored_at,
  case
    when ig.id is not null then 'ignored'
    when coalesce(m.matched_cents, 0) = 0 then 'unmatched'
    when m.matched_cents < abs(t.amount_cents) then 'partial'
    else 'reconciled'
  end::public.bank_reconciliation_status as status
from public.bank_transactions t
join public.cash_accounts a on a.id = t.account_id
left join lateral (
  select sum(x.amount_cents) as matched_cents, count(*) as matches_count, max(x.created_at) as last_matched_at
  from public.bank_matches x
  where x.transaction_id = t.id
) m on true
left join public.bank_ignores ig on ig.transaction_id = t.id;

-- Enlaces con lo que enlazan (factura y cliente del cobro; proveedor y categoría del gasto; remesa).
create view public.bank_matches_overview with (security_invoker = true) as
select
  m.id,
  m.org_id,
  m.transaction_id,
  m.amount_cents,
  m.payment_id,
  m.expense_id,
  m.remittance_id,
  m.created_payment,
  m.created_expense,
  m.marked_paid,
  m.settled_remittance,
  m.created_at,
  m.created_by,
  (case when m.payment_id is not null then 'payment' when m.expense_id is not null then 'expense' else 'remittance' end) as target_kind,
  p.invoice_id,
  p.paid_on as payment_paid_on,
  p.amount_cents as payment_amount_cents,
  i.number as invoice_number,
  i.client_id,
  c.display_name as client_name,
  e.description as expense_description,
  e.vendor_id,
  v.name as vendor_name,
  e.category_id,
  cat.name as category_name,
  e.total_cents as expense_total_cents,
  r.collection_on as remittance_collection_on,
  r.status as remittance_status,
  mem.full_name as created_by_name
from public.bank_matches m
left join public.payments p on p.id = m.payment_id
left join public.invoices i on i.id = p.invoice_id
left join public.clients c on c.id = i.client_id
left join public.expenses e on e.id = m.expense_id
left join public.vendors v on v.id = e.vendor_id
left join public.expense_categories cat on cat.id = e.category_id
left join public.sepa_remittances r on r.id = m.remittance_id
left join public.members mem on mem.org_id = m.org_id and mem.user_id = m.created_by;

-- Extractos con sus saldos (los de cash_balances de esas fechas), lo que se ha movido en su periodo
-- (con todos los movimientos de la cuenta, vengan del extracto que vengan) y el descuadre:
-- saldo final − saldo inicial − movimientos. 0 = todo cuadra; otra cifra = faltan movimientos o
-- algún saldo se ha cambiado a mano.
create view public.bank_statements_overview with (security_invoker = true) as
select
  s.id,
  s.org_id,
  s.account_id,
  s.file_name,
  s.format,
  s.period_start,
  s.period_end,
  s.movements_in_file,
  s.created_at as imported_at,
  s.created_by as imported_by,
  mem.full_name as imported_by_name,
  coalesce(n.new_count, 0)::integer as new_count,
  ob.balance_cents as opening_balance_cents,
  cb.balance_cents as closing_balance_cents,
  coalesce(pm.period_cents, 0)::bigint as period_movements_cents,
  case
    when ob.balance_cents is not null and cb.balance_cents is not null
      then (cb.balance_cents - ob.balance_cents - coalesce(pm.period_cents, 0))::bigint
  end as balance_gap_cents
from public.bank_statements s
left join public.members mem on mem.org_id = s.org_id and mem.user_id = s.created_by
left join lateral (
  select count(*) as new_count from public.bank_transactions t where t.statement_id = s.id
) n on true
left join public.cash_balances ob on ob.account_id = s.account_id and ob.balance_on = s.period_start - 1
left join public.cash_balances cb on cb.account_id = s.account_id and cb.balance_on = s.period_end
left join lateral (
  select sum(t.amount_cents) as period_cents
  from public.bank_transactions t
  where t.account_id = s.account_id and t.booked_on between s.period_start and s.period_end
) pm on true;

revoke all on public.bank_transactions_overview, public.bank_matches_overview, public.bank_statements_overview from anon;

-- ---------------------------------------------------------------------------
-- Funciones auxiliares de las RPC
-- ---------------------------------------------------------------------------

-- Bloquea un movimiento y comprueba que quien llama es socio de su org.
create function private.bank_lock_transaction(p_transaction_id uuid) returns public.bank_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.bank_transactions;
begin
  select * into v_tx from public.bank_transactions where id = p_transaction_id for update;
  if not found or not private.has_role(v_tx.org_id, 'partner') then
    raise exception 'Sin permiso sobre este movimiento' using errcode = '42501';
  end if;
  return v_tx;
end;
$$;

-- Guarda (o actualiza) la regla que se aprende al confirmar.
--   r: { direction, field, pattern, vendor_id?, category_id?, client_id? }
create function private.bank_learn_rule(p_org uuid, r jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if r is null or jsonb_typeof(r) <> 'object' then
    return;
  end if;
  insert into public.bank_rules (org_id, direction, field, pattern, vendor_id, category_id, client_id)
  values (
    p_org,
    (r ->> 'direction')::public.bank_direction,
    (r ->> 'field')::public.bank_rule_field,
    r ->> 'pattern',
    nullif(r ->> 'vendor_id', '')::uuid,
    nullif(r ->> 'category_id', '')::uuid,
    nullif(r ->> 'client_id', '')::uuid
  )
  on conflict (org_id, direction, field, pattern) do update set
    vendor_id = excluded.vendor_id,
    category_id = excluded.category_id,
    client_id = excluded.client_id
  where (public.bank_rules.vendor_id, public.bank_rules.category_id, public.bank_rules.client_id)
        is distinct from (excluded.vendor_id, excluded.category_id, excluded.client_id);
end;
$$;

revoke all on function private.bank_lock_transaction(uuid) from public;
revoke all on function private.bank_learn_rule(uuid, jsonb) from public;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Importa un extracto ya leído por TS: el extracto, sus movimientos nuevos (los que ya estaban por
-- otro extracto se saltan por su huella) y sus saldos en la caja de la cuenta. El saldo inicial se
-- apunta el día anterior al periodo si ese día no tenía ya uno; el final, el último día (el del
-- banco sustituye al que hubiera). Devuelve cuántos movimientos son nuevos y los saldos que ya
-- había, para comprobarlos.
--   p: { account_id, file_name, file_hash, format, period_start, period_end, balance_note?,
--        opening_balance_cents?, closing_balance_cents?,
--        transactions: [{ position, booked_on, value_on?, amount_cents, concept?, counterparty?,
--                         counterparty_iban?, reference?, bank_code?, balance_after_cents?, fingerprint }] }
create function public.bank_import_statement(p jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.cash_accounts;
  v_start date := nullif(p ->> 'period_start', '')::date;
  v_end date := nullif(p ->> 'period_end', '')::date;
  v_opening bigint := nullif(p ->> 'opening_balance_cents', '')::bigint;
  v_closing bigint := nullif(p ->> 'closing_balance_cents', '')::bigint;
  v_rows jsonb := coalesce(p -> 'transactions', '[]'::jsonb);
  v_note text := nullif(left(btrim(coalesce(p ->> 'balance_note', '')), 500), '');
  v_statement uuid;
  v_count integer;
  v_distinct integer;
  v_inserted integer := 0;
  v_opening_recorded bigint;
  v_closing_previous bigint;
begin
  select * into v_account from public.cash_accounts where id = nullif(p ->> 'account_id', '')::uuid;
  if not found or not private.has_role(v_account.org_id, 'partner') then
    raise exception 'Sin permiso sobre esta cuenta' using errcode = '42501';
  end if;
  if not v_account.is_active then
    raise exception 'Esta cuenta está cerrada' using errcode = 'P0001', hint = 'bank_account_inactive';
  end if;
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'Extracto no válido' using errcode = 'P0001', hint = 'bank_statement_invalid';
  end if;
  if v_start is null or v_end is null or v_end < v_start or v_end > private.org_today(v_account.org_id) then
    raise exception 'El periodo del extracto no es válido' using errcode = 'P0001', hint = 'bank_statement_period';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_rows) as x (booked_on date)
    where x.booked_on is null or x.booked_on < v_start or x.booked_on > v_end
  ) then
    raise exception 'Hay movimientos fuera del periodo del extracto' using errcode = 'P0001', hint = 'bank_statement_period';
  end if;
  select count(*), count(distinct x.fingerprint) into v_count, v_distinct
  from jsonb_to_recordset(v_rows) as x (fingerprint text);
  if v_count <> v_distinct then
    raise exception 'Dos movimientos del extracto tienen la misma huella' using errcode = 'P0001', hint = 'bank_statement_invalid';
  end if;

  -- Dos importaciones de la misma cuenta a la vez se ordenan: la segunda ve los movimientos de la primera.
  perform pg_advisory_xact_lock(hashtextextended('bank-import:' || v_account.id::text, 0));
  if exists (select 1 from public.bank_statements s where s.account_id = v_account.id and s.file_hash = p ->> 'file_hash') then
    raise exception 'Este extracto ya está importado en esta cuenta' using errcode = 'P0001', hint = 'bank_statement_duplicate';
  end if;

  insert into public.bank_statements (org_id, account_id, file_name, file_hash, format, period_start, period_end, movements_in_file)
  values (
    v_account.org_id, v_account.id, left(btrim(p ->> 'file_name'), 255), p ->> 'file_hash',
    (p ->> 'format')::public.bank_statement_format, v_start, v_end, v_count
  )
  returning id into v_statement;

  insert into public.bank_transactions (
    org_id, account_id, statement_id, position, booked_on, value_on, amount_cents, concept, counterparty,
    counterparty_iban, reference, bank_code, balance_after_cents, fingerprint
  )
  select
    v_account.org_id, v_account.id, v_statement, x.position, x.booked_on, x.value_on, x.amount_cents,
    left(coalesce(x.concept, ''), 1000), nullif(left(btrim(coalesce(x.counterparty, '')), 200), ''),
    nullif(x.counterparty_iban, ''), nullif(left(btrim(coalesce(x.reference, '')), 100), ''), nullif(x.bank_code, ''),
    x.balance_after_cents, x.fingerprint
  from jsonb_to_recordset(v_rows) as x (
    position integer, booked_on date, value_on date, amount_cents bigint, concept text, counterparty text,
    counterparty_iban text, reference text, bank_code text, balance_after_cents bigint, fingerprint text
  )
  order by x.position
  on conflict (account_id, fingerprint) do nothing;
  get diagnostics v_inserted = row_count;

  if v_opening is not null then
    insert into public.cash_balances (org_id, account_id, balance_on, balance_cents, source, note)
    values (v_account.org_id, v_account.id, v_start - 1, v_opening, 'import', v_note)
    on conflict (account_id, balance_on) do nothing;
    select b.balance_cents into v_opening_recorded
    from public.cash_balances b where b.account_id = v_account.id and b.balance_on = v_start - 1;
  end if;
  if v_closing is not null then
    select b.balance_cents into v_closing_previous
    from public.cash_balances b where b.account_id = v_account.id and b.balance_on = v_end;
    insert into public.cash_balances (org_id, account_id, balance_on, balance_cents, source, note)
    values (v_account.org_id, v_account.id, v_end, v_closing, 'import', v_note)
    on conflict (account_id, balance_on) do update set
      balance_cents = excluded.balance_cents,
      source = excluded.source,
      note = excluded.note
    where public.cash_balances.balance_cents is distinct from excluded.balance_cents;
  end if;

  return jsonb_build_object(
    'statement_id', v_statement,
    'inserted', v_inserted,
    'duplicates', v_count - v_inserted,
    'opening_recorded_cents', v_opening_recorded,
    'closing_previous_cents', v_closing_previous
  );
end;
$$;

-- Confirma lo que explica un movimiento, todo o nada. Cada reparto es una de estas cosas:
-- - invoice: crea el cobro de esa factura (con la fecha del movimiento) y lo enlaza. El importe no
--   puede superar lo que falta por cobrar de la factura.
-- - payment: enlaza un cobro ya registrado (a mano, desde una remesa o una devolución).
-- - expense: enlaza un gasto; si estaba pendiente y queda cubierto del todo, lo da por pagado.
-- - remittance: enlaza una remesa SEPA y, si aún no estaba cobrada, la cobra con la fecha del
--   movimiento (un cobro por recibo, con la misma RPC que la pantalla de remesas).
-- Con `rule`, guarda la regla aprendida. Devuelve los enlaces creados.
--   p: { transaction_id, allocations: [{ kind, id, amount_cents, method? }], rule? }
create function public.bank_apply(p jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.bank_transactions;
  a record;
  v_ids uuid[] := '{}';
  v_match uuid;
  v_payment uuid;
  v_invoice public.invoices;
  v_expense public.expenses;
  v_remittance public.sepa_remittances;
  v_method public.payment_method;
  v_covered bigint;
  v_settle boolean;
begin
  v_tx := private.bank_lock_transaction(nullif(p ->> 'transaction_id', '')::uuid);
  if exists (select 1 from public.bank_ignores i where i.transaction_id = v_tx.id) then
    raise exception 'Este movimiento está ignorado' using errcode = 'P0001', hint = 'bank_transaction_ignored';
  end if;
  if jsonb_typeof(p -> 'allocations') is distinct from 'array' or jsonb_array_length(p -> 'allocations') = 0 then
    raise exception 'No hay nada que conciliar' using errcode = 'P0001', hint = 'bank_allocation_invalid';
  end if;

  for a in
    select
      e.value ->> 'kind' as kind,
      nullif(e.value ->> 'id', '')::uuid as id,
      nullif(e.value ->> 'amount_cents', '')::bigint as amount_cents,
      nullif(e.value ->> 'method', '') as method
    from jsonb_array_elements(p -> 'allocations') with ordinality as e (value, n)
    order by e.n
  loop
    if a.id is null or a.amount_cents is null or a.amount_cents <= 0 then
      raise exception 'Reparto no válido' using errcode = 'P0001', hint = 'bank_allocation_invalid';
    end if;
    v_method := coalesce(a.method, 'transfer')::public.payment_method;

    if a.kind = 'invoice' then
      select * into v_invoice from public.invoices i where i.id = a.id and i.org_id = v_tx.org_id for update;
      if not found or v_invoice.lifecycle <> 'issued' or v_invoice.kind <> 'ordinary' then
        raise exception 'Solo se cobran facturas emitidas' using errcode = 'P0001', hint = 'bank_invoice_not_payable';
      end if;
      if v_tx.amount_cents < 0 then
        raise exception 'Un cargo no cobra una factura' using errcode = 'P0001', hint = 'bank_match_direction';
      end if;
      if a.amount_cents > private.invoice_outstanding(v_invoice.id) then
        raise exception 'El importe supera lo que falta por cobrar de la factura'
          using errcode = 'P0001', hint = 'bank_match_exceeds_outstanding';
      end if;
      insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method, reference)
      values (
        v_tx.org_id, v_invoice.id, a.amount_cents, v_tx.booked_on, v_method,
        coalesce(v_tx.reference, nullif(left(btrim(v_tx.concept), 140), ''))
      )
      returning id into v_payment;
      insert into public.bank_matches (org_id, transaction_id, amount_cents, payment_id, created_payment)
      values (v_tx.org_id, v_tx.id, a.amount_cents, v_payment, true)
      returning id into v_match;

    elsif a.kind = 'payment' then
      insert into public.bank_matches (org_id, transaction_id, amount_cents, payment_id)
      values (v_tx.org_id, v_tx.id, a.amount_cents, a.id)
      returning id into v_match;

    elsif a.kind = 'expense' then
      select * into v_expense from public.expenses e where e.id = a.id and e.org_id = v_tx.org_id for update;
      if not found then
        raise exception 'Gasto no encontrado' using errcode = 'P0002', hint = 'bank_allocation_invalid';
      end if;
      insert into public.bank_matches (org_id, transaction_id, amount_cents, expense_id)
      values (v_tx.org_id, v_tx.id, a.amount_cents, v_expense.id)
      returning id into v_match;
      if v_expense.paid_on is null then
        select coalesce(sum(m.amount_cents), 0) into v_covered from public.bank_matches m where m.expense_id = v_expense.id;
        if v_covered >= abs(v_expense.total_cents) then
          update public.expenses set
            paid_on = (
              select max(t.booked_on)
              from public.bank_matches m
              join public.bank_transactions t on t.id = m.transaction_id
              where m.expense_id = v_expense.id
            ),
            payment_method = coalesce(payment_method, v_method)
          where id = v_expense.id;
          update public.bank_matches set marked_paid = true where id = v_match;
        end if;
      end if;

    elsif a.kind = 'remittance' then
      select * into v_remittance from public.sepa_remittances r where r.id = a.id and r.org_id = v_tx.org_id for update;
      if not found or v_remittance.status = 'draft' then
        raise exception 'Esta remesa aún no se ha enviado al banco' using errcode = 'P0001', hint = 'bank_remittance_not_collectible';
      end if;
      -- El abono en el banco demuestra que se envió: si no se había marcado, se marca.
      if v_remittance.status = 'generated' then
        perform public.sepa_mark_sent(v_remittance.id);
      end if;
      v_settle := v_remittance.status <> 'settled';
      insert into public.bank_matches (org_id, transaction_id, amount_cents, remittance_id, settled_remittance)
      values (v_tx.org_id, v_tx.id, a.amount_cents, v_remittance.id, v_settle)
      returning id into v_match;
      if v_settle then
        perform public.sepa_settle_remittance(v_remittance.id, v_tx.booked_on);
      end if;

    else
      raise exception 'Reparto no válido' using errcode = 'P0001', hint = 'bank_allocation_invalid';
    end if;
    v_ids := v_ids || v_match;
  end loop;

  perform private.bank_learn_rule(v_tx.org_id, p -> 'rule');
  return jsonb_build_object('transaction_id', v_tx.id, 'match_ids', to_jsonb(v_ids));
end;
$$;

-- Crea un gasto desde un movimiento (pagado ese día) y lo enlaza, todo o nada. Los importes y la
-- validación los hace TS con los mismos esquemas y el mismo redondeo que Finanzas; el proveedor
-- escrito al vuelo se resuelve con su misma regla (el que ya exista con ese nombre, o uno nuevo con
-- la categoría del gasto como la suya).
--   p: { transaction_id, expense: { issuer_id, vendor_id?, new_vendor_name?, category_id, description,
--        vendor_invoice_number?, issued_on, due_on?, base_cents, vat_bps, vat_cents, vat_deductible,
--        irpf_bps, irpf_cents, total_cents, payment_method?, member_id?, notes? }, rule? }
create function public.bank_create_expense(p jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.bank_transactions;
  e jsonb := coalesce(p -> 'expense', '{}'::jsonb);
  v_vendor uuid := nullif(e ->> 'vendor_id', '')::uuid;
  v_new_vendor text := nullif(btrim(coalesce(e ->> 'new_vendor_name', '')), '');
  v_category uuid := nullif(e ->> 'category_id', '')::uuid;
  v_total bigint := nullif(e ->> 'total_cents', '')::bigint;
  v_expense uuid;
  v_match uuid;
begin
  v_tx := private.bank_lock_transaction(nullif(p ->> 'transaction_id', '')::uuid);
  if exists (select 1 from public.bank_ignores i where i.transaction_id = v_tx.id) then
    raise exception 'Este movimiento está ignorado' using errcode = 'P0001', hint = 'bank_transaction_ignored';
  end if;
  if v_total is null or v_total = 0 or sign(v_total) = sign(v_tx.amount_cents) then
    raise exception 'Un cargo crea un gasto y un abono, un abono de proveedor' using errcode = 'P0001', hint = 'bank_match_direction';
  end if;

  if v_vendor is null and v_new_vendor is not null then
    select v.id into v_vendor
    from public.vendors v
    where v.org_id = v_tx.org_id and v.archived_at is null and lower(v.name) = lower(v_new_vendor)
    order by v.created_at
    limit 1;
    if v_vendor is null then
      insert into public.vendors (org_id, name, default_category_id)
      values (v_tx.org_id, v_new_vendor, v_category)
      returning id into v_vendor;
    end if;
  end if;

  insert into public.expenses (
    org_id, issuer_id, vendor_id, category_id, description, vendor_invoice_number, issued_on, due_on,
    base_cents, vat_bps, vat_cents, vat_deductible, irpf_bps, irpf_cents, total_cents, paid_on,
    payment_method, member_id, source, notes
  )
  values (
    v_tx.org_id,
    nullif(e ->> 'issuer_id', '')::uuid,
    v_vendor,
    v_category,
    btrim(coalesce(e ->> 'description', '')),
    nullif(btrim(coalesce(e ->> 'vendor_invoice_number', '')), ''),
    nullif(e ->> 'issued_on', '')::date,
    nullif(e ->> 'due_on', '')::date,
    nullif(e ->> 'base_cents', '')::bigint,
    coalesce(nullif(e ->> 'vat_bps', '')::integer, 0),
    coalesce(nullif(e ->> 'vat_cents', '')::bigint, 0),
    coalesce(nullif(e ->> 'vat_deductible', '')::boolean, true),
    coalesce(nullif(e ->> 'irpf_bps', '')::integer, 0),
    coalesce(nullif(e ->> 'irpf_cents', '')::bigint, 0),
    v_total,
    v_tx.booked_on,
    coalesce(nullif(e ->> 'payment_method', ''), 'transfer')::public.payment_method,
    nullif(e ->> 'member_id', '')::uuid,
    'import',
    nullif(btrim(coalesce(e ->> 'notes', '')), '')
  )
  returning id into v_expense;

  insert into public.bank_matches (org_id, transaction_id, amount_cents, expense_id, created_expense)
  values (v_tx.org_id, v_tx.id, abs(v_total), v_expense, true)
  returning id into v_match;

  perform private.bank_learn_rule(v_tx.org_id, p -> 'rule');
  return jsonb_build_object('transaction_id', v_tx.id, 'expense_id', v_expense, 'match_id', v_match, 'vendor_id', v_vendor);
end;
$$;

-- Deshace un enlace. Si la confirmación creó el cobro o el gasto, lo borra (y devuelve la ruta del
-- justificante para que el servidor lo quite de Storage); si dio por pagado un gasto que ya no
-- queda cubierto, lo vuelve a dejar pendiente. Una remesa cobrada sigue cobrada.
create function public.bank_undo_match(p_match_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.bank_matches;
  v_tx public.bank_transactions;
  v_expense public.expenses;
  v_covered bigint;
  v_attachment text;
  v_invoice uuid;
  v_deleted_payment boolean := false;
  v_deleted_expense boolean := false;
  v_unpaid boolean := false;
begin
  select * into v_match from public.bank_matches where id = p_match_id;
  if not found then
    raise exception 'Enlace no encontrado' using errcode = 'P0002', hint = 'bank_match_not_found';
  end if;
  v_tx := private.bank_lock_transaction(v_match.transaction_id);
  select * into v_match from public.bank_matches where id = p_match_id for update;
  if not found then
    raise exception 'Enlace no encontrado' using errcode = 'P0002', hint = 'bank_match_not_found';
  end if;
  select pm.invoice_id into v_invoice from public.payments pm where pm.id = v_match.payment_id;

  delete from public.bank_matches where id = v_match.id;

  if v_match.created_payment then
    delete from public.payments pm
    where pm.id = v_match.payment_id
      and not exists (select 1 from public.bank_matches m where m.payment_id = pm.id);
    v_deleted_payment := found;
  end if;

  if v_match.expense_id is not null then
    select * into v_expense from public.expenses where id = v_match.expense_id for update;
    if found and v_match.created_expense then
      if not exists (select 1 from public.bank_matches m where m.expense_id = v_expense.id) then
        v_attachment := v_expense.attachment_path;
        delete from public.expenses where id = v_expense.id;
        v_deleted_expense := true;
      end if;
    elsif found and v_expense.paid_on is not null then
      select coalesce(sum(m.amount_cents), 0) into v_covered from public.bank_matches m where m.expense_id = v_expense.id;
      if v_covered < abs(v_expense.total_cents)
         and (v_match.marked_paid or exists (select 1 from public.bank_matches m where m.expense_id = v_expense.id and m.marked_paid)) then
        update public.expenses set paid_on = null where id = v_expense.id;
        update public.bank_matches set marked_paid = false where expense_id = v_expense.id and marked_paid;
        v_unpaid := true;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'transaction_id', v_tx.id,
    'deleted_payment', v_deleted_payment,
    'deleted_expense', v_deleted_expense,
    'expense_unpaid', v_unpaid,
    'remittance_kept_settled', v_match.settled_remittance,
    'attachment_path', v_attachment,
    'invoice_id', v_invoice
  );
end;
$$;

-- Ignora un movimiento con su motivo (o cambia el motivo), y lo vuelve a tener en cuenta.
create function public.bank_ignore(p_transaction_id uuid, p_reason public.bank_ignore_reason, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.bank_transactions;
begin
  v_tx := private.bank_lock_transaction(p_transaction_id);
  insert into public.bank_ignores (org_id, transaction_id, reason, note)
  values (v_tx.org_id, v_tx.id, p_reason, nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  on conflict (transaction_id) do update set reason = excluded.reason, note = excluded.note;
end;
$$;

create function public.bank_unignore(p_transaction_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.bank_transactions;
begin
  v_tx := private.bank_lock_transaction(p_transaction_id);
  delete from public.bank_ignores where transaction_id = v_tx.id;
end;
$$;

-- Borra un extracto y los movimientos que trajo, si ninguno está conciliado ni ignorado. Los saldos
-- que apuntó en la caja se quedan (son saldos del banco). Devuelve cuántos movimientos borra.
create function public.bank_delete_statement(p_statement_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statement public.bank_statements;
  v_count integer;
begin
  select * into v_statement from public.bank_statements where id = p_statement_id for update;
  if not found or not private.has_role(v_statement.org_id, 'partner') then
    raise exception 'Sin permiso sobre este extracto' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bank-import:' || v_statement.account_id::text, 0));
  if exists (
    select 1 from public.bank_transactions t
    where t.statement_id = v_statement.id
      and (exists (select 1 from public.bank_matches m where m.transaction_id = t.id)
           or exists (select 1 from public.bank_ignores i where i.transaction_id = t.id))
  ) then
    raise exception 'Este extracto tiene movimientos conciliados o ignorados: deshazlos antes de borrarlo'
      using errcode = 'P0001', hint = 'bank_statement_in_use';
  end if;
  select count(*) into v_count from public.bank_transactions t where t.statement_id = v_statement.id;
  delete from public.bank_statements where id = v_statement.id;
  return v_count;
end;
$$;

revoke all on function public.bank_import_statement(jsonb) from public, anon;
revoke all on function public.bank_apply(jsonb) from public, anon;
revoke all on function public.bank_create_expense(jsonb) from public, anon;
revoke all on function public.bank_undo_match(uuid) from public, anon;
revoke all on function public.bank_ignore(uuid, public.bank_ignore_reason, text) from public, anon;
revoke all on function public.bank_unignore(uuid) from public, anon;
revoke all on function public.bank_delete_statement(uuid) from public, anon;
grant execute on function public.bank_import_statement(jsonb) to authenticated;
grant execute on function public.bank_apply(jsonb) to authenticated;
grant execute on function public.bank_create_expense(jsonb) to authenticated;
grant execute on function public.bank_undo_match(uuid) to authenticated;
grant execute on function public.bank_ignore(uuid, public.bank_ignore_reason, text) to authenticated;
grant execute on function public.bank_unignore(uuid) to authenticated;
grant execute on function public.bank_delete_statement(uuid) to authenticated;

revoke all on all tables in schema public from anon;
