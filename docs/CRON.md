# Cron diario de facturación

Cada día a las **05:00 UTC** (06:00 o 07:00 en Madrid), Supabase Cron llama a
`POST /api/cron/daily` con `Authorization: Bearer <CRON_SECRET>`. Para cada org, en una sola
transacción (`apply_billing_run`):

1. Rehace los pendientes recurrentes con las condiciones, pausas y bajas actuales, y crea los
   periodos vencidos hasta hoy. Si un día falla, el siguiente recupera lo que faltó.
2. Prepara los hitos automáticos con fecha cumplida.
3. Agrupa los pendientes en borradores por emisor y cliente (o por contrato), añadiéndolos al
   borrador automático abierto si lo hay. El emisor se resuelve por la fecha de inicio del periodo.
4. Avisa de renovaciones (60/30/7 días), deja los recordatorios de cobro (7 y 15 días) en
   «Por enviar» y avisa de la cuenta atrás de Verifactu.
5. Pasa a Activo los deals ganados cuyo contrato ya ha empezado.
6. Lo registra en `job_runs`. Si el último OK tiene más de 26 h, el dashboard avisa.

Es idempotente: ejecutarlo dos veces el mismo día da el mismo resultado, y dos ejecuciones de
la misma org nunca se pisan (índice único de `job_runs` + bloqueo en la transacción).

Nada se emite ni se envía solo: el cron deja borradores y emails **por aprobar**.

## Programarlo en Supabase (producción)

1. Database → Extensions: activa `pg_cron` y `pg_net` (y `supabase_vault`, que viene activa).
2. SQL Editor, una vez por entorno (cambia la URL y el secreto):

```sql
select vault.create_secret('https://os.gnerai.com/api/cron/daily', 'gnerai_cron_url');
select vault.create_secret('<el mismo CRON_SECRET que la app>', 'gnerai_cron_secret');

select cron.schedule(
  'gnerai-daily-billing',
  '0 5 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
```

Para ver las ejecuciones: `select * from cron.job_run_details order by start_time desc limit 20;`
y, en la app, la tabla `job_runs` (Facturas → «Último cron»).

## En local

No hace falta programarlo: el botón **Facturar ahora** (Facturas) ejecuta lo mismo para tu org.
También se puede llamar a mano con la app en marcha:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/daily
```

Si se quiere programar también en local, la URL desde el contenedor de la base de datos es
`http://host.docker.internal:3100/api/cron/daily`.

## Cron del SEO

`POST /api/cron/seo` (mismo `CRON_SECRET`) sincroniza Search Console y GA4 de las webs
conectadas: la primera vez rellena 16 meses y después solo lo nuevo, de forma idempotente. Va
aparte de la facturación porque puede tardar minutos. Se programa igual, p. ej. a las 06:00 UTC:

```sql
select cron.schedule('gnerai-daily-seo', '0 6 * * *', $$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_url'), '/daily', '/seo'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 800000
  );
$$);
```
