-- GNERAI OS · Catálogo de servicios
-- Los servicios que se presupuestan una y otra vez (web corporativa, SEO mensual, gestión de Meta
-- Ads…) con su precio base, su tipo de facturación, su IVA y su texto en castellano, catalán e
-- inglés; y packs de servicios con un descuento. Elegir uno en un presupuesto, un contrato o una
-- factura trae las líneas hechas, en el idioma del cliente. Ver ARCHITECTURE.md §6.3 (fase 3,
-- «services») y src/domain/catalog.
--
-- Reparto de responsabilidades:
-- - Las líneas que salen del catálogo las arma TS (src/domain/catalog) y sus importes salen de la
--   única implementación del redondeo (src/domain/tax). El descuento de un pack va en cada una de
--   sus líneas (discount_bps), así que se redondea línea a línea, como cualquier otro descuento.
-- - El catálogo es una plantilla, no una referencia: una línea de presupuesto, contrato o factura
--   copia lo que trae al elegirlo y después se edita. Cambiar un precio aquí no toca nada de lo
--   ya presupuestado, contratado o facturado.
-- - Aquí vive la forma de los datos (textos y traducciones incluidos), el IVA de la org y la RLS:
--   lo lee cualquier miembro y lo cambia un socio. Los servicios y los packs no se borran: se
--   archivan (is_active = false) y dejan de proponerse.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- En el orden en que se listan. Las etiquetas salen de i18n (catalog.categories).
create type public.catalog_category as enum (
  'web', 'seo', 'ads', 'branding', 'social', 'hosting', 'maintenance', 'consulting', 'other'
);

-- ---------------------------------------------------------------------------
-- Validación de textos y traducciones (las usan los check de las tablas)
-- ---------------------------------------------------------------------------

