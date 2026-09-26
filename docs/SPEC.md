# GNERAI OS — Requisitos originales

> Prompt original de Marc Sanjuan (25/09/2026), copiado tal cual como fuente de requisitos.
> El diseño que los implementa está en [`ARCHITECTURE.md`](../ARCHITECTURE.md). Los ajustes posteriores están al final.

---

PROMPT PARA CLAUDE CODE — GNERAI OS
Pégalo tal cual en Claude Code dentro de un repo vacío. Trabaja por fases: no pases a la siguiente sin que yo valide.

## Rol y objetivo

Eres un staff engineer full-stack y diseñador de producto. Vas a construir GNERAI OS, el software interno de GNERAI (agencia digital y estudio SaaS en el Maresme/Barcelona). Hoy lo usan 3 socios: Marc Sanjuan, Marc Cortada y Hugo Lago. Mañana puede venderse a otras agencias, así que la arquitectura debe ser multi-tenant desde el día 1 aunque solo exista un tenant.

Prioridad absoluta: que lo usemos cada día. Rápido, bonito, sin fricción, cero datos duplicados. Regla de oro: si un dato se escribe dos veces, el diseño está mal.

## Stack (no negociable)

* Next.js (App Router) + TypeScript estricto + Tailwind + shadcn/ui
* Supabase: Postgres, Auth (email + magic link), Row Level Security, Storage (PDFs), Edge Functions/cron
* Deploy: DigitalOcean App Platform (Docker). Variables en `.env.example`
* Zod para validación, TanStack Query o Server Actions, Recharts para gráficas
* PDFs de factura con `@react-pdf/renderer` (plantilla única de marca)
* Tests: Vitest para lógica de negocio (cálculo de facturas, MRR, recurrencias). Playwright para 3 flujos críticos
* Diseño responsive y PWA-ready (luego se empaquetará como app móvil con Capacitor o Expo; no lo hagas ahora, pero no lo impidas)
* UI en castellano, i18n preparado (es / ca / en). Moneda EUR, formato es-ES, zona Europe/Madrid

## Modelo de datos (núcleo)

Todas las tablas llevan `org_id`, `created_at`, `updated_at`, `created_by` y RLS por `org_id`.

* `orgs`, `members` (rol: owner | partner | viewer)
* `issuers` — emisores fiscales. Se va a constituir GNERAI SL, que será el emisor principal. Hasta entonces los socios facturan como autónomos: mantén soporte multi-emisor para migrar el histórico y los contratos vivos de cada socio a la SL (con fecha de traspaso). Cada emisor tiene NIF, dirección, IBAN, serie propia y % IRPF por defecto (0 % en la SL)
* `clients` — razón social, nombre comercial, NIF, dirección, sector, fuente de adquisición, socio responsable, estado (lead | activo | pausado | ex-cliente)
* `contacts` (N por cliente)
* `leads` / `deals` — cliente o prospecto, etapa, importe estimado, probabilidad, fuente (web, SEO, Meta Ads, outreach, referido, networking…), socio que lo trajo, próxima acción + fecha, motivo de pérdida (obligatorio al pasar a Perdido)
* `deal_stage_history` — cada cambio de etapa con timestamp (para calcular conversión y días por etapa)
* `quotes` (presupuestos) con `quote_lines`
* `contracts` con `contract_lines`. Cada línea tiene un tipo de facturación:
   * `one_off` (setup, proyecto cerrado)
   * `monthly` (mensualidad: mantenimiento, SEO, gestión de Ads, licencia SaaS)
   * `yearly` (anualidad: hosting, dominio, licencia anual)
   * `usage` (por unidad: p.ej. 375 € por campaña de Meta Ads, campañas extra)
   * campos: precio, cantidad, fecha inicio, fecha fin opcional, día de facturación, descuento, estado (activo | pausado | cancelado), fecha de cancelación y motivo
