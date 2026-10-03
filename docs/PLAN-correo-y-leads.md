# Plan: lo que queda de Correo y Leads

> **Estado (03/10/2026):** las fases 1 a 3 están hechas (commits `a7f5c03` y `0fee79f`, en el servidor; falta `git push` a GitHub). Fase 4: el PDF de propuesta comercial (estética Nadia) está listo y revisado con muestra; la landing pública es la que ya existe (`/p/q/<token>`, enlace secreto con caducidad y aceptación). Borradores de respuesta: se quedan en plantillas (sin IA). Queda la fase 0 (tú: push + contraseña IONOS) y revisar con correos reales la detección de aceptaciones y de remitentes automáticos.

Estado a 03/10/2026. En el servidor están `796ad9c`, `a7f5c03` y `0fee79f`; en GitHub solo el primero. Este documento es lo que falta,
en el orden en que se hará, con qué se entrega en cada paso y cómo se comprueba.

## Ya hecho (no hay que tocarlo)

- Correo dentro de la app: conectar IONOS, leer, buscar, responder, cron cada 5 min.
- Leads en carpetas con iniciales, etiquetas caliente/templado/frío y orden por urgencia.
- Totales sin ponderar (pago único, recurrente, ya presupuestado) y embudo visual con dinero por etapa.
- Ficha del lead con qué quiere, contacto, página de mensajes y aviso «toca contestar».
- Lectura del último correo (acepta, rechaza, pregunta, reunión, precio) con borrador de respuesta y botón de
  marcar aceptado con confirmación.

## Fase 0: lo que haces tú (5 min)

| # | Qué | Cómo se sabe que está bien |
|---|---|---|
| 0.1 | `git push` del commit `a7f5c03` | GitHub muestra el commit |
| 0.2 | Correo → pegar la contraseña de IONOS | Sale la bandeja con correos y «actualizado hace…» |
| 0.3 | Mirar Leads y una ficha de lead con correos reales | Los correos cuelgan del lead correcto |

Si algo cuelga del lead equivocado, se me dice **antes** de seguir con la fase 1: la fase 1 depende de que el
enlace por dirección funcione bien.

## Fase 1: crear el lead solo cuando escribe alguien desconocido (~25 min)

**Qué hace.** Al sincronizar el buzón, un correo entrante de una dirección que no está en ningún cliente ni lead
crea: la ficha, su contacto, y una oportunidad en la primera etapa con el asunto como título y la fuente «Correo».

**Para no llenar Leads de basura** (decisión ya tomada, se puede cambiar):
- No crea nada si el remitente es `noreply`, `no-reply`, `notifications`, `mailer-daemon`, etc.
- No crea nada si el correo trae `List-Unsubscribe` o `Precedence: bulk` (newsletters y listas).
- No crea nada si el dominio es de un proveedor nuestro (IONOS, Google, Meta, bancos, Hacienda…): lista editable.
- Solo mira correos **entrantes**, nunca los que enviamos nosotros.
- Los creados salen marcados como «Pendiente de contactar» (`manual_status = pending_contact`, que ya existe),
  así que no hace falta una columna nueva: se ve que son nuevos y hay que revisarlos.
- Si no es lo que parece, se descarta con el borrado completo que ya existe (`purge_client`).

**Piezas.**
1. `src/domain/mail/sender.ts` (puro): `isAutomatedSender(...)` con las reglas de arriba. Tests con ejemplos reales.
2. `src/server/mail/leads.ts`: crea ficha + contacto + oportunidad. Idempotente: si el correo se vuelve a leer,
   no duplica (se busca por dirección antes de crear).
3. Se engancha al final de `syncMailAccount`, solo para mensajes nuevos.
4. Tests de base de datos: crea una vez, no duplica, respeta RLS.

**Hecho cuando:** un correo de prueba de una persona nueva aparece como lead; uno de `noreply@…` no.

## Fase 2: importe estimado en leads sin presupuesto (~15 min)

**Qué hace.** Hoy un lead sin presupuesto cuenta 0 €. Pasa a mostrar una estimación **derivada** (no guardada):
la mediana de los presupuestos enviados o aceptados anteriormente. Si no hay histórico, no inventa: pone 0 y lo dice.

**Reglas.**
- Se muestra como «≈ 1.200 €» con la etiqueta «estimado», nunca mezclado con importes reales.
- Los totales de arriba separan: «con presupuesto» (real) y «estimado» (sin presupuesto).
- Si el lead ya tiene un importe puesto a mano en la oportunidad, manda ese.

**Piezas.** `src/domain/crm/estimate.ts` (puro, con tests) y su uso en `leadTotals` y en las carpetas.

**Hecho cuando:** un lead sin presupuesto enseña «≈ …» y el total lo suma aparte, sin tocar lo ya presupuestado.

