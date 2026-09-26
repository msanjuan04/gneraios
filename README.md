# GNERAI OS

El software interno de GNERAI: clientes, pipeline, contratos, facturación y métricas. Multi-tenant desde el día 1.

- Diseño y decisiones: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Requisitos originales y cambios de rumbo: [`docs/SPEC.md`](docs/SPEC.md)

## Arrancar en local

Requisitos: Node 22, pnpm 11 y, para la base de datos, Docker (Docker Desktop u OrbStack).

```bash
pnpm install
pnpm dev          # http://localhost:3100
```

Sin base de datos la app ya arranca:
- `/login` explica cómo conectarla.
- `/preview` enseña la interfaz con datos de ejemplo.

### Con base de datos (Supabase local)

```bash
pnpm db:start     # levanta Postgres, Auth, Storage y Mailpit en Docker
cp .env.example .env.local
# pega en .env.local la API URL, la Publishable key y la Secret key que imprime db:start
pnpm db:types     # regenera src/lib/supabase/database.types.ts desde la base de datos
pnpm dev
```

- Los emails de acceso llegan a Mailpit: <http://127.0.0.1:54324>.
- La primera persona que entra pasa por el onboarding: crea la org, los emisores, las series, los impuestos y las invitaciones.

Otros comandos:

| Comando | Qué hace |
|---|---|
| `pnpm test` | Tests de dominio y de base de datos (Postgres real con PGlite, sin Docker) |
| `pnpm typecheck` · `pnpm lint` | TypeScript estricto y ESLint |
| `pnpm db:migrate` | Aplica las migraciones pendientes a la base local **sin borrar datos** |
| `pnpm db:reset` | Recrea la base local desde cero aplicando todas las migraciones (borra los datos) |
| `pnpm db:seed:demo` | Crea o recrea la org **demo** con datos ficticios y te añade como owner: clientes, deals con historial, actividades, contratos de todos los tipos y **18 meses de facturación generados por el motor real** (cron, emisión con PDF y cobros). Solo funciona contra la base local |
| `pnpm exec supabase migration new <nombre>` | Nueva migración en `supabase/migrations` |

El cron diario de facturación (y cómo programarlo en Supabase) está en [docs/CRON.md](docs/CRON.md).

## Producción

1. **Supabase** (plan Pro, región Frankfurt):
   - Crea el proyecto y aplica las migraciones con `pnpm exec supabase link --project-ref <ref>` y `pnpm exec supabase db push`.
   - En *Authentication*:
     - *Site URL* = URL de la app, y añade `<URL>/auth/confirm` a las *Redirect URLs*.
     - Configura un SMTP propio.
     - Copia las plantillas de `supabase/templates/` a *Magic Link*, *Invite* y *Confirm signup*.
   - Invita al primer owner desde *Authentication → Users → Invite* y después desactiva los registros públicos (*Allow new users to sign up*). A partir de ahí se entra solo por invitación.
2. **DigitalOcean App Platform**:
   - `doctl apps create --spec .do/app.yaml` (ajusta el repo y las URLs).
   - Rellena los secretos en el panel. La imagen se construye con el `Dockerfile` y el healthcheck es `/api/health`.
3. **Backups**: ver `ARCHITECTURE.md` §12. El detalle llega con `docs/BACKUPS.md` en el hito 1.5.

## Estructura

```
src/brand.ts        única fuente de marca (tokens de gnerai.com)
src/domain/         lógica de negocio pura y testeada (dinero, NIF/IBAN, numeración…)
src/server/         sesión, contexto de org, invitaciones
src/app/            rutas: /login, /onboarding, /[org]/…, /preview
supabase/           config, migraciones con RLS, plantillas de email
tests/db/           tests de RLS, triggers y RPC sobre PGlite
```