-- Un texto del catálogo: de 1 a p_max caracteres, sin espacios en los extremos y sin saltos de
-- línea ni otros caracteres de control (acaba en la descripción de una línea, que es de una sola
-- línea). Gemela de catalogTextError (src/domain/catalog/text.ts).
create function private.catalog_text_ok(p_text text, p_max integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null
     and char_length(p_text) between 1 and p_max
     and p_text = btrim(p_text)
     and p_text !~ '[[:cntrl:]]'
$$;

-- Traducciones de un servicio o de un pack: {"ca": {"name": …, "description": …}, "en": {…}}.
-- El castellano es el nombre y la descripción de la propia fila: aquí solo van el catalán y el
-- inglés, cada uno con su nombre, su descripción o los dos. Lo que no se traduce no se escribe
-- (ni textos vacíos ni idiomas vacíos): al elegirlo sale en castellano. Gemela de
-- translationsError (src/domain/catalog/text.ts).
create function private.catalog_translations_ok(p jsonb, p_name_max integer, p_description_max integer) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_locale text;
  v_entry jsonb;
  v_field text;
  v_value jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  for v_locale, v_entry in select e.key, e.value from jsonb_each(p) as e loop
    if v_locale not in ('ca', 'en') or jsonb_typeof(v_entry) <> 'object' or v_entry = '{}'::jsonb then
      return false;
    end if;
    for v_field, v_value in select f.key, f.value from jsonb_each(v_entry) as f loop
      if v_field not in ('name', 'description')
         or jsonb_typeof(v_value) <> 'string'
         or not private.catalog_text_ok(
           v_value #>> '{}',
           case v_field when 'name' then p_name_max else p_description_max end
         ) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

-- Las comprueban los check, así que las ejecuta quien escribe: la app (authenticated) y el
-- servidor (service_role).
revoke all on function private.catalog_text_ok(text, integer) from public;
revoke all on function private.catalog_translations_ok(jsonb, integer, integer) from public;
grant execute on function private.catalog_text_ok(text, integer) to authenticated, service_role;
grant execute on function private.catalog_translations_ok(jsonb, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Servicios
-- ---------------------------------------------------------------------------
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  category public.catalog_category not null default 'other',
  -- En castellano. El catalán y el inglés, en translations.
  name text not null,
  description text,
  translations jsonb not null default '{}'::jsonb,
  -- El mismo tipo que las líneas de presupuesto, contrato y factura. Si es recurrente (mensual o
  -- anual), puntual o por uso, y cada cuánto se cobra, se deriva de aquí: no se guarda aparte.
  billing_type public.billing_type not null,
  -- Unidad del precio ("hora", "campaña", "página"): acompaña al precio en el catálogo y en el
  -- selector. Las líneas no tienen unidad, así que no viaja a ellas.
  unit_label text,
  -- Sin IVA: el de una unidad (el de un ciclo en las recurrentes, el de un uso en las de uso).
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  default_quantity numeric(12, 3) not null default 1 check (default_quantity > 0),
  tax_rate_id uuid not null,
  -- Sujeto a IRPF cuando la factura lo lleve (el tipo es el de cada factura).
  irpf_applies boolean not null default true,
  -- Archivado: deja de proponerse. Lo ya presupuestado no cambia.
  is_active boolean not null default true,
  -- Orden dentro de su categoría.
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  foreign key (org_id, tax_rate_id) references public.tax_rates (org_id, id),
  -- Nombre + " — " + descripción es la descripción de la línea: cabe en sus 500 caracteres.
  constraint catalog_items_name_check check (private.catalog_text_ok(name, 120)),
  constraint catalog_items_description_check check (description is null or private.catalog_text_ok(description, 375)),
  constraint catalog_items_unit_label_check check (unit_label is null or private.catalog_text_ok(unit_label, 30)),
  constraint catalog_items_translations_check check (private.catalog_translations_ok(translations, 120, 375))
);
create index catalog_items_org_idx on public.catalog_items (org_id, category, position);
create index catalog_items_tax_rate_idx on public.catalog_items (tax_rate_id);
-- El mismo servicio dos veces es el mismo servicio escrito dos veces.
create unique index catalog_items_name_idx on public.catalog_items (org_id, lower(name)) where is_active;

-- ---------------------------------------------------------------------------
-- Packs
-- ---------------------------------------------------------------------------
create table public.catalog_bundles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  name text not null,
  description text,
  translations jsonb not null default '{}'::jsonb,
  -- Descuento del pack: va en cada una de sus líneas, que lo redondean como cualquier otro.
  discount_bps integer not null default 0 check (discount_bps between 0 and 10000),
  is_active boolean not null default true,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  constraint catalog_bundles_name_check check (private.catalog_text_ok(name, 120)),
  constraint catalog_bundles_description_check check (description is null or private.catalog_text_ok(description, 375)),
  constraint catalog_bundles_translations_check check (private.catalog_translations_ok(translations, 120, 375))
);
create index catalog_bundles_org_idx on public.catalog_bundles (org_id, position);
create unique index catalog_bundles_name_idx on public.catalog_bundles (org_id, lower(name)) where is_active;

-- Los servicios de un pack, en su orden. Se guardan como conjunto completo (save_catalog_bundle).
create table public.catalog_bundle_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete restrict,
  bundle_id uuid not null,
  item_id uuid not null,
  -- Vacía: la cantidad por defecto del servicio (así no se copia).
  quantity numeric(12, 3) check (quantity is null or quantity > 0),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  unique (org_id, id),
  -- Un servicio va una vez en cada pack: para más, se sube su cantidad.
  unique (bundle_id, item_id),
  foreign key (org_id, bundle_id) references public.catalog_bundles (org_id, id) on delete cascade,
  foreign key (org_id, item_id) references public.catalog_items (org_id, id)
);
create index catalog_bundle_items_bundle_idx on public.catalog_bundle_items (bundle_id, position);
create index catalog_bundle_items_item_idx on public.catalog_bundle_items (item_id);

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------

-- Un servicio no cambia de org. Su impuesto tiene que ser un tipo de IVA (no una retención) y, al
-- elegirlo, uno vigente: si luego se archiva, el servicio lo conserva y el selector propone el
-- IVA por defecto (resolveVatRateId). Un id que no existe o de otra org lo para la FK.
create function private.catalog_items_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.tax_kind;
  v_archived_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'Un servicio del catálogo no cambia de organización' using errcode = 'P0001', hint = 'catalog_org_fixed';
  end if;
  if tg_op = 'UPDATE' and new.tax_rate_id = old.tax_rate_id then
    return new;
  end if;
  select t.kind, t.archived_at into v_kind, v_archived_at from public.tax_rates t where t.id = new.tax_rate_id;
  if found and v_kind <> 'vat' then
    raise exception 'El impuesto de un servicio tiene que ser un tipo de IVA' using errcode = 'P0001', hint = 'vat_rate_required';
  end if;
  if found and v_archived_at is not null then
    raise exception 'Ese tipo de IVA está archivado' using errcode = 'P0001', hint = 'vat_rate_archived';
  end if;
  return new;
