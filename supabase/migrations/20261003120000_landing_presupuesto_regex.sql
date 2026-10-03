-- La comprobación de la landing usaba {3,500} en la expresión regular y Postgres solo admite
-- repeticiones hasta 255: la condición no llegaba a evaluarse nunca (error al guardar). Se separa
-- en dos: la forma (https sin espacios) por expresión regular y la longitud por char_length.

alter table public.quotes drop constraint quotes_landing_url_check;
alter table public.quotes
  add constraint quotes_landing_url_check
  check (landing_url is null or (landing_url ~ '^https://[^[:space:]]+$' and char_length(landing_url) between 11 and 500));

create or replace function public.set_quote_landing(p_quote uuid, p_url text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
begin
  select org_id into v_org from public.quotes where id = p_quote;
  if v_org is null then
    raise exception 'Ese presupuesto no existe' using errcode = 'P0001', hint = 'quote_not_found';
  end if;
  if not private.has_role(v_org, 'partner') then
    raise exception 'No tienes permiso para cambiar la landing' using errcode = '42501';
  end if;
  if v_url is not null and (v_url !~ '^https://[^[:space:]]+$' or char_length(v_url) > 500) then
    raise exception 'La landing tiene que ser una dirección https' using errcode = 'P0001', hint = 'landing_url_invalid';
  end if;
  update public.quotes set landing_url = v_url where id = p_quote;
end;
$$;
