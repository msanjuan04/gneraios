# Control de socios y marco legal de GNERAI OS

**Ámbito:** guía de producto para dos futuros socios de la SL y Marc Cortada como colaborador externo. Los tres tienen acceso operativo al software; ese acceso no atribuye participaciones sociales. No constituye asesoramiento jurídico, laboral, contable ni fiscal. La asesoría y, cuando corresponda, un abogado deben confirmar decisiones y documentos antes de registrar obligaciones o emitir documentos legales.

## Situación comunicada y comprobada

El 1 de octubre de 2026 se indicó que **dos personas estarán en la futura SL** y que **Marc Cortada no estará en la SL**: prestará servicios y emitirá sus facturas por separado. Producción conserva tres miembros con rol técnico `owner`, pero **ninguna participación registrada** y **un único emisor autónomo, Marc Sanjuan Sardanyes**. No consta aún emisor SL. No convertir permisos del software en propiedad legal ni crear la SL con datos supuestos.

Cuando Marc Cortada facture a la SL, el documento recibido y su pago serán gasto/proveedor de la **SL** (si la factura está a su nombre) y conservarán número, PDF, IVA/retención y justificante según proceda. Los ingresos, gastos, declaraciones y obligaciones del negocio de Marc Cortada pertenecen a **su emisor autónomo**, separado de la SL. GNERAI OS podrá registrar ese emisor solo si Marc lo autoriza y se configura con sus datos; una factura recibida por la SL no equivale a llevar toda su contabilidad personal.

## Qué debe permitir controlar el sistema

GNERAI OS debe enseñar por persona y por entidad, con histórico y justificante:

| Hecho | Registro correcto | No confundir con |
|---|---|---|
| Participación en la SL | Participaciones y porcentaje vigente desde una fecha, con documento/acta de respaldo | Trabajo aportado, salario, préstamo o reparto de beneficio |
| Aportación a capital social | Movimiento societario, fecha, importe, acuerdo y justificante | Aportación de fondos, venta, ingreso operativo o gasto deducible |
| Aportación de fondos del socio fuera del capital | Movimiento con naturaleza y condiciones por confirmar, acuerdo y justificante | Capital social, préstamo o ingreso operativo hasta que asesoría lo clasifique |
| Dinero prestado a la sociedad | Deuda de la sociedad con socio: principal, condiciones aprobadas, pagos y saldo | Aportación definitiva o ingreso |
| Trabajo o cargo de administración | Retribución registrada en el mecanismo validado para esa persona y función, con soporte | Participación social o dividendo |
| Gasto pagado por socio | Gasto de empresa con pagador, factura/recibo, fecha y reembolso pendiente/pagado | Gasto sin justificante o ingreso del socio |
| Dividendo o distribución | Propuesta y acuerdo, ejercicio/resultado, importe aprobado, retenciones/pago y acta | Caja disponible, anticipo, préstamo o coste mensual |
| Captación/gestión comercial | Lead/deal, socio que lo originó y actividad trazable | Participación societaria o comisión devengada automáticamente |

La app no calculará automáticamente derechos, nóminas, cuotas, retenciones, dividendos ni comisiones según porcentajes de capital. Las participaciones describen propiedad; cualquier otra regla requiere acuerdo documentado y validación profesional. Los dos socios de la SL deben poder ver la información societaria autorizada; el acceso de Marc Cortada a información de la SL requiere permisos operativos explícitos, sin otorgarle propiedad ni derechos económicos societarios. Solo una función con permisos explícitos podrá registrar o confirmar cambios. Cada cambio debe conservar quién lo hizo, cuándo, valor previo, valor nuevo y documento soporte.

## Expediente societario pendiente de confirmar

No se inventan nombres, porcentajes ni situación de la SL. El control debe admitir estado **pendiente de confirmar**, **propuesto**, **aprobado**, **firmado/registrado**, **rechazado** y **sustituido**. Cada elemento guarda entidad emisora, persona responsable, fecha límite, fecha efectiva, fuente oficial/profesional, documento original privado y nota de validación.

Antes de declarar la sociedad constituida, deben verificarse con asesoría/notaría/Registro, según proceda: denominación y disponibilidad; domicilio y objeto; identidad y aportaciones de cada fundador; capital y participaciones; órgano de administración y aceptación del cargo; estatutos y reglas de transmisión/decisión; titularidad real; escritura, NIF provisional/definitivo e inscripción; certificados digitales, alta censal/IAE/IVA/Impuesto sobre Sociedades; régimen de Seguridad Social de cada socio según control y funciones; contratos y sistema de remuneración; cuenta bancaria; libros y calendario de obligaciones. El software registra evidencia y vencimientos; no decide la respuesta jurídica.

