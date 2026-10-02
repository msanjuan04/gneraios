# GNERAI OS · estado y continuidad (1 de octubre de 2026)

## Avance local del 2 de octubre

- **Destino definitivo confirmado por usuario: `cnjroerndjuqocbitzye`. No usar `bxyutkqommdonnoiyozn` para trabajo nuevo.** `.env.local` ya apunta a `cnj...` y tiene su clave publicable, verificada mediante HTTP 200 en Auth; claves del proyecto anterior se retiraron y el servidor local se reinició. Faltan `SUPABASE_SECRET_KEY` y `SUPABASE_DB_URL` de `cnj...`. La preview responde; login real no puede funcionar hasta aplicar las migraciones y crear usuarios reales. Producción aún apunta al proyecto anterior; no se han aplicado migraciones ni movido datos.
- El usuario inició sesión en el dashboard de Supabase. Una consulta de solo lectura en SQL Editor confirmó que `cnj...` tiene **0 tablas públicas, 0 usuarios Auth, 0 buckets Storage y ninguna tabla de historial de migraciones**. Por tanto, los clientes y facturas antes vistos no están en este proyecto. No se han consultado ni importado datos del proyecto anterior tras la instrucción de no usarlo. Supabase oculta la clave secreta y la contraseña SQL; el usuario debe copiar ambas al `.env.local` local, sin publicarlas en chat. La contraseña de base de datos no debe restablecerse por el agente.
- `deploy/subir.sh` ahora rechaza cualquier `SUPABASE_PROJECT_REF` distinto de `cnj...` y comprueba que la URL coincida. Sintaxis Bash validada. El servidor actual tiene ~2 GiB RAM y 6 GiB swap; no hay Docker local, así que aún falta elegir y verificar build Linux seguro antes de publicar.

- Calendario: citas de varios días aparecen en cada día correspondiente, incluso si comenzaron antes del rango visible. El editor acepta fecha final distinta y eventos que cruzan medianoche. La sincronización comprueba `updated_at` antes de limpiar cambios pendientes o borrar registros: una edición simultánea no queda marcada como sincronizada por error.
- Pruebas nuevas: aislamiento RLS de citas personales entre miembros, secreto Google no legible por usuario, fechas y edición de citas de varios días. Pruebas focalizadas: 13/13; lint y TypeScript correctos; `pnpm build --webpack` terminó correctamente tras los últimos cambios. La suite completa se interrumpió después de más de cinco minutos sin resultado por carga concurrente, por lo que no se declara pasada. OAuth y sincronización con una cuenta Google real siguen sin probar.
- Participaciones: formulario nuevo ya no inventa reparto a partes iguales entre los tres miembros. La pantalla advierte expresamente que Marc Cortada es proveedor externo y que los tres accesos no significan tres socios. Sigue faltando modelo legal por emisor para impedirlo por base de datos; no se han creado porcentajes ni emisor SL.
- Nada de este avance está desplegado; `/preview` continúa siendo diseño sin persistencia. Las pruebas locales no modificaron datos reales.

Este documento permite retomar el trabajo sin confundir **código local**, **preview sin datos** y **producción**. No se han creado clientes, importes ni participaciones ficticias. Los cambios de esta sesión están en el árbol local, sin commit, sin push y sin desplegar.

## Datos y accesos comprobados

- Producción: `https://gneraios.gnerai.com`, servidor nginx/pm2 accesible por SSH. Release activa: `20260929092205`; **no contiene los cambios locales**.
- La versión publicada anteriormente aún usa `bxyutkqommdonnoiyozn` en `/etc/gneraios.env`; **no es el destino autorizado para el nuevo trabajo**. El destino indicado por el usuario es `cnjroerndjuqocbitzye`; se verificó que su base está vacía.
- En la instancia publicada anteriormente había tres miembros `owner` **técnicos**: Marc Sanjuan, Marc Cortada y Hugo Lago. Eso **no** demuestra que los tres sean socios de la SL. Comprobar miembros y emisores de `cnj...` antes de trasladar esta conclusión.
- Esquema de `cnj...`: sin tablas de aplicación ni historial de migraciones. Hay 47 migraciones locales pendientes de revisión y aplicación.
- `.env.local` apunta al nuevo destino `cnjroerndjuqocbitzye` (archivo ignorado por Git, permisos `0600`) y su clave pública funciona; falta la secreta y la conexión SQL. `NEXT_PUBLIC_APP_URL` sigue siendo `http://localhost:3000`; `/preview` está desconectada de la base. La app real local no estará operativa hasta completar secretos, migraciones y usuarios de `cnj...`.
- Google OAuth ID, secret y clave de cifrado están presentes en local y servidor. Falta comprobar que Google Cloud autoriza también `/api/auth/callback/calendar`, Calendar API y el alcance de edición solicitado.
- La CLI local de Supabase estaba autenticada en otra cuenta; la sesión del dashboard no autentica automáticamente la CLI. El servidor no tiene Supabase CLI, sesión ni `psql`. Falta URL SQL con contraseña de `cnj...` para aplicar migraciones. No hay Docker local ni `deploy/.env.production`.

## Código local ya avanzado

