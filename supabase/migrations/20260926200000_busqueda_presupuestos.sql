-- ⌘K busca también presupuestos (por título o número).
create or replace function public.search_org(p_org uuid, p_query text, p_limit integer default 6)
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
  union all
  (select 'contract', k.id, k.client_id, k.title, cl.display_name
   from public.contracts k
   join public.clients cl on cl.id = k.client_id, q
   where k.org_id = p_org and k.archived_at is null
     and private.search_text(k.title) like q.pattern
   order by k.updated_at desc
   limit p_limit)
  union all
  (select 'invoice', i.id, i.client_id, i.number, cl.display_name
   from public.invoices i
   join public.clients cl on cl.id = i.client_id, q
   where i.org_id = p_org and i.number is not null
     and lower(i.number) like q.pattern
   order by i.issued_on desc
   limit p_limit)
  union all
  (select 'quote', qt.id, qt.client_id, coalesce(qt.number || ' · ', '') || qt.title, cl.display_name
   from public.quotes qt
   join public.clients cl on cl.id = qt.client_id, q
   where qt.org_id = p_org
     and (private.search_text(qt.title) like q.pattern or lower(coalesce(qt.number, '')) like q.pattern)
   order by qt.updated_at desc
   limit p_limit)
$$;