## Reglas de producto legales y contables

1. Mantener separado cada emisor: actividad actual de cada autónomo y futura SL no se mezclan ni se renombran retroactivamente. Cada factura, cobro, gasto, cuenta y movimiento conserva el emisor real.
2. Un presupuesto aceptado, contrato, factura, rectificativa, cobro, gasto, movimiento bancario, préstamo, aportación y distribución son eventos distintos, enlazados y auditables. No editar un documento fiscal emitido; corregir mediante el mecanismo legal correspondiente y conservar ambos documentos.
3. «Caja», «beneficio contable», «base imponible», «cobrado», «por cobrar» y «dinero potencial de oportunidades» aparecen como medidas distintas con definición, fecha, emisor y origen. El pipeline ponderado nunca se mezcla con facturación ni caja.
4. Importar y exportar originales y datos conciliables para asesoría por entidad/periodo, con manifiesto de faltantes y sumas de control. Una exportación incompleta se etiqueta incompleta.
5. No afirmar que GNERAI OS o Holded cumple un régimen fiscal por tener pantalla de facturas. Antes de emitir desde cualquier sistema, asesoría confirma quién conserva la numeración/documento fiscal y proveedor confirma cumplimiento/declaración aplicable.
6. Mantener dos seguimientos normativos separados: requisitos del sistema informático de facturación (RRSIF/VERI*FACTU) y factura electrónica B2B. Su calendario y ámbito no son equivalentes.

## Registro interno incorporado

`Finanzas → Socios` separa propiedad histórica y retribución por trabajo de movimientos internos: aportación a capital social, aportación de fondos del socio, préstamo del socio, devolución de préstamo, reembolso de gasto adelantado y distribución/dividendo. Cada fila guarda socio, clase, importe, fecha, referencia y notas; nace como **propuesta**. Un owner debe aprobar antes de marcarla pagada; aprobadas conservan sus datos y las pagadas/anuladas no se reescriben. La base aplica permisos/transiciones y registra cambios en auditoría. **Marc Cortada queda fuera de participaciones, dividendos, capital y préstamos de socio de la SL**; sus servicios se registran como facturas de proveedor o, si se acuerda otra relación, mediante documento validado por asesoría.

Este registro es un control operativo, no asiento contable, contrato de préstamo, acuerdo de junta ni prueba suficiente de gasto/derecho a dividendo. El campo de referencia es texto: adjuntar el documento original y completar el expediente legal sigue pendiente. Para capital, préstamo, reembolso o reparto real, guardar contrato/acuerdo y justificante tras revisión profesional; no cambiar clasificación contable basándose solo en la etiqueta seleccionada.

## Referencias oficiales revisadas el 1 de octubre de 2026

- [Ley de Sociedades de Capital, texto consolidado del BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2010-10544): derechos del socio; remuneración del administrador sujeta a estatutos y acuerdos; deberes/responsabilidad de administradores; aplicación del resultado y límites al reparto de dividendos. La ficha enlaza artículos 93, 217 y siguientes, 236 y 273.
- [Real Decreto-ley 15/2025, BOE](https://www.boe.es/diario_boe/txt.php?id=BOE-A-2025-24446): plazo del RRSIF ampliado a 1 de enero de 2027 para contribuyentes del Impuesto sobre Sociedades y 1 de julio de 2027 para el resto de obligados incluidos. Aplicabilidad concreta debe confirmarse para cada emisor.
- [Real Decreto 1007/2023, texto consolidado del BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840): alcance y requisitos del sistema informático de facturación. El BOE indica que texto consolidado es informativo; para uso jurídico se revisa publicación oficial y cambios posteriores.
- [Real Decreto 238/2026, BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295): desarrollo de factura electrónica B2B; exigibilidad vinculada a la orden ministerial de la solución pública y fases de 12/24 meses desde su entrada en vigor, según volumen. No confundirlo con RRSIF ni dar una fecha fija hasta verificar esa orden.

## Criterio de aceptación

Los dos socios de la SL pueden revisar un panel con propiedad vigente, movimientos por socio, remuneración registrada, gastos reembolsables, préstamos/aportaciones y propuestas de distribución separados; abrir cada cifra hasta su documento; ver periodo, entidad, estado de validación y autor del cambio; y exportar a asesoría. Marc Cortada figura como colaborador/proveedor externo, con sus facturas recibidas por la SL separadas de sus propias obligaciones de autónomo. Ningún elemento pendiente aparece como firmado, gasto deducible, deuda cerrada, beneficio distribuible o consejo legal.