- Dashboard centrado en cobros del mes, pendientes, alertas y entregables próximos; evita vender pipeline como dinero cobrado.
- CRM/leads con mensajes, contexto comercial y propuestas; clientes con importes cobrados, pendientes y total; contratos, facturas, proyectos y entregables enlazados. La preview enseña estructura sin inventar filas.
- Finanzas por emisor: caja, gastos, banco, IVA estimado, exportación por periodo/emisor para asesoría con controles y manifiesto. No equivale a contabilidad o declaración fiscal validada.
- Gobierno: registro propuesto de movimientos de socios con aprobación y auditoría. El documento `GOBIERNO_SOCIOS_Y_MARCO_LEGAL.md` ya refleja **dos futuros socios SL y Marc Cortada como colaborador externo**; falta plasmar esa separación de manera explícita y exigible en la interfaz/base de datos.
- Calendario: eventos propios CRUD, tabla privada por miembro, OAuth Google individual y sincronización de citas en el rango visible. Cambios locales se intentan subir a Google; cambios del móvil se leen al abrir/refrescar (actualización automática cada dos minutos mientras la pestaña está visible). La preview de `/preview/calendar` permite probar aspecto y eventos temporales, sin persistir. **Flujo Google real aún no validado**; nuevas tablas no existen en producción.
- La app usa el dominio correcto `gneraios.gnerai.com` en guía y especificación; `deploy/subir.sh` ya lo usaba.

## Pendiente antes de llamar el producto terminado

1. **Base y despliegue.** Obtener claves publicable/secreta y conexión SQL de `cnjroerndjuqocbitzye`; auditar datos/esquema; respaldo previo; aplicar solo migraciones faltantes por orden; regenerar tipos; probar RLS y flujos con usuarios reales. Preparar bundle Linux sin Docker local o instalar builder; configurar entorno del servidor con `cnj...` sin filtrar secretos; desplegar y verificar salud, login, rutas y rollback. No apuntar `.do/app.yaml` a otro host: producción usa SSH/nginx/pm2.
2. **Legal/SL.** Registrar explícitamente relación legal por entidad: dos socios de futura SL y Marc Cortada proveedor/colaborador, aunque los tres con acceso operativo. Restringir capital, préstamos de socio y dividendos a socios legales; mantener facturas de Marc como proveedor de la SL. Confirmar con asesoría identidad/porcentajes/capital/fechas antes de crear SL o participaciones. Emisor autónomo de Marc Cortada y sus obligaciones solo si se decide gestionar ese negocio con su autorización; nunca mezclarlo con el libro de la SL.
3. **Finanzas/fiscalidad.** Revisar cada estimación de IVA/IRPF e impuestos por emisor, facturas recibidas y justificantes, conciliación completa, exportación y faltantes con asesoría. Holded o proveedor contable: conexión, reconciliación y fuente de verdad **posteriores**; no activar declaraciones automáticas sin validación profesional.
4. **Producto y estética.** Recorrer con datos reales de `cnj...` dashboard, leads, clientes, proyectos, presupuestos, facturas, finanzas, socios, equipo y calendario; corregir densidad, responsive, vacíos, botones y navegación. Las previews de varios módulos siguen siendo esqueletos sin datos; no sustituyen validación de la aplicación autenticada.
5. **Calendario Google.** Probar OAuth, alta/edición/borrado, eventos de día completo, recurrencias, cambios hechos en móvil, errores y reconexión con usuario real. Comprobar permisos de cada socio y privacidad: sus citas no deben aparecer en el feed de otro. Añadir la URL de callback a Google Cloud si falta. Considerar push/webhook o cron si se exige sincronía sin abrir el panel; implementación actual actualiza al abrir/recargar.
6. **Integraciones posteriores acordadas.** Google Ads y Meta Ads en modo lectura para métricas, creativos y avisos; enlaces a Ads Manager y reglas auditables, **sin** conectar ni pausar campañas ahora. Holded/asesoría y otros servicios externos después de fijar entidades y fuente contable. Nada de anuncios, leads, cifras ni clientes inventados.
7. **Cierre técnico.** Pruebas de dominio y RLS, lint, TypeScript, build Linux, test manual web/móvil, revisión de secretos/permisos y cambios Git. Commit/push solo después de revisar diff y migración; producción sigue en versión previa hasta entonces.

## Accesos para ver el trabajo

- Diseño local: `http://localhost:3000/preview` y `http://localhost:3000/preview/calendar` (sin datos reales; pruebas temporales).
- App local real: `http://localhost:3000/login` (**sin acceso operativo** hasta poner claves y esquema de `cnj...`).
- Versión publicada anterior: `https://gneraios.gnerai.com/login`.

## Actualización del 2 de octubre (12:40)

- **Producción ya usa `cnjroerndjuqocbitzye`**: 49 migraciones aplicadas, release `20261002103610` en `gneraios.gnerai.com`, `/etc/gneraios.env` apunta al proyecto nuevo (conserva el proveedor de email y la política de acceso que ya tenía el servidor). El proyecto `bxy…` queda sin tocar.
- Cuenta de Marc Sanjuan creada (`prod:socios`); faltan las de Hugo Lago y Marc Cortada (emails). Primer acceso: `/onboarding` crea la org, emisores, series e invitaciones.
- Código en commits `abdb274` y `b640cee`, sin push todavía. Detalle y pendientes en `docs/audit/2026-10-02.md`.
