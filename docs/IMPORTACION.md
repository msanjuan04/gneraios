# Importar el histórico

> Cómo traer a GNERAI OS los clientes y las facturas que ya se emitieron fuera (la app `facturas`,
> Excel, gnerai-finance), qué columnas se entienden y cómo continúa la numeración.
> Se hace en **Ajustes → Datos**; las facturas de las que solo queda el PDF, en **Facturas → Importar
> facturas emitidas** (§10). Diseño: [`ARCHITECTURE.md`](../ARCHITECTURE.md) §6.1, §7.4 y §7.8.

## Cómo funciona

Cada importación tiene cuatro pasos, y **nada se guarda hasta el último**:

1. **Fichero.** Se sube un CSV (o el JSON de la app `facturas`). Se guarda tal cual, fila a fila.
2. **Columnas.** Cada dato se asigna a una columna por su título (en castellano, catalán o inglés, y con los nombres de las exportaciones conocidas). Se puede cambiar a mano.
3. **Simulación.** Cada fila sale como **crear**, **completar**, **saltar** o **error**, con sus motivos. En las facturas se ve además el tipo de cada línea (recurrente, puntual o uso) con la regla que lo ha decidido, y se puede corregir.
4. **Importar.** Se vuelve a simular con el estado de ese momento y se aplica. El resultado queda guardado con un enlace a cada cliente o factura creados.

**Reimportar el mismo fichero no cambia nada:** lo que ya está se reconoce y sale como «saltar». Si una importación se corta a medias, se vuelve a confirmar y se completa sin duplicar.

Límites: 5 MB, 5.000 filas y 120 columnas por fichero. Un `.xlsx` no se lee: hay que guardarlo como CSV (§3).

## 1. Antes de empezar

1. **Emisores y series** en Ajustes → Emisores: cada autónomo que facturó, con su NIF, y su serie con **el mismo formato de numeración que usaba**. El número de cada factura histórica tiene que seguir ese formato exactamente (ceros incluidos), porque de él sale la secuencia con la que continúa el contador:

   | Origen | Números | Formato de la serie |
   |---|---|---|
   | App `facturas` | `2026-0036` | `{yyyy}-{n:4}` (el de por defecto) |
   | gnerai-finance | `MS-2025/007` | `MS-{yyyy}/{n:3}` |
   | Otro | `F26/12` | `F{yy}/{n}` |

   Si un emisor usó dos formatos, crea una serie para cada uno (la antigua se puede archivar: los históricos se importan igualmente en ella).
2. **Un autónomo ya traspasado a la SL** también sirve: sus facturas se importan aunque el emisor esté archivado, siempre que la fecha caiga dentro de su alta.
3. **La SL** tiene que tener su fecha de alta rellena para importar facturas suyas (sin ella, GNERAI OS entiende que aún no existía).
4. **Orden recomendado:** clientes → facturas de cada emisor → revisar los contadores (§6) → primera factura desde GNERAI OS.

## 2. Desde la app `facturas`

La app antigua no tiene backend: todo vive en el **localStorage del navegador** donde se usó.

- `facturas:emitidas`: las **20 últimas** facturas emitidas (cliente, líneas, totales).
- `factura:contador:<año>`: el último número usado cada año.

Para sacarlo, en ese mismo navegador (y perfil), abre la app, abre la consola de las herramientas de desarrollo (⌥⌘I en Mac, F12 en Windows) y pega:

```js
const data = {};
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key.startsWith("factura")) data[key] = localStorage.getItem(key);
}
const link = document.createElement("a");
link.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
link.download = "facturas-historico.json";
link.click();
```

Se descarga `facturas-historico.json`. Súbelo tal cual en **Importar facturas históricas**: se aplana a una fila por línea y las columnas se asignan solas. Elige el emisor (el autónomo que usaba la app).

- Los totales se cuadran con los de la app, que calculaba el IVA y el IRPF sobre la base total (aquí se redondea por línea): si hay un céntimo de diferencia, se ajusta y se avisa.
- Como la app solo guardaba las 20 últimas, la simulación avisa si su contador iba más allá de lo que trae el fichero. Las anteriores se sacan de sus PDF a una hoja con la plantilla (§3), o se fija el último número a mano (§6).

## 3. Desde Excel (o cualquier hoja de cálculo)

