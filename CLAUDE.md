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
- **Correo (módulo Correo):** `mail_accounts` guarda el buzón (IMAP/SMTP) con la contraseña cifrada por `secretStoreFromEnv()`; esa columna no la puede leer ningún miembro (grants por columna) y solo la abre el servidor para conectarse. `mail_messages` es una copia de trabajo: el original se queda en el servidor de correo, cada mensaje es único por `(cuenta, carpeta, uid)` y se ata al cliente por la dirección. Las reglas de hilos y direcciones van puras en `src/domain/mail`; IMAP en `src/server/mail/sync.ts`, SMTP en `send.ts`, y el cron cada 5 min en `/api/cron/mail`.
  - Un correo entrante de alguien desconocido abre su lead (`src/server/mail/leads.ts`) solo si `isAutomatedSender` dice que es una persona; nunca en la primera sincronización ni por correos de más de 14 días. Los nuevos quedan como `manual_status = pending_contact`. El correo no cambia estados por su cuenta: avisa (`mail_new_lead`, `mail_accepted`) y deja el paso a un clic con confirmación, porque aceptar un presupuesto crea contrato y factura.
  - La propuesta comercial en PDF (`src/pdf/proposal-*`, ruta `/api/quotes/<id>/proposal`) sale del mismo presupuesto que el formal; no sustituye a este, que es el que se acepta y se factura.

- **i18n:**
  - Toda cadena de UI va en `src/i18n/messages/<locale>/<área>.json` (core, auth, onboarding, settings, crm, clients, pipeline, funnel…), que `index.ts` fusiona. El español va completo; el catalán y el inglés caen al español si falta una clave.
  - Las llaves literales en un mensaje ICU se escapan con comillas simples: `'{yyyy}'`.
- **UI:** estética de gnerai.com (Manrope, `#04060a`, azules de marca, píldoras, vidrio) con densidad tipo Linear. Paneles laterales en lugar de modales anidados.
- **Módulos que se pueden apagar:** `orgs.settings.modules` (lo lee `readOrgModules`, en `src/domain/org/modules.ts`). Un módulo apagado no sale en el menú ni en Ajustes, su ruta devuelve 404, no cuenta en la cola de acciones ni en el resumen semanal y su cron no trabaja. **No se borra nada**: las tablas y el código siguen ahí y volver a encenderlo lo deja como estaba.
  - **Consejo de agentes** (`council`): **apagado** desde el 03/10/2026 porque gastaba en IA cada hora y casi no se usaba (5 recomendaciones, 3 informes, 1 tarea). Para recuperarlo: `update public.orgs set settings = jsonb_set(settings, '{modules,council}', 'true') where slug = 'gnerai';` (y que exista `ANTHROPIC_API_KEY` o `GROQ_API_KEY` en el servidor). Si se decide que no vuelve, eliminarlo es otro cambio aparte: `src/council`, `src/app/[org]/council`, `src/app/[org]/settings/council`, `src/components/council`, `src/app/api/cron/council`, la línea del cron en `deploy/subir.sh` y las 9 tablas de `20260926220000_consejo.sql`.
- **Dev:** `pnpm dev` en el puerto 3100. `/preview` enseña la interfaz sin base de datos.

# Estado y pendientes (03/10/2026): léelo antes de tocar Correo, Leads o Facturación

Todo lo hecho está en producción y en `main`. Plan detallado y comprobaciones en `docs/PLAN-correo-y-leads.md`.

## Qué hay y cómo funciona (lo que no se deduce del código)
- **Leads «vivos»:** la portada de Leads y la etapa de entrada del embudo solo cuentan los leads con novedad (último contacto o alta) en los últimos **14 días** o calificados como **calientes**; un **frío** calificado a mano nunca cuenta (`src/domain/crm/lead-freshness.ts`). El resto sigue en el pipeline y se ve con «Ver también los N anteriores». No se guarda: se deriva de las fechas.
- **«Toca contestar»** = el último mensaje es del cliente y pide algo; un «ok perfecto» no cuenta (`needsReply`/`isAcknowledgement` en `src/domain/mail/intent.ts`). Lo usan la bandeja, el tablero y la ficha del lead.
- **Leads por correo:** solo se abre un lead por un correo llegado **después de conectar el buzón** (`mail_accounts.created_at`), de una persona (no `noreply`, listas, proveedores, administraciones, ventas en frío ni newsletters). La primera descarga va por tandas de 200 mensajes: una vez abrió 11 fichas con correo viejo. Los nuevos quedan `manual_status = pending_contact`.
- **Correo en cada ficha:** el apartado «Correo» de lead y cliente es una conversación estilo WhatsApp (`src/components/mail/mail-chat.tsx`); cada mensaje se ve plegado hasta pulsarlo. La bandeja completa está en `/mail`.
- **Cobros previstos:** Facturas enseña cada mensualidad, anualidad y hito con el MISMO calendario que el cron (`forecastItems`, `src/domain/billing/forecast.ts`). Un contrato que cobra el día 5 debe **empezar el día 5**; si empieza el 1, el motor factura dos veces ese mes.
- **PDFs:** el standalone de Next no llevaba `pdfkit/js/standard-fonts/*.cjs` y en el servidor no se generaba ningún PDF. `deploy/subir.sh` lo completa y genera un PDF de prueba antes de subir; si falla, no sube.
- **Despliegue:** `deploy/subir.sh` ya no pisa `BREVO_API_KEY`/`RESEND_API_KEY` del servidor si la local está vacía.

