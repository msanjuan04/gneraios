# GNERAI OS · plan de producto y cierre

Estado comprobado el 2 de octubre de 2026. Este documento distingue código local, conexiones reales y despliegue. Una pantalla diseñada no cuenta como función terminada.

Verificación local: TypeScript, build de producción con Webpack, `git diff --check` y 33 pruebas dirigidas pasan. Esto no sustituye pruebas con datos reales, base migrada ni revisión completa en dispositivos.

## Reglas de producto

- La app sirve a tres personas operativas; acceso operativo no equivale a propiedad de la sociedad. Los datos se separan por organización, emisor y cliente.
- No crear clientes, ingresos, propuestas, campañas, participaciones ni facturas ficticias. La preview puede mostrar estructura vacía, siempre rotulada como preview.
- Cada cifra enlaza con su fuente y define periodo, moneda, emisor y estado. Cobrado, facturado, pendiente y pipeline potencial son conceptos distintos.
- Cada módulo tiene estados de carga, vacío, error, permiso insuficiente y datos desactualizados. Acciones con confirmación y resultado visible.
- Navegación rápida en escritorio y móvil; densidad útil sin espacios superfluos, tablas adaptadas y formularios cómodos para tocar.

## 1. Base real y continuidad de datos

1. Destino exclusivo: Supabase `cnjroerndjuqocbitzye`. Consulta de solo lectura: 0 tablas públicas, 0 usuarios Auth, 0 buckets y 0 migraciones. El proyecto anterior no se usa ni se importa sin autorización específica.
2. Clave pública y secreta del proyecto nuevo presentes en `.env.local`. Contraseña SQL puesta por usuario **rechazada** por PostgreSQL (`password authentication failed for user postgres`). Hasta disponer de contraseña válida no se puede aplicar esquema ni probar persistencia real.
3. Antes de migrar: conexión validada, respaldo con `pg_dump`, revisión de las 49 migraciones locales, `db push`, generación de tipos, RLS y comprobación de tablas/buckets/funciones.
4. Crear organización y tres usuarios con identidades/correos reales; probar acceso, roles y recuperación. Recuperar clientes, facturas y pagos solo desde fuente identificada, verificable y autorizada. Comparar recuentos y saldos antes/después.
5. Producción sigue en release anterior. Despliegue nuevo solo después de migración, entorno de servidor actualizado, build Linux, prueba de login y rollback preparado.

## 2. Flujo comercial y operativo

- **Dashboard:** cobrado este mes y pendiente de cobro con vencimiento este mes; urgencias de hoy; entregas de los próximos siete días y posteriores por prioridad; cuestionarios y bloqueos de cliente; siguientes acciones comerciales; enlaces directos a expediente. Resumen anual en finanzas, no como centro de la portada.
- **Leads/CRM:** entrada y origen; mensaje original, respuestas por canal, adjuntos, formularios de descubrimiento, reuniones, tareas de seguimiento, propuesta y presupuesto versionados; fecha de envío, respuesta, aceptación, pérdida y motivo. Pipeline potencial separado de facturación. Conversión a cliente sin perder historial.
- **Clientes:** tabla con estado, cobrado, pendiente y total contratado/facturado claramente etiquetados; última actividad solo si ayuda. Ficha única con contactos, timeline, cobros, propuestas, contratos, proyectos, entregables, documentos y portal. Sin ciudad, responsable o número de deals como columnas obligatorias.
- **Trabajo:** proyectos, fechas de entrega, tareas, responsables operativos, dependencias, solicitudes del cliente, documentos enviados y versiones; aviso de bloqueo y acceso directo desde calendario/dashboard. Formularios/cuestionarios pendientes visibles en el expediente.
- **Documentos:** archivos y enlaces por cliente/proyecto/tipo, permisos, versiones, búsqueda, descarga individual o exportación por periodo. Portal cliente solo enseña archivos marcados como visibles.

## 3. Finanzas, sociedad y asesoría

- Libro por **emisor legal**: presupuestos, contratos, facturas, abonos, cobros parciales, gastos fijos y variables, justificantes, extractos, conciliación, IVA/retenciones **estimados** y exportación para asesoría con faltantes. Ningún cálculo se presenta como declaración aprobada por asesor.
- El documento legal aportado plantea constitución de SL con Hugo Lago y Marc Sanjuan al 50 % (1.500 € cada uno), y Marc Cortada sin participaciones iniciales. Es **plan documental, no situación formalizada**. El software debe guardar fechas y documentos efectivos antes de mostrarlo como capital real. Acceso de Marc Cortada como colaborador/proveedor; sus facturas a la SL se registran como gasto de proveedor. Su actividad y declaraciones personales se llevan separadas si decide incluirlas.
- No automatizar reparto de beneficios, sueldo neto, RETA, dividendos, traspasos de participaciones ni titularidad real a partir de una promesa. Mantener soporte documental, aprobaciones y pista de auditoría; asesoría valida reglas y fechas.
- Preparar adaptador Holded/u otro proveedor: exportación/importación, IDs externos, reconciliación, idempotencia, errores y fuente de verdad decidida. No duplicar contabilidad ni activar presentación de impuestos sin revisión profesional.