1. Descarga la **plantilla CSV** desde Ajustes → Datos (tiene los títulos que se reconocen y una fila de ejemplo).
2. Una fila **por factura** (con su concepto y sus importes) o una **por línea** (repitiendo número, fecha y cliente en cada fila de la misma factura): las filas con el mismo número se agrupan.
3. Guarda como **«CSV UTF-8 (delimitado por comas)»** (Archivo → Guardar como). Excel en español escribe `;` como separador y coma decimal: es lo que se espera. También se entienden `,`, el tabulador, UTF-8 sin BOM y Windows-1252 (el CSV «normal» de Excel).
4. Fechas `dd/mm/aaaa` (también `aaaa-mm-dd`); importes `1.234,56` o `1234,56` (también `1,234.56`); porcentajes `21`, `21 %` o `0,21`.

Detalles que se corrigen solos (y se avisa): el cero inicial del código postal que Excel quita (`8301` → `08301`), espacios de más, el prefijo `ES` de un NIF, varios emails en una celda (se guarda el primero). Un teléfono que Excel convirtió en `6,12E+08` ya no se puede recuperar: se avisa y no se guarda.

### Columnas de facturas

| Dato | Títulos que se reconocen (ejemplos) | Notas |
|---|---|---|
| **Número** | Número, Nº factura, Factura, invoice_number | Obligatorio. Con el formato de la serie |
| **Fecha** | Fecha, Fecha de expedición, Data, fecha_emision | Obligatoria. No puede ser futura |
| **Cliente** | Cliente, Razón social, Destinatario | Obligatorio (o el NIF) |
| NIF | NIF, CIF, NIF cliente, VAT | Se valida la letra o el dígito de control |
| Dirección, CP, ciudad, provincia, país, email | Dirección, CP, Ciudad, Provincia, País, Email | Se guardan en la copia de la factura y, si el cliente es nuevo, en su ficha |
| Concepto | Concepto, Descripción, Servicio | Decide el tipo de la línea (§5) |
| Cantidad, precio | Cantidad, Precio, Precio unitario | Base de la línea = cantidad × precio |
| Importe de la línea | Importe, Importe línea | Si no hay precio |
| Tipo de IVA | % IVA, Tipo IVA, iva_pct | Por línea. Si falta, se deduce de la cuota |
| Cuota de IVA | IVA, Cuota IVA, iva_amount | La de la factura: sirve para cuadrar |
| Tipo de IRPF | % IRPF, Tipo retención | Si falta, se deduce de la retención o del total |
| Retención | IRPF, Retención | La de la factura |
| **Importe** | Base imponible, Base, Importe, Precio | Obligatorio alguno de los tres |
| Total | Total, Total factura | Se comprueba base + IVA − IRPF |
| Vencimiento | Vencimiento, Fecha vencimiento | Si falta: la fecha + el plazo de pago del cliente o de la org |
| Cobro | Fecha de cobro, Cobrada, Estado | Ver §7 |
| Rectificativa | Factura rectificada, Tipo factura | La original tiene que existir (antes en el fichero o ya en GNERAI OS) |
| Periodicidad | Periodicidad, Recurrencia, recurrence | mensual, anual, trimestral, puntual, uso… |
| Otros | Serie, NIF del emisor, Forma de pago, Régimen de IVA, Periodo desde/hasta, Notas | Opcionales |

### Columnas de clientes

| Dato | Títulos que se reconocen (ejemplos) | Notas |
|---|---|---|
| **Nombre** | Nombre, Nombre comercial, Cliente, Empresa | Obligatorio (o la razón social) |
| Razón social | Razón social, Nombre fiscal | |
| NIF | NIF, CIF, DNI, VAT number | Español, intracomunitario (`FR…`) o extranjero si el país no es España |
| Dirección, CP, ciudad, provincia, país | | País por nombre o código (`FR`, `Francia`) |
| Sector, web, notas, plazo de pago, idioma | | |
| Fuente de adquisición | Fuente, Origen, Canal | Tiene que existir en Ajustes → Pipeline |
| Socio responsable | Responsable, Socio | Por iniciales o nombre; si no, quien importa |
| Código en el origen | ID, Código cliente, Referencia | Reconoce al cliente al reimportar aunque no tenga NIF |
| Contacto, cargo, email, teléfono | Contacto, Cargo, Email, Teléfono | Crea un contacto (el primero, principal y de facturación) |

Un fichero con **una fila por contacto** funciona: las filas con el mismo NIF (o el mismo nombre) son el mismo cliente, y cada una añade su contacto.

## 4. Desde gnerai-finance

Si llegó a tener datos reales, en su proyecto de Supabase → SQL Editor, ejecuta esta consulta y descarga el resultado como CSV:

