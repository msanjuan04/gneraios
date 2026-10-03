-- La propuesta publicada en web: muchas se envían como una landing propia (littleforest.gnerai.com,
-- bakmet.gnerai.com…). Guardar el enlace en el presupuesto permite abrirlo desde su ficha, saber qué
-- vio exactamente el cliente y no buscarlo en el correo.
--
-- Solo https y solo el enlace: el contenido de la landing vive en su propio repositorio.

alter table public.quotes
  add column landing_url text check (landing_url is null or (landing_url ~ '^https://[^[:space:]]{3,500}$'));

comment on column public.quotes.landing_url is 'Landing pública donde se envió la propuesta (https). Null: se envió solo en PDF.';

-- Las quotes se escriben solo por RPC (insert y update están revocados). Esta no toca importes ni
-- estado, así que vale también para una propuesta ya enviada o aceptada: es dónde está publicada.
create function public.set_quote_landing(p_quote uuid, p_url text) returns void
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
  if v_url is not null and v_url !~ '^https://[^[:space:]]{3,500}$' then
    raise exception 'La landing tiene que ser una dirección https' using errcode = 'P0001', hint = 'landing_url_invalid';
  end if;
  update public.quotes set landing_url = v_url where id = p_quote;
end;
$$;

revoke all on function public.set_quote_landing(uuid, text) from public, anon;
grant execute on function public.set_quote_landing(uuid, text) to authenticated;