## 4. Calendario personal y móvil

- Cada miembro conecta su Google mediante OAuth individual. La app crea calendario secundario **GNERAI OS** en su cuenta, seleccionable al crear eventos en Google Calendar móvil. Eventos creados allí entran en GNERAI OS; altas, cambios y borrados de la app vuelven al mismo calendario.
- Código local preparado para calendario dedicado con alcance `calendar.app.created` y `calendar_id` por conexión. Conexiones antiguas al calendario principal requieren transición explícita para evitar duplicados; el proyecto nuevo aún no tiene usuarios.
- Verificar OAuth real, autorización de Google Cloud, eventos de día completo y varios días, recurrencias, cambios simultáneos, borrados, reconexión, aislamiento entre miembros y sincronización con la app cerrada. La implementación actual sincroniza al abrir/refrescar; un intervalo fijo o push queda por construir si se exige actualización inmediata sin abrirla.

## 5. Ads interno y vista de cliente

- **Interno:** cuenta, periodo, impresiones, clics, CTR e inversión; campañas y luego grupos/anuncios/creativos, evolución diaria, conversiones y coste por resultado cuando la medición exista. Alertas auditables de revisar, fatiga, escalar o pausar, con umbral, ventana, mínimo de datos y motivo visible. Enlace al anuncio original; la app no pausa ni escala automáticamente.
- **Cliente:** campañas vinculadas expresamente a su ficha y marcadas como visibles; sección del portal apagada por defecto. Solo métricas autorizadas de ese cliente, sin clave API, otras campañas, márgenes internos ni datos de terceros.
- **ChatGPT Ads:** clave de Advertiser API verificada con HTTP 200; API devuelve una campaña. Código local consulta cuenta e Insights de 28 días, incluye campañas sin impresiones y separa inversión de facturación. Tabla de vínculo campaña→cliente y portal están en código/migración local; falta aplicación y prueba real. Google Ads y Meta Ads se conectarán después con credenciales de cada cuenta y consentimiento adecuado; no se usarán datos de ejemplo como métricas.

## 6. Web app y escritorio

- PWA ya tiene manifiesto, iconos, service worker e instalación; comprobar instalación real en iOS/Android/escritorio, modo standalone, login persistente, notificaciones, atajos, vuelta desde enlaces y estado sin conexión. No prometer edición offline si no existe.
- Revisar todas las rutas en anchuras 320/390/768/1280+, teclado y lector de pantalla. En móvil: navegación compacta, tarjetas de resumen de dos columnas cuando quepan, tablas con alternativas legibles, formularios sin zoom accidental, controles táctiles, modales que no corten contenido. En escritorio: jerarquía y ancho útil sin márgenes excesivos, tablas escaneables y acciones frecuentes cercanas.
- La preview `/preview/ads` ya muestra estructura vacía; la app autenticada debe validarse con datos reales y permisos diferentes. Revisión visual y de interacción por módulo antes de publicar.
- La vista interna de campañas Ads ya presenta tarjetas en móvil y tabla en escritorio, con los mismos controles de asignación y publicación. La preview de leads evita tabla ancha en móvil; el calendario indica cuándo la cuenta tiene calendario secundario dedicado. Falta inspección visual completa de todas las rutas y dispositivos reales.

## 7. Definición de terminado

1. Lint, TypeScript, pruebas de dominio, RLS, build y migraciones correctos.
2. Flujos completos para los tres miembros: lead→propuesta→cliente→proyecto→factura→cobro→exportación asesor; evento móvil↔app; campaña interna→asignación→portal cliente.
3. Revisión de privacidad: miembro solo de su org, cliente solo de su enlace y campañas publicadas; claves nunca en navegador/logs/Git.
4. Prueba visual/táctil en móvil y escritorio; enlaces, descarga y errores reales verificados.
5. Backup y rollback probados; despliegue en `gneraios.gnerai.com`; monitorización y salud confirmadas.

## Pendiente inmediato

- Contraseña **Database** correcta para `cnjroerndjuqocbitzye`; la actual fue rechazada. Usuario debe cambiarla/restablecerla en su panel si no la conoce. Al validarse, retirar `SUPABASE_DB_PASSWORD` del `.env.local` y guardar URL SQL codificada.
- Terminar y verificar código local Ads/calendario; actualizar tipos tras migrar y probar OAuth real. Configurar en Google Cloud callback y alcance nuevo.
- Migrar base, recuperar datos autorizados o explicar ausencia definitiva, crear accesos reales y probar todo el flujo.
- Verificar régimen legal/fiscal con asesoría y documentos efectivos antes de activar cálculos como definitivos.
- Build local completado; revisión responsive completa, pruebas con datos reales y publicación pendientes.