```sql
select i.invoice_number, i.fecha_emision, i.fecha_vencimiento, i.fecha_cobro,
       c.nombre as cliente, c.nif, i.concepto,
       i.base_imponible, i.iva_pct, i.iva_amount, i.irpf_pct, i.irpf_amount, i.total,
       i.recurrence, i.status
from public.invoices i
left join public.clients c on c.id = i.client_id
where i.direction = 'issued' and i.kind = 'client' and i.status <> 'draft'
order by i.fecha_emision, i.invoice_number;
```

Las columnas se asignan solas; `recurrence` (unique / monthly / quarterly / annual) decide el tipo de cada factura y `status` = `paid` o `fecha_cobro` la marcan cobrada (con «Cobro: según el fichero»). Importa una vez por emisor (cada socio tenía su prefijo) y crea antes su serie con el formato `PREFIJO-{yyyy}/{n:3}`.

## 5. Recurrente, puntual o uso

Sin contratos detrás, el tipo de cada línea sale de su concepto, por reglas de palabras clave (en castellano, catalán e inglés). Gana la primera que coincide:

| Regla | Palabras (ejemplos) | Tipo |
|---|---|---|
| Periodicidad explícita | mensual, mensualidad, al mes, monthly | Mensual (recurrente) |
| | anual, anualidad, al año, yearly | Anual (recurrente) |
| Puntual explícito | cuota de alta, pago único, puntual, setup fee | Puntual |
| Uso | campaña, campanya, campaign, horas extra | Uso |
| Alojamiento y dominios | hosting, alojamiento, dominio, SSL | Anual (recurrente) |
| Servicio recurrente | mantenimiento, cuota, suscripción, licencia, soporte, gestión de redes | Mensual (recurrente) |
| Proyecto | web, diseño, desarrollo, rebranding, logo, app, auditoría, vídeo | Puntual |
| Ninguna | — | Puntual, marcada para revisar |

- Por eso «Mantenimiento web» es recurrente aunque diga «web».
- Una columna de periodicidad manda sobre las palabras clave.
- En la simulación, cada línea enseña su regla («Regla: «mantenimiento» → Mensual») y un selector para cambiarla. Las que no casan con ninguna regla, o casan a la vez con uso y con servicio recurrente, salen marcadas para revisar.
- El tipo importa: recurrente, uso y puntual **nunca se mezclan** en las métricas, y el MRR de los meses anteriores a GNERAI OS se reconstruirá con las líneas recurrentes importadas (marcado como estimado).

## 6. Cómo continúa la numeración

- **Cada factura importada conserva su número.** Entra ya emitida (no pasa por «emitiendo» ni tiene PDF en GNERAI OS) y, como cualquier emitida, **no se puede modificar**: si tenía un error, se corrige con una rectificativa.
- **El contador de su serie sube hasta la secuencia más alta importada** de ese año (el del número, si la serie se reinicia cada año) y **nunca baja**. La siguiente factura que emita GNERAI OS será la siguiente a esa. La simulación enseña cómo queda cada contador («pasa del 37 al 42») y los números que faltan en la serie («faltan los números 3–10»), por si alguno se emitió fuera y hay que importarlo también.
- **Nadie puede bajarlo por debajo de lo importado**, tampoco en Ajustes → Emisores → Ajustar numeración: la base de datos lo rechaza. Sí se puede subir (por ejemplo, si la app `facturas` llegó más lejos que las 20 facturas que guardaba).
- **Fechas no decrecientes:** dentro de una serie y un año, el orden de los números y el de las fechas no puede contradecir lo que GNERAI OS ya ha emitido. Un histórico con número menor que una factura de GNERAI OS no puede llevar una fecha posterior a ella, ni uno con número mayor una fecha anterior. Entre históricos, un desorden ya emitido solo se avisa (es un hecho que no se puede corregir).
- **Lo más limpio:** importar el histórico de un año **antes** de emitir la primera factura de ese año desde GNERAI OS. Si ya se emitió alguna, los históricos que faltan entran igualmente siempre que respeten el orden de fechas.

## 7. Cobros

Las facturas históricas casi siempre están cobradas; si no se dice nada, saldrían como vencidas y ensuciarían «pendiente de cobro». En el paso de columnas se elige:

- **Todas cobradas** (por defecto): cada ordinaria recibe un cobro por su total en su vencimiento (nunca en el futuro).
- **Según el fichero:** cobrada si trae fecha de cobro o un estado como «cobrada», «pagada», «sí» o `paid`; si no, pendiente.
- **Ninguna cobrada:** quedan pendientes (y vencidas si ya pasó su vencimiento); los cobros se registran después en cada factura.