end;
$$;

create trigger catalog_items_guard before insert or update on public.catalog_items
  for each row execute function private.catalog_items_guard();

-- Un pack (o un servicio de un pack) tampoco cambia de org ni de pack.
create function private.catalog_bundles_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id <> old.org_id then
    raise exception 'Un pack del catálogo no cambia de organización' using errcode = 'P0001', hint = 'catalog_org_fixed';
  end if;
  -- Anidado: `bundle_id` solo existe en catalog_bundle_items.
  if tg_table_name = 'catalog_bundle_items' then
    if new.bundle_id <> old.bundle_id then
      raise exception 'Un servicio no se mueve de un pack a otro' using errcode = 'P0001', hint = 'catalog_org_fixed';
    end if;
  end if;
  return new;
end;
$$;

create trigger catalog_bundles_guard before update on public.catalog_bundles
  for each row execute function private.catalog_bundles_guard();
create trigger catalog_bundle_items_guard before update on public.catalog_bundle_items
  for each row execute function private.catalog_bundles_guard();

-- ---------------------------------------------------------------------------
-- Triggers comunes
-- ---------------------------------------------------------------------------
create trigger set_updated_at before update on public.catalog_items for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.catalog_bundles for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.catalog_bundle_items for each row execute function private.set_updated_at();

create trigger audit after insert or update or delete on public.catalog_items for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.catalog_bundles for each row execute function private.audit_row();
create trigger audit after insert or update or delete on public.catalog_bundle_items for each row execute function private.audit_row();

-- ---------------------------------------------------------------------------
-- RLS y privilegios
-- ---------------------------------------------------------------------------
alter table public.catalog_items enable row level security;
alter table public.catalog_bundles enable row level security;
alter table public.catalog_bundle_items enable row level security;

-- Lo ve cualquier miembro y lo cambia un socio. Los servicios y los packs no se borran: se archivan.
create policy catalog_items_select on public.catalog_items for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy catalog_items_insert on public.catalog_items for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy catalog_items_update on public.catalog_items for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

create policy catalog_bundles_select on public.catalog_bundles for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy catalog_bundles_insert on public.catalog_bundles for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy catalog_bundles_update on public.catalog_bundles for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));

-- La composición de un pack sí se borra: guardar es un conjunto completo.
create policy catalog_bundle_items_select on public.catalog_bundle_items for select to authenticated
  using (private.has_role(org_id, 'viewer'));
create policy catalog_bundle_items_insert on public.catalog_bundle_items for insert to authenticated
  with check (private.has_role(org_id, 'partner'));
create policy catalog_bundle_items_update on public.catalog_bundle_items for update to authenticated
  using (private.has_role(org_id, 'partner')) with check (private.has_role(org_id, 'partner'));
create policy catalog_bundle_items_delete on public.catalog_bundle_items for delete to authenticated
  using (private.has_role(org_id, 'partner'));

revoke delete on public.catalog_items, public.catalog_bundles from authenticated;

-- ---------------------------------------------------------------------------
-- RPC (security invoker: la RLS de quien llama decide, solo un socio de la org cambia algo)
-- ---------------------------------------------------------------------------

-- Nuevo orden de los servicios que llegan (los de una categoría), en ese orden: posiciones 0, 1,
-- 2… Solo toca las filas cuya posición cambia, así que la auditoría no se llena de nada. Devuelve
-- cuántas ha movido.
create function public.reorder_catalog_items(p_ids uuid[]) returns integer
language sql
set search_path = ''
as $$
  with moved as (
    update public.catalog_items i
       set position = (x.ord - 1)::smallint
      from unnest(p_ids) with ordinality as x (id, ord)
     where i.id = x.id
       and i.position <> (x.ord - 1)::smallint
    returning 1
  )
  select count(*)::integer from moved
