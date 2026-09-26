@AGENTS.md

# GNERAI OS: convenciones del proyecto

- **Fuentes de verdad:** el diseño y las decisiones están en `ARCHITECTURE.md` y los requisitos en `docs/SPEC.md`. Se trabaja por hitos y se para a validar al final de cada uno; los cambios de rumbo se apuntan en la tabla de ajustes de `docs/SPEC.md`.
- **Regla de oro:** si un dato se escribe dos veces, el diseño está mal. Los estados se derivan (vencida, cobrada, estado del cliente…); no se guardan.
- **Nada hardcodeado:** socios = `members`, IVA/IRPF = `tax_rates` y emisores, umbrales = `orgs.settings`, marca = `src/brand.ts`.
- **Dinero y fechas:**
  - Dinero en céntimos enteros y tipos en puntos básicos (`2100` = 21 %).
  - La lógica de negocio va pura en `src/domain` (sin `next`, `react` ni `@supabase/*`) y con tests en Vitest. El target es ES2022.
- **Seguridad en Postgres:**
  - Cada tabla lleva `org_id` y RLS con `private.has_role(org_id, rol)`.
  - Las FKs a tablas de la org son compuestas: `(org_id, x_id)`.
  - Las altas sensibles van por RPC `security definer`.
- **Facturación (hito 1.2):**
  - Los importes de cada línea los calcula siempre `src/domain/tax` (redondeo por línea). La base de datos solo comprueba invariantes y suma la cabecera.
  - Las facturas y sus líneas solo se escriben por RPC: `save_invoice_draft` (borradores), `apply_billing_run` (cron, solo `service_role`) e `issue_invoice_begin` / `issue_invoice_complete` (emisión). Lo emitido es inmutable por trigger, también para `service_role`.
  - Los errores esperados de la base de datos llevan un `hint` (p. ej. `line_billed`) que `billingFailure` traduce a `billing.errors.*`.
  - El cron diario es `src/domain/billing/plan.ts` (puro) + `src/server/billing/engine.ts` (carga y aplica). Ver `docs/CRON.md`.
  - `src/server/billing/{context,engine}.ts`, `src/server/invoicing/{document,issue-core}.ts` y `src/pdf` no importan `server-only` porque también los usa el seed; solo se importan desde código de servidor.
- **Base de datos:**
  - Las migraciones van en `supabase/migrations` y los tests de base de datos en `tests/db`, sobre PGlite y sin Docker. `tests/integration` prueba contra el Postgres local lo que PGlite no puede (concurrencia) y se salta si no está en marcha.
  - Para la base local: `pnpm db:migrate` aplica lo pendiente sin borrar datos, y `pnpm db:seed:demo` recrea la org demo simulando 18 meses de facturación con el motor real (cron, emisión con PDF y cobros).
  - Si cambia el esquema, `pnpm db:types` regenera `src/lib/supabase/database.generated.ts`. `database.types.ts` solo añade las correcciones que el generador no ve (p. ej. columnas que rellena un trigger).
- **i18n:**
  - Toda cadena de UI va en `src/i18n/messages/<locale>/<área>.json` (core, auth, onboarding, settings, crm, clients, pipeline, funnel…), que `index.ts` fusiona. El español va completo; el catalán y el inglés caen al español si falta una clave.
  - Las llaves literales en un mensaje ICU se escapan con comillas simples: `'{yyyy}'`.
- **UI:** estética de gnerai.com (Manrope, `#04060a`, azules de marca, píldoras, vidrio) con densidad tipo Linear. Paneles laterales en lugar de modales anidados.
- **Dev:** `pnpm dev` en el puerto 3100. `/preview` enseña la interfaz sin base de datos.
