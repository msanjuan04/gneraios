-- Cada hecho de caja se asigna a la cuenta bancaria que lo respalda. NULL conserva
-- explícitamente históricos o métodos que todavía no se han conciliado.
alter table public.payments add column cash_account_id uuid;
alter table public.payments add constraint payments_cash_account_fk
  foreign key (org_id, cash_account_id) references public.cash_accounts (org_id, id);
alter table public.expenses add column cash_account_id uuid;
alter table public.expenses add constraint expenses_cash_account_fk
  foreign key (org_id, cash_account_id) references public.cash_accounts (org_id, id);
alter table public.client_receipts add column issuer_id uuid;
alter table public.client_receipts add column cash_account_id uuid;
alter table public.client_receipts add constraint client_receipts_issuer_fk
  foreign key (org_id, issuer_id) references public.issuers (org_id, id);
alter table public.client_receipts add constraint client_receipts_cash_account_fk
  foreign key (org_id, cash_account_id) references public.cash_accounts (org_id, id);

create function private.cash_movement_account_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_account public.cash_accounts;
  v_issuer uuid;
begin
  if new.cash_account_id is null then return new; end if;
  select * into v_account from public.cash_accounts where id = new.cash_account_id and org_id = new.org_id;
  if not found or not v_account.is_active then
    raise exception 'La cuenta de caja no está activa en esta organización' using errcode = 'P0001', hint = 'cash_account_invalid';
  end if;
  if tg_table_name = 'payments' then
    select i.issuer_id into v_issuer from public.invoices i where i.id = new.invoice_id and i.org_id = new.org_id;
  elsif tg_table_name = 'expenses' then
    v_issuer := new.issuer_id;
  else
    -- Cobro sin factura: si no trae emisor, es el dueño de la cuenta que lo recibe (nunca se adivina).
    v_issuer := new.issuer_id;
    if v_issuer is null then
      v_issuer := v_account.issuer_id;
      new.issuer_id := v_issuer;
    end if;
  end if;
  if v_issuer is not null and v_account.issuer_id <> v_issuer then
    raise exception 'La cuenta pertenece a otro emisor' using errcode = 'P0001', hint = 'cash_account_issuer_mismatch';
  end if;
  return new;
end;
$$;

create trigger payments_cash_account_guard before insert or update of cash_account_id on public.payments
  for each row execute function private.cash_movement_account_guard();
create trigger expenses_cash_account_guard before insert or update of cash_account_id on public.expenses
  for each row execute function private.cash_movement_account_guard();
create trigger client_receipts_cash_account_guard before insert or update of cash_account_id on public.client_receipts
  for each row execute function private.cash_movement_account_guard();

create or replace function public.bank_create_expense(p jsonb) returns jsonb
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
  v_issuer uuid;
begin
  v_tx := private.bank_lock_transaction(nullif(p ->> 'transaction_id', '')::uuid);
  if exists (select 1 from public.bank_ignores i where i.transaction_id = v_tx.id) then raise exception 'Este movimiento está ignorado' using errcode = 'P0001', hint = 'bank_transaction_ignored'; end if;
  if v_total is null or v_total = 0 or sign(v_total) = sign(v_tx.amount_cents) then raise exception 'Un cargo crea un gasto y un abono, un abono de proveedor' using errcode = 'P0001', hint = 'bank_match_direction'; end if;
  if v_vendor is null and v_new_vendor is not null then
    select id into v_vendor from public.vendors where org_id = v_tx.org_id and archived_at is null and lower(name) = lower(v_new_vendor) order by created_at limit 1;
    if v_vendor is null then insert into public.vendors (org_id, name, default_category_id) values (v_tx.org_id, v_new_vendor, v_category) returning id into v_vendor; end if;
  end if;
  v_issuer := nullif(e ->> 'issuer_id', '')::uuid;
  if v_issuer is null then select issuer_id into v_issuer from public.cash_accounts where id = v_tx.account_id and org_id = v_tx.org_id; end if;
  insert into public.expenses (org_id, issuer_id, vendor_id, category_id, description, vendor_invoice_number, issued_on, due_on,
    base_cents, vat_bps, vat_cents, vat_deductible, irpf_bps, irpf_cents, total_cents, paid_on, payment_method, member_id, source, notes, cash_account_id)
  values (v_tx.org_id, v_issuer, v_vendor, v_category, btrim(coalesce(e ->> 'description', '')),
    nullif(btrim(coalesce(e ->> 'vendor_invoice_number', '')), ''), nullif(e ->> 'issued_on', '')::date, nullif(e ->> 'due_on', '')::date,
    nullif(e ->> 'base_cents', '')::bigint, coalesce(nullif(e ->> 'vat_bps', '')::integer, 0), coalesce(nullif(e ->> 'vat_cents', '')::bigint, 0),
    coalesce(nullif(e ->> 'vat_deductible', '')::boolean, true), coalesce(nullif(e ->> 'irpf_bps', '')::integer, 0), coalesce(nullif(e ->> 'irpf_cents', '')::bigint, 0),
    v_total, v_tx.booked_on, coalesce(nullif(e ->> 'payment_method', ''), 'transfer')::public.payment_method, nullif(e ->> 'member_id', '')::uuid,
    'import', nullif(btrim(coalesce(e ->> 'notes', '')), ''), v_tx.account_id)
  returning id into v_expense;
  insert into public.bank_matches (org_id, transaction_id, amount_cents, expense_id, created_expense)
  values (v_tx.org_id, v_tx.id, abs(v_total), v_expense, true) returning id into v_match;
  perform private.bank_learn_rule(v_tx.org_id, p -> 'rule');
  return jsonb_build_object('transaction_id', v_tx.id, 'expense_id', v_expense, 'match_id', v_match, 'vendor_id', v_vendor);
