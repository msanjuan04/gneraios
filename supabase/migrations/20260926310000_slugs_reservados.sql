-- GNERAI OS · Slugs reservados
-- /p (enlaces públicos del portal y de los presupuestos) e /icons (iconos de la app instalada)
-- son rutas de primer nivel: una org con ese slug las taparía. La lista es la misma que
-- RESERVED_SLUGS (src/domain/org/slug.ts).

do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.orgs'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%''onboarding''%';
  if v_name is not null then
    execute format('alter table public.orgs drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.orgs add constraint orgs_slug_not_reserved
  check (slug not in ('login', 'logout', 'auth', 'onboarding', 'api', 'preview', 'settings',
                      'invite', 'admin', 'app', 'brand', 'static', '_next', 'p', 'icons'));