## Fase 3: aviso cuando parece que aceptan (~15 min)

**Qué hace.** Si el último correo de un lead dice que acepta y hay presupuesto enviado, además de lo que ya sale
en la ficha llega un aviso a la bandeja de los socios y por push.

**Lo que NO hace** (decisión firme): no marca el presupuesto como aceptado solo. Aceptar crea contrato, hitos de
pago y borrador de factura; un correo mal leído no puede acabar en una factura. Sigue siendo un clic con
confirmación, y la confirmación enseña qué se va a crear y cuándo vence cada pago.

**Piezas.** Aviso con clave `dedupe_key` (no se repite al volver a sincronizar) y la vista previa de pagos en la
confirmación (fechas de vencimiento que ya calcula el motor de aceptación).

**Hecho cuando:** un correo de prueba «aceptamos el presupuesto» genera un único aviso, y el botón enseña los pagos.

## Fase 4: propuesta generada sola (~60–75 min, la grande)

**Qué hace.** Desde un lead (o al llegar su correo), un botón «Preparar propuesta» crea un borrador de presupuesto
con la plantilla que mejor encaja y el resumen de lo que piden, y genera dos formatos:

1. **PDF** con la estética de la propuesta de Nadia.
2. **Landing** con esa misma estética, con enlace propio.

**Piezas.**
1. Generador de borrador: plantilla elegida + frases de lo que piden en la introducción. Reutiliza
   `suggestTemplate` y el flujo de `quotes/new?template=`.
2. PDF: se basa en el generador de presupuestos que ya existe (`src/pdf`), con la maqueta de Nadia.
3. Landing: página pública de solo lectura servida por la propia app, con enlace con token que no se puede
   adivinar y que caduca. Se guarda en `quotes.landing_url`, que ya existe.
4. Revisión obligatoria: el borrador **no se envía solo**. Sale en «Borrador», se revisa y se envía con el flujo
   de envío que ya guarda la evidencia (copia del PDF, canal y destinatario).

**Landing:** hoy se usa la que ya existe (`/p/q/<token>`, con aceptación online), que NO tiene la estética oscura de la propuesta de Nadia. Si se quiere esa estética también en la landing, es trabajo nuevo (ver Decisiones, punto A).

**Hecho cuando:** desde un lead de prueba salen un PDF de propuesta (ruta `/api/quotes/<id>/proposal`) y el enlace
público del presupuesto (`/p/q/<token>`), con revisión obligatoria antes de enviar.

## Fase 5: remate (~20 min)

- Textos en castellano, catalán e inglés de todo lo nuevo.
- Prueba completa (`vitest`), `tsc`, lint y una pasada con datos reales.
- Subida con `deploy/subir.sh`, comprobación en el servidor y commit con explicación.
- Actualizar `CLAUDE.md` y `docs/CRON.md` con lo nuevo.

## Resumen

| Fase | Qué | Tiempo | Depende de |
|---|---|---|---|
| 0 | Push + conectar correo (tú) | 5 min | — |
| 1 | Lead automático desde el correo | ~25 min | Fase 0 |
| 2 | Importe estimado | ~15 min | — |
| 3 | Aviso de «aceptan» + vista previa de pagos | ~15 min | Fase 0 |
| 4 | Propuesta automática (PDF + landing) | ~60–75 min | Decisión A |
| 5 | Remate y subida | ~20 min | todas |

Total: unas 2 horas de trabajo mío, subiendo en dos entregas (fases 1–3, y fase 4) para que lo primero ya
funcione mientras hago lo segundo.

## Decisiones (03/10/2026)

- **A. Landing: PENDIENTE de confirmar.** Se delegó la elección («lo que consideres») y se eligió provisionalmente
  el enlace que ya existe (`/p/q/<token>`): caduca, no se adivina y permite aceptar online. Pero el usuario pidió
  «una landing con la estética de Nadia», y esa página tiene el aspecto de la app, no el de la propuesta oscura.
  Opciones: dejarla así, o restilarla con la portada oscura y el alcance numerado (~45–60 min). Hasta que lo
  decida, no se da por cerrada. Si además se manda una landing externa (cliente.gnerai.com), se guarda en
  `quotes.landing_url` como hasta ahora.
- **B. Borradores de respuesta:** plantillas fijas por tipo de correo (sin IA). Delegado al criterio del asistente.
- **C. Filtro de basura:** estricto (ya aplicado en fases 1–3). Delegado al criterio del asistente.

## Lo que no se hará (por seguridad)

- Marcar presupuestos como aceptados sin un clic tuyo.
- Enviar propuestas o respuestas sin que alguien las revise.
- Leer la contraseña del buzón: la pegas tú en la app y queda cifrada.
- Cargar nada de academias.