$$;

-- Lo mismo para los packs.
create function public.reorder_catalog_bundles(p_ids uuid[]) returns integer
language sql
set search_path = ''
as $$
  with moved as (
    update public.catalog_bundles b
       set position = (x.ord - 1)::smallint
      from unnest(p_ids) with ordinality as x (id, ord)
     where b.id = x.id
       and b.position <> (x.ord - 1)::smallint
    returning 1
  )
  select count(*)::integer from moved
$$;

-- Guarda un pack (o lo crea si no hay id) con todos sus servicios, en una transacción: conjunto
-- completo (lo que no viene se quita) y en el orden en que llegan. Un pack nuevo va al final.
-- Contrato del JSON (p):
--   bundle_id?, org_id (al crearlo), name, description?, translations, discount_bps,
--   items: [{ item_id, quantity? }]   (de 1 a 50, sin repetir; quantity vacía = la del servicio)
create function public.save_catalog_bundle(p jsonb) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'bundle_id', '')::uuid;
  v_org uuid;
  v_items jsonb := coalesce(p -> 'items', '[]'::jsonb);
begin
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) not between 1 and 50 then
    raise exception 'Un pack lleva de 1 a 50 servicios' using errcode = 'P0001', hint = 'bundle_items_invalid';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) x where nullif(x ->> 'item_id', '') is null) then
    raise exception 'Cada servicio del pack necesita su id' using errcode = 'P0001', hint = 'bundle_items_invalid';
  end if;
  if (select count(distinct x ->> 'item_id') from jsonb_array_elements(v_items) x) <> jsonb_array_length(v_items) then
    raise exception 'Un servicio va una sola vez en un pack: sube su cantidad' using errcode = 'P0001', hint = 'bundle_item_repeated';
  end if;

  if v_id is null then
    v_org := nullif(p ->> 'org_id', '')::uuid;
    insert into public.catalog_bundles (org_id, name, description, translations, discount_bps, position)
    values (
      v_org,
      p ->> 'name',
      nullif(p ->> 'description', ''),
      coalesce(p -> 'translations', '{}'::jsonb),
      coalesce((p ->> 'discount_bps')::integer, 0),
      coalesce((select max(b.position) + 1 from public.catalog_bundles b where b.org_id = v_org), 0)
    )
    returning id into v_id;
  else
    update public.catalog_bundles b
       set name = p ->> 'name',
           description = nullif(p ->> 'description', ''),
           translations = coalesce(p -> 'translations', '{}'::jsonb),
           discount_bps = coalesce((p ->> 'discount_bps')::integer, 0)
     where b.id = v_id
    returning b.org_id into v_org;
    if v_org is null then
      raise exception 'Ese pack ya no existe' using errcode = 'P0001', hint = 'bundle_not_found';
    end if;
  end if;

  delete from public.catalog_bundle_items bi
   where bi.bundle_id = v_id
     and bi.item_id not in (select (x ->> 'item_id')::uuid from jsonb_array_elements(v_items) x);

  insert into public.catalog_bundle_items (org_id, bundle_id, item_id, quantity, position)
  select v_org, v_id, (x.value ->> 'item_id')::uuid, nullif(x.value ->> 'quantity', '')::numeric, (x.ord - 1)::smallint
  from jsonb_array_elements(v_items) with ordinality as x (value, ord)
  on conflict (bundle_id, item_id) do update
     set quantity = excluded.quantity,
         position = excluded.position
   where (catalog_bundle_items.quantity, catalog_bundle_items.position)
         is distinct from (excluded.quantity, excluded.position);

  return v_id;
end;
$$;

revoke all on function public.reorder_catalog_items(uuid[]) from public, anon;
revoke all on function public.reorder_catalog_bundles(uuid[]) from public, anon;
revoke all on function public.save_catalog_bundle(jsonb) from public, anon;
grant execute on function public.reorder_catalog_items(uuid[]) to authenticated;
grant execute on function public.reorder_catalog_bundles(uuid[]) to authenticated;
grant execute on function public.save_catalog_bundle(jsonb) to authenticated;

revoke all on all tables in schema public from anon;
