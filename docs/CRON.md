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

Después, fuera de esa transacción, avisa a los socios (partners y owners activos, bandeja y push) de
las suscripciones de gasto que se renuevan pronto (`src/server/finance/renewals.ts`, reglas en
`src/domain/finance/renewals.ts`): las anuales siempre y las mensuales desde un importe por cargo,
dentro de los días de aviso de la org (`orgs.settings.finance`: 14 días y 50 € por defecto; se
cambian en Finanzas → Infraestructura → Avisos). Nóminas y retribución de socios no avisan. Un
aviso por socio y cargo (`subscription_renewal:<suscripción>:<fecha del cargo>:<miembro>`).

Es idempotente: ejecutarlo dos veces el mismo día da el mismo resultado, y dos ejecuciones de
la misma org nunca se pisan (índice único de `job_runs` + bloqueo en la transacción).

Nada se emite ni se envía solo: el cron deja borradores y emails **por aprobar**.

## Programarlo en Supabase (producción)

1. Database → Extensions: activa `pg_cron` y `pg_net` (y `supabase_vault`, que viene activa).
2. SQL Editor, una vez por entorno (cambia la URL y el secreto):

```sql
select vault.create_secret('https://gneraios.gnerai.com/api/cron/daily', 'gnerai_cron_url');
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

## Avisos push

`POST /api/cron/push` (mismo `CRON_SECRET`) reparte a los dispositivos los avisos nuevos de la
bandeja (presupuesto aceptado, recordatorio listo, renovación, fallo del cron…). Cada aviso se
reclama antes de enviarlo (`notifications.pushed_at`), así que nunca llega dos veces, y solo se
reparten los de las últimas 24 h. El cron diario también reparte al terminar. Necesita las
claves VAPID (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); sin ellas no
envía nada. Cada 2 minutos:

```sql
select cron.schedule('gnerai-push', '*/2 * * * *', $$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_url'), '/daily', '/push'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
```

En local: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/push`.

## Resumen semanal

`POST /api/cron/weekly` (mismo `CRON_SECRET`) manda a cada socio con el resumen activado
(Ajustes → Preferencias) su semana: lo de la semana pasada, cómo estáis, los objetivos, lo que
viene en el calendario y lo que espera a alguien. Por email (Resend; en local, Mailpit) y a sus
dispositivos con avisos. Solo los lunes (en la zona de la org) y una vez por semana y org
(`job_runs`, `weekly_digest`); `{"force": true}` en el cuerpo lo manda otro día, sin repetirlo.
Los lunes a las 05:30 UTC:

```sql
select cron.schedule('gnerai-weekly-digest', '30 5 * * 1', $$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_url'), '/daily', '/weekly'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
$$);
```

Cada socio puede verlo en cualquier momento (Ajustes → Preferencias → «Ver el de esta semana»)
o mandárselo al momento.

## Consejo de agentes

`POST /api/cron/council` (mismo `CRON_SECRET`) pone en cola y ejecuta lo que toca de los agentes
del consejo (CONSEJO.md): el briefing semanal, el cierre mensual y los análisis periódicos, con
los presupuestos y umbrales de Ajustes → Consejo. Sin `ANTHROPIC_API_KEY` no encola nada. Cada
hora:

```sql
select cron.schedule('gnerai-council', '0 * * * *', $$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_url'), '/daily', '/council'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
$$);
```

## Webs (uptime, SSL y dominios)

`POST /api/cron/sites` vigila las webs de los clientes (módulo Webs). **Cada 5 minutos.** En cada
llamada:

1. Comprueba todas las webs activas de todas las orgs, 5 a la vez: las pide siguiendo las
   redirecciones (10 s como mucho; cuenta como fallo un código ≥ 400, un tiempo agotado, el DNS, un
   certificado caducado o no válido…) y lee hasta cuándo vale su certificado SSL.
2. Guarda cada comprobación en `site_checks` (código, tiempo de respuesta, qué falló, caducidad
   del certificado).
3. Avisa a los socios (partner y owner) en la bandeja y por push de lo que ha cambiado: web caída
   (a partir de 2 fallos seguidos, para no avisar por un fallo suelto), web recuperada (con lo que
   estuvo caída), certificado SSL a 14 días o menos de caducar y dominio a 30 días o menos (o ya
   caducados). Los umbrales son de cada org (`orgs.settings.sites`, en Webs → Umbrales). Cada
   aviso lleva su clave (`notifications.dedupe_key`): repetir la llamada, o que coincida con un
   «Comprobar ahora», no duplica nada.
4. Reparte los avisos nuevos a los móviles (`dispatchPendingPushes`) sin esperar al cron de push.
5. Borra las comprobaciones de más de 30 días (la ventana de uptime más larga).

**Autenticación.** La cabecera tiene que ser exactamente `Authorization: Bearer <CRON_SECRET>`: la
palabra `Bearer`, un espacio y el mismo `CRON_SECRET` que tiene la app en su entorno. Se compara
entera y en tiempo constante (`src/server/cron-auth.ts`). Sin `CRON_SECRET` configurado en la app,
o con otra cabecera, responde `401`; con `GET`, `405`.

**Respuesta.** JSON con el resumen: `{"ok": true, "orgs", "sites", "up", "down", "slow",
"alerts", "pruned", "durationMs", "errors": [], "push"}`. `200` si todo fue bien, `207` si falló
alguna org (van en `errors`; las demás se comprueban igual) y `500` si no se pudo ni empezar.

En el servidor de gnerai.com lo llama `/etc/cron.d/gneraios` (tabla de abajo). A mano, en local:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/sites
```

Con Supabase Cron (si algún entorno no tiene el cron del servidor):

```sql
select cron.schedule('gnerai-sites', '*/5 * * * *', $$
  select net.http_post(
    url := replace((select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_url'), '/daily', '/sites'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gnerai_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
```

## Correo (bandeja de la empresa)

`POST /api/cron/mail` trae el correo nuevo de los buzones conectados (módulo Correo). **Cada 5
minutos.** En cada llamada, y para cada buzón de `mail_accounts`:

1. Abre la contraseña cifrada (clave del servidor) y se conecta por IMAP.
2. Sincroniza la bandeja de entrada y los enviados: pide solo los UID por encima del último
   guardado, 200 mensajes como mucho por carpeta. La primera vez se limita a los últimos 120 días.
3. Guarda cada mensaje en `mail_messages` (asunto, cuerpo en texto, hilo) y lo ata al cliente o lead
   por la dirección de correo (contactos primero, luego el dominio de la web del cliente).
4. Apunta en la cuenta cómo fue (`last_sync_at`, `last_error`), que es lo que se ve en la página.

Repetirlo no duplica nada: cada mensaje es único por carpeta y UID.

**Respuesta.** `{"ok": true, "accounts", "results": [{"account", "fetched", "linked", "error"}]}`.
`200` si todos fueron bien, `207` si falló algún buzón y `500` si no se pudo ni empezar.

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/cron/mail
```

## En producción: el cron del servidor de gnerai.com

En `gneraios.gnerai.com` no se usa pg_cron: `deploy/subir.sh` instala `/etc/cron.d/gneraios`, que llama
a la app en `127.0.0.1:3300` con `Authorization: Bearer $CRON_SECRET` mediante
`/opt/gneraios/cron.sh <trabajo>`. La hora es la del servidor (Europe/Madrid).

| Trabajo | Cuándo | Qué hace |
|---|---|---|
| `push` | cada 2 min | Reparte los avisos pendientes a los móviles |
| `watchdog` | cada 5 min | Si `/api/health` no responde 3 veces seguidas, reinicia la app (pm2 `gneraios`) |
| `sites` | cada 5 min | Comprueba las webs (solo si la versión subida trae el módulo Webs) |
| `mail` | cada 5 min | Trae el correo de los buzones conectados (módulo Correo) |
| `daily` | 06:30 | Facturación diaria, recordatorios y avisos |
| `seo` | 07:30 | Sincroniza Search Console y GA4 |
| `council` | cada hora (:15) | Consejo de agentes (necesita `ANTHROPIC_API_KEY`) |
| `weekly` | lunes 07:00 | Resumen semanal |
| `backup` | 03:45 | Copia de todas las tablas (NDJSON comprimido) y de los ficheros de Storage en `/var/backups/gneraios` (14 días, nunca menos de 3 copias; se genera en `<fecha>.partial` y solo se da por buena, y se podan las viejas, si no ha fallado nada) |

Registro de cada llamada: `/var/log/gneraios/cron.log` (rotado cada semana junto con los logs de pm2 de
gneraios). La copia nocturna no incluye las cuentas de Auth ni los contadores del esquema privado: para eso,
las copias diarias de Supabase (plan Pro) y el `pg_dump` de `docs/BACKUPS.md`.
