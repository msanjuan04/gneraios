-- La búsqueda de ⌘K devuelve también el cliente de cada resultado, para poder
-- abrir su ficha al elegir un contacto o un deal.

drop function public.search_org(uuid, text, integer);

create function public.search_org(p_org uuid, p_query text, p_limit integer default 6)
returns table (kind text, id uuid, client_id uuid, title text, subtitle text)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select '%' || private.search_text(btrim(p_query)) || '%' as pattern
  )
  (select 'client', c.id, c.id, c.display_name, coalesce(c.legal_name, c.tax_id, c.city)
   from public.clients c, q
   where c.org_id = p_org and c.archived_at is null
     and (private.search_text(c.display_name) like q.pattern
          or private.search_text(c.legal_name) like q.pattern
          or lower(coalesce(c.tax_id, '')) like q.pattern)
   order by c.display_name
   limit p_limit)
  union all
  (select 'contact', ct.id, ct.client_id, ct.full_name, coalesce(ct.email, cl.display_name)
   from public.contacts ct
   join public.clients cl on cl.id = ct.client_id, q
   where ct.org_id = p_org and ct.archived_at is null
     and (private.search_text(ct.full_name) like q.pattern or lower(coalesce(ct.email, '')) like q.pattern)
   order by ct.full_name
   limit p_limit)
  union all
  (select 'deal', d.id, d.client_id, d.title, cl.display_name
   from public.deals d
   join public.clients cl on cl.id = d.client_id, q
   where d.org_id = p_org and d.archived_at is null
     and (private.search_text(d.title) like q.pattern or private.search_text(cl.display_name) like q.pattern)
   order by d.updated_at desc
   limit p_limit)
$$;

revoke all on function public.search_org(uuid, text, integer) from public, anon;
grant execute on function public.search_org(uuid, text, integer) to authenticated;