end;
$$;

create or replace function public.bank_apply(p jsonb) returns jsonb
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
begin
  v_tx := private.bank_lock_transaction(nullif(p ->> 'transaction_id', '')::uuid);
  if exists (select 1 from public.bank_ignores i where i.transaction_id = v_tx.id) then
    raise exception 'Este movimiento está ignorado' using errcode = 'P0001', hint = 'bank_transaction_ignored';
  end if;
  if jsonb_typeof(p -> 'allocations') is distinct from 'array' or jsonb_array_length(p -> 'allocations') = 0 then
    raise exception 'No hay nada que conciliar' using errcode = 'P0001', hint = 'bank_allocation_invalid';
  end if;
  for a in
    select e.value ->> 'kind' as kind, nullif(e.value ->> 'id', '')::uuid as id,
      nullif(e.value ->> 'amount_cents', '')::bigint as amount_cents, nullif(e.value ->> 'method', '') as method
    from jsonb_array_elements(p -> 'allocations') with ordinality as e (value, n) order by e.n
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
      if v_tx.amount_cents < 0 then raise exception 'Un cargo no cobra una factura' using errcode = 'P0001', hint = 'bank_match_direction'; end if;
      if a.amount_cents > private.invoice_outstanding(v_invoice.id) then
        raise exception 'El importe supera lo que falta por cobrar de la factura' using errcode = 'P0001', hint = 'bank_match_exceeds_outstanding';
      end if;
      insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method, reference, cash_account_id)
      values (v_tx.org_id, v_invoice.id, a.amount_cents, v_tx.booked_on, v_method,
        coalesce(v_tx.reference, nullif(left(btrim(v_tx.concept), 140), '')), v_tx.account_id)
      returning id into v_payment;
      insert into public.bank_matches (org_id, transaction_id, amount_cents, payment_id, created_payment)
      values (v_tx.org_id, v_tx.id, a.amount_cents, v_payment, true) returning id into v_match;
    elsif a.kind = 'payment' then
      update public.payments set cash_account_id = v_tx.account_id where id = a.id and org_id = v_tx.org_id and (cash_account_id is null or cash_account_id = v_tx.account_id);
      if not found then raise exception 'Cobro no encontrado' using errcode = 'P0002', hint = 'bank_allocation_invalid'; end if;
      insert into public.bank_matches (org_id, transaction_id, amount_cents, payment_id)
      values (v_tx.org_id, v_tx.id, a.amount_cents, a.id) returning id into v_match;
    elsif a.kind = 'expense' then
      select * into v_expense from public.expenses e where e.id = a.id and e.org_id = v_tx.org_id for update;
      if not found then raise exception 'Gasto no encontrado' using errcode = 'P0002', hint = 'bank_allocation_invalid'; end if;
      update public.expenses set cash_account_id = v_tx.account_id where id = v_expense.id and (cash_account_id is null or cash_account_id = v_tx.account_id);
      if not found then raise exception 'El gasto ya está asignado a otra cuenta' using errcode = 'P0001', hint = 'cash_account_mismatch'; end if;
      insert into public.bank_matches (org_id, transaction_id, amount_cents, expense_id)
      values (v_tx.org_id, v_tx.id, a.amount_cents, v_expense.id) returning id into v_match;
      if v_expense.paid_on is null then
        select coalesce(sum(m.amount_cents), 0) into v_covered from public.bank_matches m where m.expense_id = v_expense.id;
        if v_covered >= abs(v_expense.total_cents) then
          update public.expenses set paid_on = (select max(t.booked_on) from public.bank_matches m join public.bank_transactions t on t.id = m.transaction_id where m.expense_id = v_expense.id),
            payment_method = coalesce(payment_method, v_method) where id = v_expense.id;
          update public.bank_matches set marked_paid = true where id = v_match;
        end if;
      end if;
    elsif a.kind = 'remittance' then
      select * into v_remittance from public.sepa_remittances r where r.id = a.id and r.org_id = v_tx.org_id for update;
      if not found or v_remittance.status = 'draft' then raise exception 'Esta remesa aún no se ha enviado al banco' using errcode = 'P0001', hint = 'bank_remittance_not_collectible'; end if;
      if v_remittance.status = 'generated' then perform public.sepa_mark_sent(v_remittance.id); end if;
      insert into public.bank_matches (org_id, transaction_id, amount_cents, remittance_id, settled_remittance)
      values (v_tx.org_id, v_tx.id, a.amount_cents, v_remittance.id, v_remittance.status <> 'settled') returning id into v_match;
      if v_remittance.status <> 'settled' then perform public.sepa_settle_remittance(v_remittance.id, v_tx.booked_on); end if;
    else
      raise exception 'Tipo de reparto desconocido' using errcode = 'P0001', hint = 'bank_allocation_invalid';
    end if;
    v_ids := v_ids || v_match;
  end loop;
  if p ? 'rule' then perform private.bank_learn_rule(v_tx.org_id, p -> 'rule'); end if;
  return jsonb_build_object('match_ids', to_jsonb(v_ids));