* `invoices` con `invoice_lines`, estado (borrador | emitida | cobrada | vencida | anulada), vencimiento, fecha de cobro, método. Facturas rectificativas en vez de editar emitidas
* `payments`
* `expenses` — gastos y suscripciones (categoría, recurrencia, emisor que lo paga)
* `projects`, `tasks`, `time_entries` (preparado para importar horas desde GTiQ vía API/webhook)
* `activities` — timeline unificado por cliente (llamadas, reuniones, emails, notas)
* `metrics_snapshots` — foto mensual de MRR, ARR, clientes activos, etc. (histórico inmutable)
* `audit_log`

## Reglas de negocio críticas

1. Las facturas se generan desde contratos. Un cron diario crea borradores para las líneas recurrentes que tocan ese día; un socio las revisa y emite en bloque. Las one-off se facturan desde el contrato con un clic (total o por hitos: 50/50, etc.).
2. Flujo en 1 clic: Presupuesto aceptado → Contrato → Factura(s) y el deal pasa a Ganado automáticamente.
3. Impuestos: IVA 21 % por defecto (configurable, exento/intracomunitario). La SL factura sin retención IRPF; la retención solo aplica a facturas históricas o puntuales emitidas por un socio autónomo (15 % / 7 %). Calcula base, cuota IVA, retención y total a cobrar. Todos los importes en céntimos (integer), redondeo por línea documentado y testeado.
4. Numeración correlativa por serie y emisor sin huecos. Una factura emitida es inmutable; correcciones mediante rectificativa.
5. Verifactu: al facturar como SL, GNERAI estará obligada desde el 1 de enero de 2027 (los autónomos, 1 jul 2027). Es un requisito de la fase 1, no algo opcional. Diseña la capa fiscal detrás de una interfaz `FiscalProvider` con dos implementaciones: (a) `InternalDraftProvider` para uso interno / borradores, y (b) `HoldedProvider` (o Quipu) que emite la factura legal vía API. No implementes tú el registro Verifactu (hash encadenado, QR, envío AEAT) en esta fase; deja la interfaz y un README explicando la decisión.
6. MRR = suma normalizada a mes de líneas `monthly` + `yearly/12` activas. ARR = MRR × 12. Los ingresos one-off se reportan aparte. Nunca mezcles.
7. Renovaciones: alerta 60/30/7 días antes de cada línea anual.
8. Cobros: recordatorio automático a los 7 y 15 días de vencida (email plantilla, envío manual confirmado por un socio).

## Módulos y pantallas

### Fase 1 — Núcleo (entregar primero)

* Login + onboarding de la org, la SL como emisor principal y los emisores autónomos históricos
* Dashboard de dirección: MRR, ARR, ingresos del mes vs mes anterior y vs mismo mes año anterior, one-off del mes, pendiente de cobro, vencido, renovaciones próximas, pipeline ponderado (importe × probabilidad), gráfico histórico 24 meses (ingresos recurrentes vs one-off apilados), clientes activos
* Pipeline Kanban (drag & drop): Lead → Reunión → Propuesta enviada → Negociación → Ganado / Perdido → Activo. Tarjeta con importe, días en etapa, próxima acción (roja si vencida)
* Embudo analítico: conversión etapa a etapa, tiempo medio por etapa, tasa de cierre por fuente y por socio, motivos de pérdida top. Filtros por rango de fechas
* Clientes: listado + ficha 360 (contratos, facturas, deals, actividad, proyectos, LTV, antigüedad)
* Contratos con editor de líneas de los 4 tipos
* Facturas: listado con filtros, emisión en bloque, PDF con marca, envío por email, marcar cobrada
* Presupuestos con la misma plantilla visual que las facturas

### Fase 2 — Control

* Gastos y suscripciones → margen real mensual
* Socios en la SL: participaciones de cada socio, retribución (nómina/autónomo societario), comisión % al socio que trajo el lead, y beneficio disponible para dividendos o reinversión
* Previsión de caja a 90 días (recurrentes + facturas pendientes − gastos recurrentes)
* Proyectos + tareas + horas (import GTiQ) → rentabilidad €/hora por proyecto y por cliente
* Visibilidad / SEO: integración Google Search Console API y GA4 Data API (OAuth) para gnerai.com: clics, impresiones, posición media, top queries, páginas que suben/bajan. Integración opcional Semrush/Ahrefs detrás de interfaz. Atribución: leads por canal vs tráfico
* Métricas SaaS: churn de clientes y de MRR, LTV, ticket medio, net revenue retention

