# Puesta en producción

Lista de todo lo que hace falta para sacar GNERAI OS de local a `gneraios.gnerai.com`. En orden.

## 0. Subida en un paso (versión de prueba)

```bash
bash deploy/subir.sh
```

Desde este Mac, con Docker Desktop abierto y acceso SSH a `root@46.101.185.148` (el servidor de
gnerai.com). La primera vez pide un token de la cuenta de Supabase **de GNERAI** (nunca la de un
cliente), crea el proyecto `gneraios` en Frankfurt, cierra las altas, aplica las migraciones,
compila la app para el servidor (Docker, linux/amd64), la deja en `/opt/gneraios` con pm2
(`gneraios`, puerto 3300), añade el sitio a nginx con su certificado de Let's Encrypt, y crea la org
GNERAI con los tres socios y sus códigos en `deploy/codigos-produccion.txt`. Las siguientes veces solo
sube la versión nueva y las migraciones que falten. Los secretos están en `deploy/.env.production`
(fuera de git).

En esta versión de prueba el código basta para entrar (`AUTH_DEVICE_CONFIRMATION` vacío: sin email de
confirmación) y no hay crons ni email configurados. Lo de abajo es la lista completa para abrirla de
verdad. Ojo: el servidor tiene 2 GB de RAM con una quincena de apps; la app se limita a 384 MB de heap.

## 1. Infraestructura

| Pieza | Qué | Notas |
|---|---|---|
| Base de datos | Supabase Pro (región UE, Frankfurt o París) | Backups diarios (PITR opcional); ver `docs/BACKUPS.md` |
| App | El servidor de gnerai.com (nginx + pm2), con el bundle `standalone` compilado en Docker | `deploy/subir.sh`; Node 22 |
| Dominio | `gneraios.gnerai.com` con HTTPS | Tiene que coincidir con `NEXT_PUBLIC_APP_URL` |
| Código | Repositorio privado en GitHub | CI: `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build` |

## 2. Base de datos

1. `supabase link` al proyecto y `supabase db push`: aplica todas las migraciones de `supabase/migrations`.
2. Auth → URL configuration: *Site URL* = `https://gneraios.gnerai.com`; *Redirect URLs*:
   `https://gneraios.gnerai.com/auth/confirm`.
3. Auth → Email templates: el enlace del email apunta a `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   (igual que en local).
4. Auth → SMTP: el de Resend (el mismo dominio que `EMAIL_FROM`), para que los enlaces de acceso no caigan en spam.
5. Extensiones `pg_cron`, `pg_net` y `supabase_vault`, y los crons de `docs/CRON.md`:
   diario (05:00 UTC), SEO (06:00), push (cada 2 min), consejo (cada hora) y resumen semanal (lunes 05:30).

## 3. Variables de entorno de la app

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys |
| `NEXT_PUBLIC_APP_URL` | `https://gneraios.gnerai.com` |
| `CRON_SECRET` | `openssl rand -hex 32` (el mismo en el Vault de Supabase) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend, con el dominio verificado (SPF, DKIM y DMARC en el DNS de gnerai.com) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud (ya creados); URI de redirección de producción: `https://gneraios.gnerai.com/api/auth/callback/google` |
| `INTEGRATIONS_ENCRYPTION_KEY` | `openssl rand -base64 32`. **Una por entorno y no se cambia**: cifra los tokens de Google |
| `ANTHROPIC_API_KEY` | console.anthropic.com (consejo de agentes) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `pnpm exec web-push generate-vapid-keys` (un par por entorno) |

`ENABLE_UI_PREVIEW` se queda sin poner (apaga `/preview`). `MAILPIT_URL` y `SEED_DATABASE_URL` son solo de local.

## 4. Datos reales

1. Crear la org desde el onboarding con los datos fiscales reales de GNERAI SL y de los socios autónomos.
2. Ajustes → Emisores: la última factura de cada serie en la otra herramienta («Ajustar numeración»).
3. Ajustes → Datos: importar clientes y facturas históricas (`docs/IMPORTACION.md`).
4. Ajustes → Impuestos: revisar IVA/IRPF y el calendario fiscal con la gestoría.
5. Ajustes → Catálogo: precios reales de los servicios.
6. Cobros SEPA: el ICS que da el banco con el contrato de adeudos (norma 19.14), en cada emisor.
7. Verifactu: elegir proveedor certificado antes de la fecha de cada emisor (el calendario lo avisa).

## 5. Antes de abrirla

- `pnpm test` y `pnpm build` en verde.
- Entrar con los tres socios, activar los avisos push en el móvil (Ajustes → Preferencias) e instalar la app.
- Las pruebas (presupuesto → contrato → factura → cobro) se hacen en una org de pruebas, nunca en la
  real: una factura emitida no se borra.