end;
$$;

create or replace function public.sepa_settle_remittance(p_remittance_id uuid, p_settled_on date) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.sepa_remittances;
  v_count integer := 0;
  it record;
  v_payment uuid;
  v_cash_account uuid;
  v_prev_remittance_id uuid;
begin
  select * into v_r from public.sepa_remittances where id = p_remittance_id for update;
  if not found or not private.has_role(v_r.org_id, 'partner') then raise exception 'Sin permiso sobre esta remesa' using errcode = '42501'; end if;
  if v_r.status = 'settled' then return 0; end if;
  if v_r.status <> 'sent' then raise exception 'Solo se cobra una remesa enviada al banco' using errcode = 'P0001', hint = 'remittance_not_sent'; end if;
  if p_settled_on is null or p_settled_on > private.org_today(v_r.org_id) then raise exception 'La fecha de abono no puede ser futura' using errcode = 'P0001', hint = 'settle_date_invalid'; end if;
  select m.id into v_prev_remittance_id from public.bank_matches m where m.remittance_id = v_r.id and m.settled_remittance order by m.created_at desc limit 1;
  if v_prev_remittance_id is not null then
    select t.account_id into v_cash_account from public.bank_matches m join public.bank_transactions t on t.id = m.transaction_id where m.id = v_prev_remittance_id;
  end if;
  update public.sepa_remittances set status = 'settled', settled_on = p_settled_on, settled_at = now() where id = v_r.id;
  for it in select i.id, i.invoice_id, i.amount_cents, i.end_to_end_id from public.sepa_remittance_items i
    where i.remittance_id = v_r.id and i.returned_on is null and i.payment_id is null order by i.created_at, i.id for update
  loop
    insert into public.payments (org_id, invoice_id, amount_cents, paid_on, method, reference, cash_account_id)
    values (v_r.org_id, it.invoice_id, it.amount_cents, p_settled_on, 'sepa_debit', it.end_to_end_id, v_cash_account)
    returning id into v_payment;
    update public.sepa_remittance_items set payment_id = v_payment where id = it.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.bank_undo_match(p_match_id uuid) returns jsonb
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
  if not found then raise exception 'Enlace no encontrado' using errcode = 'P0002', hint = 'bank_match_not_found'; end if;
  v_tx := private.bank_lock_transaction(v_match.transaction_id);
  select * into v_match from public.bank_matches where id = p_match_id for update;
  if not found then raise exception 'Enlace no encontrado' using errcode = 'P0002', hint = 'bank_match_not_found'; end if;
  select pm.invoice_id into v_invoice from public.payments pm where pm.id = v_match.payment_id;
  delete from public.bank_matches where id = v_match.id;
  if v_match.created_payment then
    delete from public.payments pm where pm.id = v_match.payment_id and not exists (select 1 from public.bank_matches m where m.payment_id = pm.id);
    v_deleted_payment := found;
  elsif v_match.payment_id is not null then
    update public.payments set cash_account_id = null where id = v_match.payment_id and not exists (select 1 from public.bank_matches m where m.payment_id = v_match.payment_id);
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
      if v_covered < abs(v_expense.total_cents) and (v_match.marked_paid or exists (select 1 from public.bank_matches m where m.expense_id = v_expense.id and m.marked_paid)) then
        update public.expenses set paid_on = null, cash_account_id = null where id = v_expense.id;
        update public.bank_matches set marked_paid = false where expense_id = v_expense.id and marked_paid;
        v_unpaid := true;
      elsif not exists (select 1 from public.bank_matches m where m.expense_id = v_expense.id) then
        update public.expenses set cash_account_id = null where id = v_expense.id;
      end if;
    end if;
  end if;
  return jsonb_build_object('transaction_id', v_tx.id, 'deleted_payment', v_deleted_payment, 'deleted_expense', v_deleted_expense,
    'expense_unpaid', v_unpaid, 'remittance_kept_settled', v_match.settled_remittance, 'attachment_path', v_attachment, 'invoice_id', v_invoice);
end;
$$;


revoke all on function public.bank_apply(jsonb) from public, anon;
revoke all on function public.bank_create_expense(jsonb) from public, anon;
revoke all on function public.bank_undo_match(uuid) from public, anon;
revoke all on function public.sepa_settle_remittance(uuid, date) from public, anon;
grant execute on function public.bank_apply(jsonb) to authenticated;
grant execute on function public.bank_create_expense(jsonb) to authenticated;
grant execute on function public.bank_undo_match(uuid) to authenticated;
grant execute on function public.sepa_settle_remittance(uuid, date) to authenticated;