### Fase 3 — Inteligencia y producto

* Copiloto con la API de Claude: resumir notas de reunión en la ficha, redactar borrador de propuesta a partir del deal y del catálogo de servicios, sugerir next best action, detectar clientes en riesgo (sin actividad, facturas vencidas)
* Catálogo de servicios con precios base (web, branding, Meta Ads, mantenimiento, SEO, software, apps, vídeo/dron) para montar presupuestos en segundos
* Portal de cliente (solo lectura): sus facturas, informes mensuales, estado de proyecto
* Informe mensual automático al cliente en PDF con marca

## Diseño

* Estética GNERAI: oscura por defecto (con modo claro), limpia, tipografía sans moderna, un color de acento, mucho aire. Densidad de información alta pero legible (estilo Linear / Attio)
* Command palette (⌘K) para crear cliente, deal, factura o buscar cualquier cosa
* Atajos de teclado en Kanban y listados
* Estados vacíos útiles, skeletons, toasts. Nada de modales anidados
* Pide el logo y colores exactos de GNERAI antes de montar la plantilla PDF; deja variables de marca en un único `brand.ts`

## Calidad y entrega

* Empieza escribiendo `ARCHITECTURE.md` (modelo de datos, decisiones, fases) y espera mi OK
* Migraciones SQL versionadas en `supabase/migrations`, políticas RLS incluidas y testeadas
* Seed con datos ficticios realistas (10 clientes, 25 deals, 18 meses de facturas con setup + mensualidades + anualidades) para ver los dashboards llenos desde el minuto 1
* Tests de: cálculo de totales con IVA/IRPF, generación de recurrentes (incluye meses de 28-31 días y altas a mitad de mes), MRR, numeración sin huecos
* Importador CSV para clientes y facturas históricas (de Holded/Excel)
* Exportación CSV/Excel de facturas y gastos para la gestoría, por trimestre
* Backups: documenta cómo activarlos en Supabase
* Al final de cada fase: resumen de lo hecho, lo pendiente y cómo probarlo

## Lo que NO debes hacer

* No mezcles ingresos recurrentes y one-off en la misma métrica
* No permitas editar facturas emitidas
* No hardcodees los 3 socios, el IVA ni la marca
* No construyas la app móvil nativa todavía
* No añadas dependencias pesadas sin justificarlo

---

## Ajustes posteriores

| Fecha | Ajuste | Dónde se refleja |
|---|---|---|
| 25/09/2026 | La app tiene que tener la estética de gnerai.com | `ARCHITECTURE.md` §9 |
| 25/09/2026 | De momento no se usará Holded | `ARCHITECTURE.md` §7.6, §13, §16 |
| 26/09/2026 | Seguir sin parar entre hitos mientras los socios no están: terminar el 1.2 y avanzar con lo siguiente, apuntando lo que haga falta de ellos | Resumen de la sesión |
| 26/09/2026 | Conectar el SEO (propio y de clientes) desde ya, no en la fase 2. Los tokens de Google se cifran con una clave de entorno (`INTEGRATIONS_ENCRYPTION_KEY`, AES-256-GCM) detrás de `SecretStore`; Vault puede sustituirla más adelante | Módulo `/seo` (Search Console + GA4), `ARCHITECTURE.md` §10 |
| 26/09/2026 | Segundo prompt: Consejo de agentes (de momento con la API; más adelante en local) | `CONSEJO.md` (diseño pendiente de OK; `AGENTS.md` ya lo usan los asistentes de código) |
| 26/09/2026 | Presupuestos: los hitos «a la aceptación» nacen automáticos y fechados ese día (si algo falla, el cron completa el paso); los primeros periodos recurrentes los factura el cron en su propio borrador; validez por defecto `orgs.settings.quote_validity_days` (30); un enviado sigue editable y conserva su número; uno rechazado aún se puede aceptar | `supabase/migrations/20260926190000_presupuestos.sql`, `src/server/quotes` |
