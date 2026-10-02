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
| 26/09/2026 | No se cobrará con Stripe: los cobros son por transferencia y por remesa SEPA (adeudo directo) | Módulo de cobros (remesas SEPA) |
| 26/09/2026 | Portal del cliente = «Tu espacio GNERAI»: orden y transparencia (fases del proyecto, trabajo hecho visible, entregables, servicios, documentos, pedir algo), sin prometer resultados. Los datos de SEO se enseñan solo si el socio lo activa para ese cliente | Portal (`/p/...`) |
| 26/09/2026 | Calendario = vista sobre fechas que ya existen, sin tabla de eventos propios: las reuniones son actividades y lo interno vive en el calendario de cada socio, que recibe las fechas de GNERAI OS por un enlace ICS privado (últimos 30 días y próximos 12 meses). El 4T del 111 y el 115 vence el 20 de enero (no el 30, como el 303/130/349). Qué modelos aplican, en Ajustes → Impuestos | `src/domain/calendar`, `supabase/migrations/20260926240000_calendario.sql` |
| 26/09/2026 | Proyectos, tareas y horas (con temporizador), para medir el €/hora real de cada cliente contra un objetivo (`orgs.settings.target_hourly_rate_cents`, 60 € por defecto); catálogo de servicios y packs para presupuestar en un minuto | Módulos `/projects` y Ajustes → Catálogo |
| 26/09/2026 | Proyectos: si varios proyectos comparten contrato, lo facturado se reparte entre ellos por horas (no se cuenta dos veces y todos enseñan el mismo €/h); un `viewer` no apunta horas; una entrada de tiempo es de 24 h como mucho; al empezar un temporizador se detiene cualquier otro que la persona tenga en marcha, en cualquier org | `supabase/migrations/20260926280000_proyectos.sql`, `src/domain/projects` |
| 26/09/2026 | Las tareas de proyecto y las entregas de proyecto salen en el calendario (tipo «Tareas», activado por defecto), en «Esta semana», en el resumen de los lunes y en el ICS; una tarea abierta se mueve de día arrastrándola (su fecha vive solo en `project_tasks.due_on`) | `src/domain/calendar`, `src/server/calendar` |
| 26/09/2026 | La app se instala (PWA) y manda avisos push a los dispositivos que cada socio active; el texto es el mismo que el de la bandeja de avisos | `src/server/push`, `public/sw.js`, Ajustes → Preferencias |
| 26/09/2026 | Objetivos de los socios (MRR a una fecha y facturación del año, en `orgs.settings.goals`) con su progreso en el dashboard; tarjeta «Por hacer» con lo que espera a alguien; resumen de los lunes por email y push para cada socio (se desactiva en Preferencias) | `src/domain/metrics/goals.ts`, `src/server/metrics/action-queue.ts`, `src/server/digest`, `docs/CRON.md` |
| 26/09/2026 | Salud de cada cliente, derivada y explicable (nunca guardada): facturas vencidas (alarma si pasan de 30 días o son 2+), sin contacto (60/120 días, solo activos), renovación en 30 días, caída de clics de su web (−20 %/−40 % en 28 días, con 30 clics mínimo) y bajada del recurrente (−10 % en 90 días). De un ex-cliente solo cuenta lo que debe | `src/domain/clients/health.ts`, lista y ficha de clientes, «Por hacer» |
| 26/09/2026 | Canales de tráfico de GA4 (orgánico, anuncios en buscadores y en redes, redes, directo, otras webs, email, otros): se ve lo que traen las campañas de Google y Meta sin conectar aún sus APIs | `supabase/migrations/20260926340000_seo_canales.sql`, SEO |
| 26/09/2026 | Catálogo de servicios y packs: el precio se guarda con el mismo `billing_type` que las líneas de contrato (tipo e intervalo se derivan de él); en un pack, la cantidad vacía es la del servicio; archivar = `is_active` a falso; la unidad solo se ve en el catálogo y el selector (las líneas no tienen columna de unidad). Se usa desde el editor de presupuestos, el alta de contrato y el editor de facturas | `supabase/migrations/20260926290000_catalogo.sql`, Ajustes → Catálogo |
| 26/09/2026 | Consejo de agentes montado (9 agentes, briefing semanal, cierre mensual, evals). El «solo lectura» de los agentes lo garantizan la capa de datos (herramientas deterministas con Zod) y la RLS, no un rol `council_reader` de Postgres; sin `ANTHROPIC_API_KEY` todo funciona salvo las ejecuciones | `CONSEJO.md`, `src/council`, `supabase/migrations/20260926220000_consejo.sql`, `docs/CRON.md` |
| 26/09/2026 | Datos: la importación de clientes y facturas históricas pasa por una ruta (no una Server Action, que corta a 1 MB) y deja el contador de la serie en la última factura importada, sin bajarlo nunca. La exportación para la gestoría (CSV, XLSX o ZIP con los PDF del trimestre) la puede hacer también un `viewer`, pensado como cuenta para la gestoría | `supabase/migrations/20260926230000_datos.sql`, Ajustes → Datos, `docs/IMPORTACION.md` |
| 26/09/2026 | Cobros SEPA sin Stripe: mandatos por cliente, remesas pain.008 validadas contra el XSD oficial y devoluciones con su motivo. El ICS se propone calculado desde el NIF del emisor, pero generar un fichero exige confirmarlo (lo da el banco con el contrato de adeudos, norma 19.14) | `supabase/migrations/20260926260000_cobros.sql`, Facturas → Remesas |
| 26/09/2026 | Banco: se importa el extracto (Norma 43 o CSV) y GNERAI OS propone qué es cada movimiento (cobro de una factura, remesa, gasto, suscripción, AEAT…) con su motivo; nada se da por conciliado sin un socio. El estado de cada movimiento se deriva; los saldos del extracto van a la caja de Finanzas. Los pagos de impuestos (303/111) se proponen como gasto «Impuestos y tasas» (o se ignoran como liquidación) | `supabase/migrations/20260926320000_banco.sql`, Finanzas → Banco |
| 26/09/2026 | Entrada de los socios con código personal de 8 cifras en lugar de usuario y contraseña. El código lo genera la app (nunca uno obvio ni repetido), se enseña una sola vez y solo se guarda su hash (scrypt con sal). Solo abre sesión en un dispositivo de confianza: la primera vez en uno nuevo llega un email «¿Eres tú?» que hay que confirmar a mano, y los demás socios reciben un aviso. Intentos limitados por IP (5 cada 15 min) y en total (50 cada 10 min, salvo desde un dispositivo de confianza); cada cambio de código se avisa por email. La verificación en dos pasos (TOTP) pasa a ser opcional (`AUTH_MFA_REQUIRED=true` la vuelve obligatoria). El email y la contraseña siguen como vía alternativa | `supabase/migrations/20260926370000_codigos_acceso.sql`, `src/server/auth`, `/login`, `/auth/device`, Ajustes → Equipo y Preferencias, `scripts/prod-socios.mts` |
| 26/09/2026 | Producción en el servidor de gnerai.com (nginx, systemd y certificado de Let's Encrypt) en vez de DigitalOcean App Platform, con Supabase alojado en Frankfurt. El email sale por Brevo (gnerai.com ya está verificado ahí) además de Resend | `deploy/`, `docs/PRODUCCION.md`, `src/server/email/provider.ts` |
| 26/09/2026 | Revisión completa de la app (48 pantallas, móvil y los flujos de presupuesto, factura, pipeline, portal y temporizador). Cambios: pantallas de error propias (`error.tsx`, `global-error.tsx`) con reintentar y el código del error; las redirecciones del servidor usan `NEXT_PUBLIC_APP_URL` (detrás de nginx `request.url` es la interna: cerrar sesión y el OAuth de Google mandaban a localhost); al conectar Google siempre sale el selector de cuenta; en el lead y el contrato, «Crear cliente…» ya se ve elegido; las líneas nuevas de factura empiezan como «puntual» (o el tipo de la anterior); varias pantallas ya no se salen de ancho en el móvil. La entrada con código usa `CodeSlots` (casillas zinc, muelle, cascada) | `src/app/error.tsx`, `src/lib/public-url.ts`, `src/components/ui/code-slots.tsx`, `src/components/crm/deal-sheet.tsx` |
| 27/09/2026 | Estado del cliente a mano: además del que se calcula con los contratos (lead, activo, en pausa, antiguo), un socio puede marcar contacto pendiente, lead, activo, en pausa, finalizado o descartado. El marcado es el que se ve en la lista, en el filtro y en la ficha (con un punto, «desde el…» y el calculado al lado si no coincide); «Automático» lo quita. Las métricas (MRR, bajas, salud) siguen usando solo el calculado | `supabase/migrations/20260927140000_estado_cliente.sql`, `src/domain/clients/status.ts` |
| 27/09/2026 | «Registrar cobro» también desde la ficha del cliente y desde sus proyectos: un panel con sus facturas pendientes, en el que se marcan las que paga el cobro o se escribe lo recibido y se reparte solo de la más antigua a la más nueva (la última puede quedar a medias). La fecha de cobro es la del dinero, no la de la factura: si es anterior, se avisa (¿anticipo?) sin impedirlo. Se guarda un cobro por factura en un solo insert; las devoluciones siguen en la propia factura | `src/domain/invoicing/payment-allocation.ts`, `src/components/invoices/record-payment-sheet.tsx` |
| 27/09/2026 | Facturas → Histórico: lo facturado (base, IVA, IRPF y total, por fecha de emisión), lo cobrado (por el día en que entró el dinero) y lo pendiente, por año, trimestre o mes desde la primera factura, de toda la org o de un cliente, con exportación a CSV. Con un cliente, los socios ven también sus gastos asignados y el margen directo (sin horas ni reparto de servidores, que siguen en Rentabilidad). En la gráfica todo va sin IVA: lo cobrado lleva su parte de base, proporcional a su factura | `src/domain/invoicing/history.ts`, `src/app/[org]/invoices/history` |
| 27/09/2026 | Gastos por cliente: cada gasto y suscripción dice a quién sirve (la empresa, un cliente o repartido entre las webs que alojamos) y, si es de un cliente, se puede repercutir con un margen. «Añadir a factura» lo lleva al borrador abierto del cliente (o crea uno) con una línea por gasto, en una RPC atómica que no repercute dos veces; un gasto repercutido queda fijo mientras su línea exista y vuelve a pendiente si se quita del borrador. Los cargos de una suscripción heredan su reparto | `supabase/migrations/20260927100000_gastos_clientes.sql`, `20260927120000_repercutir_gastos.sql`, `src/domain/finance/rebill.ts` |
| 27/09/2026 | Rentabilidad con todos los costes: horas × coste interno + gastos del cliente (base + IVA no deducible, como el P&L) + su parte de la infraestructura compartida, repartida a partes iguales entre las webs alojadas activas hoy (Webs no guarda historia) y solo desde que es cliente. Ingresos = base de lo facturado (también lo importado) + cobros sin factura; «Cobrado» y «Pendiente» (de lo emitido en el periodo) se enseñan con IVA y el margen sigue sobre la base. Nuevo periodo «Desde siempre». Finanzas → Infraestructura con el coste mensual y anual, por proveedor y categoría, el coste por web alojada y las renovaciones; los avisos de renovación salen del cron diario (anuales siempre; mensuales desde un umbral en `orgs.settings.finance`; sin nóminas ni retribución de socios) | `src/domain/profitability`, `src/domain/finance/renewals.ts`, `src/app/[org]/finance/infrastructure` |
| 27/09/2026 | Proveedores y freelancers: cada proveedor es una empresa o un freelance con su contacto e IBAN, y su página enseña lo que ha costado (este año, en total, lo pendiente de pagar) y para quién (la empresa, cada cliente o las webs alojadas), todo derivado de sus gastos. «Registrar gasto» desde el proveedor o desde la ficha del cliente abre el panel de gastos ya asignado. La ficha del cliente enseña los proveedores que han trabajado para él | `supabase/migrations/20260927150000_proveedores.sql`, `src/app/[org]/finance/vendors` |
| 27/09/2026 | Cobros sin factura: mientras no se factura desde GNERAI OS (hasta que exista la SL), lo que paga cada cliente se apunta en su ficha o en un proyecto suyo (fecha en que entró el dinero, importe, concepto, método y proyecto opcional) en una tabla aparte, `client_receipts`: no es una factura ni un cobro de factura, no numera series ni lleva IVA. Cuenta como lo cobrado y como ingreso en la ficha (tarjeta «Cobros» y LTV), en Facturas → Histórico y en la rentabilidad. «Registrar cobro» ofrece «Sin factura» y, si hay facturas pendientes, «A facturas» | `supabase/migrations/20260927160000_cobros_sin_factura.sql`, `src/components/clients/collections-card.tsx` |
| 27/09/2026 | Importar facturas emitidas desde sus PDF (Facturas, ficha del cliente y proyecto): se leen con Claude si hay `ANTHROPIC_API_KEY` o, si no, del texto del PDF, y cada una sale lista o a revisar con lo seguro que es cada dato. Entran como históricas con `import_historical_invoice` (número, contador y, si se cobró, su cobro con la fecha del cobro, no la de la factura) y su PDF original queda en privado, enlazado en `invoice_attachments`, que es el que enseña y descarga la factura (marcada «Importada»). Una ya importada o emitida no se duplica: se ofrece registrar su cobro o guardar su PDF. Los clientes que faltan se crean con los datos de la factura | `supabase/migrations/20260927110000_facturas_adjuntas.sql`, `src/domain/invoice-import`, `src/server/invoice-import`, `docs/IMPORTACION.md` §10 |
| 27/09/2026 | Series desde la app: Ajustes → Emisores → «Nueva serie» (formato con vista previa; código y nombre salen del formato) y, en el asistente de importar facturas, «Crear la serie {formato}» cuando un número no encaja (por fila o «Crear las series que faltan»), que pasa a ella las facturas que encajan. La factura conserva su número; la serie por defecto no cambia. Solo owners, como el resto de emisores | `src/domain/invoicing/series-code.ts`, `src/app/[org]/settings/issuers` |
| 27/09/2026 | Chief of Staff con el «prompt maestro» de los socios: el briefing del lunes pasa a ser un plan de acción en cuatro secciones (Top 3 acciones críticas antes del martes, alertas de riesgo, oportunidades de optimización y conflictos resueltos entre agentes), cada punto con su impacto en € y su urgencia (qué pasa si no se hace) y de qué agentes sale, en síntesis ejecutiva. Se mantienen la caja y el semáforo. Las cifras siguen saliendo de métricas (el impacto es una métrica en €; si el punto sale de una recomendación, hereda su impacto) y los briefings anteriores se siguen leyendo | `src/council/agents/chief-of-staff/prompt.md`, `src/council/briefing.ts`, `CONSEJO.md` §6 |
| 27/09/2026 | Consejo con Groq además de Claude: un segundo runtime (Chat Completions compatible con OpenAI, con tools) para usar un modelo abierto (por defecto `openai/gpt-oss-120b`). Se elige con `COUNCIL_PROVIDER` o por la clave que haya (`ANTHROPIC_API_KEY` primero, luego `GROQ_API_KEY`). Mismo contrato: tools, salida validada con Zod, guardarraíles y presupuesto. Groq no admite el modo JSON con tools, así que la respuesta final se entrega con una tool «json» cuyos parámetros son el esquema (como lo intenta GPT-OSS); solo se envían las tools del agente, y si Groq pide esperar por su límite de tokens por minuto, se espera. El plan gratuito de Groq (8.000 tokens por minuto) no basta para el consejo: hace falta su Dev Tier. Además, para cualquier proveedor: un briefing rechazado por unos pocos puntos se publica sin ellos (y lo dice), y los ids de las métricas («(m33)») se quitan de los textos. El lector de facturas sigue con Claude o con el texto del PDF | `src/council/runtime/groq.ts`, `src/council/runtime/provider.ts` |
| 02/10/2026 | Producción pasa al proyecto Supabase `cnjroerndjuqocbitzye` con todos los datos, personas, códigos y ficheros del proyecto anterior migrados (`scripts/migrar-proyecto-anterior.sh`, `scripts/copiar-storage-anterior.ts`). El despliegue compila en local sin Docker (`sharp` con binarios linux-x64, arranque de prueba antes de subir) | `deploy/subir.sh`, `docs/audit/2026-10-02.md` |
| 02/10/2026 | Correcciones de la auditoría: ruta canónica del PDF exigida en SQL y en toda lectura privilegiada (A02); importes de línea recalculados por trigger (A03); el monitor de webs solo conecta a direcciones públicas, con la IP fijada y redirecciones revisadas salto a salto (A04, error «blocked»); adjuntos de facturas con ruta por huella e inmutables (A08); un email con PDF no se marca enviado sin él (A09) y se reclama antes de enviarlo (A10, `claimed_at`); la copia nocturna se genera en `.partial`, incluye Storage y no poda si falla (A11); el intento de acceso se apunta antes de comprobarlo (A12); un enlace público acepta presupuestos aunque la org exija MFA (A13) | `docs/audit/2026-09-29.md`, `docs/audit/2026-10-02.md` |
| 02/10/2026 | Clientes: «Cobrado» suma los pagos de facturas y los cobros sin factura; un cobro sin factura con cuenta toma el emisor de la cuenta (nunca se adivina) | `src/app/[org]/clients/page.tsx`, `supabase/migrations/20261001110000_movimientos_caja_por_cuenta.sql` |
| 02/10/2026 | Plantillas de presupuesto: los presupuestos genéricos (web, marketing, ads, software…) con sus líneas, texto y plan, por categoría del catálogo. Se crean desde cualquier presupuesto («Guardar como plantilla», nueva o sustituyendo una), se usan desde Presupuestos → Plantillas (`/quotes/new?template=`), se archivan (no se borran si se han usado). Una plantilla es una copia: cambiarla no toca lo ya presupuestado | `supabase/migrations/20261002160000_plantillas_presupuesto.sql`, `/quotes/templates`, `src/server/quotes/templates.ts` |
