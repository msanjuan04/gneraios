-- Ya aplicado en producción el 03/10/2026. Reparto de beneficios a tres, a partes iguales.
-- Marc Cortada entra en la sociedad en marzo con el 33 %, pero reparte como los otros desde ya (está con
-- la ayuda de autoocupación juvenil). El capital legal 50/50 sigue en Finanzas → Sociedad hasta marzo.
-- Una sola transacción: la base exige que las participaciones de una fecha sumen siempre el 100 %.
begin;
delete from public.shareholdings
 where org_id = (select id from public.orgs where slug = 'gnerai') and valid_from = date '2026-10-02';
insert into public.shareholdings (org_id, member_id, percent_bps, valid_from)
select o.id, m.id, v.bps, date '2026-10-02'
from public.orgs o
join (values ('Marc Sanjuan', 3334), ('Hugo Lago', 3333), ('Marc Cortada', 3333)) as v(name, bps) on true
join public.members m on m.org_id = o.id and m.full_name = v.name
where o.slug = 'gnerai';
commit;