Las rectificativas no llevan cobro: restan de su factura original.

## 8. Qué se reconoce como «ya existe»

| | Se reconoce por | Si ya existe |
|---|---|---|
| Cliente | NIF; si no hay, código en el origen; si no, nombre (sin acentos ni mayúsculas) | Solo se completan sus campos vacíos y se añaden contactos nuevos (por email). Lo que ya tiene no se pisa |
| Contacto | Email (o nombre, si no tiene) | Se salta |
| Factura | Emisor + número | Se salta. Si el fichero trae otros importes, se avisa, pero no se cambia |

Un cliente con el mismo nombre que otro pero distinto NIF, o un nombre que coincide con varios clientes, es un error: hay que decidir a mano cuál es.

## 9. Lo que no hace

- Desde un CSV no se importan los PDF: esas facturas no tienen PDF en GNERAI OS (el ZIP para la gestoría lo indica en su `LEEME.txt`). Se pueden adjuntar después subiendo el PDF en «Importar facturas emitidas» (§10): la reconoce como ya importada y guarda su PDF.
- No crea contratos: el histórico sirve para las métricas, el libro registro y la ficha del cliente; lo que siga vivo se da de alta como contrato.
- No modifica facturas ya importadas, aunque el fichero cambie.

## 10. Desde los PDF de las facturas

Para las facturas de las que solo queda el PDF (años de facturas de la herramienta anterior): se sueltan los PDF, GNERAI OS los lee, rellena cada factura, y al guardarla queda como histórica (igual que las del CSV: ya emitida, con su número y el contador de su serie al día, §6) **con su PDF original guardado**. La página de la factura enseña y descarga ese PDF, no uno nuevo con la plantilla de GNERAI OS.

**Dónde:** Facturas → **Importar facturas emitidas**; en la ficha de un cliente y en un proyecto suyo, **Adjuntar facturas** (todas son de ese cliente). Solo socios.

**Cómo lee:** con Claude si hay `ANTHROPIC_API_KEY` (lee también los escaneados); si no hay clave, o Claude falla por lo que sea, del texto del PDF (sin IA). Cada dato sale con un punto de color: verde, impreso con su etiqueta y cuadra; ámbar, sin etiqueta clara o deducido; rojo, supuesto. Un PDF escaneado sin Claude se rellena a mano. Hasta 8 MB por PDF; se leen de tres en tres y un fallo no para a los demás.

**Cada PDF es una fila:**

| Estado | Qué quiere decir |
|---|---|
| Lista | Emisor y cliente reconocidos por su NIF, el número encaja en una serie, la fecha tiene su etiqueta y el total calculado es el impreso. «Guardar las listas» las guarda de una vez |
| Revisar | Falta algo (el cliente, el emisor), algo es dudoso o el total no cuadra. Se despliega, se corrige y se guarda |
| Ya importada · Registrar cobro | Ya hay una factura con el mismo emisor y número (importada antes, pendiente, o emitida desde GNERAI OS), o el mismo PDF. No se duplica: si le queda algo por cobrar, se registra su cobro aquí; si es una importada sin PDF (p. ej. del CSV), se guarda este |
| Error | El PDF no se ha podido leer (dañado, con contraseña, no es un PDF) |

- **Cliente:** por su NIF; si no tiene, por nombre exacto y único. Si no existe, se propone crearlo con los datos de la factura (razón social, NIF validado, dirección, población, país), uno a uno o con «Crear los clientes que faltan» (un cliente por NIF). Se crea por el mismo camino que la ficha de clientes, con quien importa como responsable.
- **Importes:** las líneas se recalculan con el redondeo por línea de GNERAI OS y se cuadran al céntimo con el IVA y el IRPF impresos si la diferencia es de redondeo (la herramienta antigua calculaba sobre el total). Si el total no cuadra con el PDF, se avisa.
- **Cobro:** Pendiente, Cobrada o Cobro parcial, con su **fecha de cobro**, que es el día que pagó el cliente y no la de la factura. Sale «Cobrada» solo si el PDF lo dice (un sello «PAGADA», «Pagado el…», «Fecha de pago»), con esa fecha; si no, «Pendiente». Varias a la vez: «Marcar como cobradas el…».
- **Número:** tiene que seguir el formato de una serie del emisor (§1). Si no, se dice qué formato tendría que tener la serie para crearla en Ajustes → Emisores.
- **Rectificativas:** se reconocen y se avisa, pero se importan desde el CSV (§3).
- Una factura importada desde PDF y desde el CSV es la misma (emisor + número): reimportar cualquiera de las dos se reconoce como ya importada.