## Bloqueos que NO son de código (los tiene que mover una persona)
1. **Enviar correo desde la app no funciona.** El servidor (DigitalOcean) tiene cerrados los puertos 465/587/25 (desde un Mac sí abren) y `BREVO_API_KEY`/`RESEND_API_KEY` están vacías en producción: el equipo **no usa Brevo**. Solución elegida: abrir un ticket en DigitalOcean para **desbloquear SMTP** en el droplet; entonces la app envía directo por IONOS con la contraseña ya guardada. Mientras, la bandeja y el chat lo explican en vez de fallar. Leer el correo sí funciona.
2. **SEO:** la credencial de Google (`integrations.refresh_token_encrypted`) no se abre con la clave actual (se guardó antes de la migración del 2/10). Hay que pulsar **SEO → Reconectar Google**; la historia ya descargada se conserva.

## Decisiones de negocio ya tomadas (y aplicadas en producción)
- **Facturación:** todo se factura desde ahora con **GNERAI PARTNERS, S.L.** (UDB Sports y Terrazea pasan a la SL desde el 2/10). **UDB**: 1.175 € sin IVA al mes (1.050 + 95 + 30), el día 5, desde el 5/10. Método de cobro: mensualidad idealmente SEPA y pagos únicos por transferencia; hoy todo está en transferencia hasta tener el IBAN.
- **Cuotas de autónomos** mensuales (domiciliadas, último día del mes): 90 € Marc Sanjuan, 90 € Hugo Lago y 300 € Marc Cortada (`expense_subscriptions`, categoría «Cuotas de autónomos»).
- **Marc Cortada:** entra en la SL con el **33 % en marzo** (probablemente 2027), pero **ya reparte beneficios a partes iguales** (`shareholdings` desde 2026-10-02 = 3334/3333/3333). El capital legal 50/50 de Finanzas → Sociedad **no se toca** hasta que entre. Está con la ayuda de autoocupación juvenil.
- **Sees (600 €, ~oct 2025) y Nitid (900 €, ~abr 2026):** cobraron sin IVA antes de la app; se apuntaron como cobros sin factura (`client_receipts`), no como facturas inventadas.

## Pendiente
- Ticket a DigitalOcean (SMTP) y SEO → Reconectar Google (arriba).
- **UDB:** falta su NIF (nombre legal puesto: «UDB Sports S.L.», sin confirmar) y, si cobra por SEPA, su IBAN. Sin NIF no se puede emitir su factura.
- Revisar los 3 leads que abrió el correo el 03/10: Álex Parra, Jesús Ros, Ignacio Cortada.
- Webs: hay 3 incidencias reales (illafantasia.com no responde, decidiomes.com con certificado SSL inválido, terrazea.com lenta).
- Cuando Cortada entre en la SL (marzo): actualizar el capital legal y las participaciones.
- Decidir si Cortada debe poder entrar a la app o no hasta entonces (hoy tiene acceso de owner).
- Hecho a medias a propósito: la landing de la propuesta usa la página pública que ya existe (`/p/q/<token>`, con aceptación online), que NO tiene la estética oscura de la propuesta de Nadia; si se quiere esa estética también ahí, es trabajo nuevo.

## Reglas de trabajo que han salido de estos días
- **No se piden ni se reciben contraseñas ni claves por chat**: se pegan en la app (se guardan cifradas) o en `deploy/.env.production`.
- Nada se acepta, se factura ni se envía solo: marcar aceptado crea contrato y borrador de factura (un clic con confirmación); las propuestas y respuestas salen en borrador.
- Antes de dar por buena una página nueva, **ejecuta sus consultas contra producción** con `deploy/.env.production` (así se cazó `quotes.archived_at`, columna inexistente que rompió Leads). Y pruébala con datos reales, no solo con los de ejemplo.
- Las academias no se cargan nunca en el software.
