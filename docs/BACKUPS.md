# Copias de seguridad

> Cómo se protegen los datos de GNERAI OS y cómo se comprueba que se pueden recuperar.
> Resume y concreta el §12 de [`ARCHITECTURE.md`](../ARCHITECTURE.md). Revisado el 26/09/2026.

## Qué hay que proteger

| Qué | Dónde vive | Por qué importa |
|---|---|---|
| Base de datos (clientes, contratos, facturas, cobros, auditoría…) | Postgres de Supabase (Frankfurt) | Es el sistema: si se pierde, se pierde todo |
| PDF de las facturas emitidas | Supabase Storage, bucket privado `invoices` | Son la copia legal exacta de cada factura; nunca se regeneran |
| Adjuntos (contratos firmados, justificantes, ficheros del portal…) | Supabase Storage, otros buckets | Documentación que hay que conservar |
| Claves y secretos | Variables de entorno de DigitalOcean y Supabase Vault | Sin ellos no se puede volver a arrancar la app |

Dos datos de partida que simplifican mucho:

- **GNERAI OS no borra datos de negocio.** Los clientes y contratos se archivan (`archived_at`) y una factura emitida no se puede borrar ni modificar (lo impide un trigger, también para `service_role`). El riesgo no es un borrado accidental desde la app, sino perder el proyecto de Supabase, un error de migración o una cuenta comprometida.
- **Los backups de Supabase no incluyen los ficheros de Storage.** La base de datos guarda la tabla `storage.objects` (los metadatos), pero no el contenido de los ficheros. Hay que copiarlos aparte.

## 1. Backups de Supabase (base de datos)

| Plan | Qué incluye | Retención |
|---|---|---|
| Free | Nada | — |
| Pro | Copia diaria automática | 7 días |
| Team | Copia diaria automática | 14 días |
| PITR (complemento, Pro o superior) | Restauración a cualquier segundo | 7, 14 o 28 días según lo contratado |

- **Hace falta el plan Pro como mínimo.** En el gratuito no hay ninguna copia.
- **PITR** (point-in-time recovery) requiere un compute Small o superior y, al activarlo, sustituye a las copias diarias. Recomendación: activarlo cuando la SL facture desde GNERAI OS (a partir de ese momento, un día de facturas perdido es un problema legal, no solo operativo).
- **Dónde se ven:** Dashboard de Supabase → Project → Database → Backups. La restauración se lanza desde ahí (sobre el mismo proyecto, que queda sin servicio mientras dura).
- **Límites que hay que tener presentes:**
  - Las copias viven en la misma cuenta de Supabase: si se pierde la cuenta o el proyecto, se pierden con él. Por eso hay copia externa (§2).
  - Siete días de retención no cubren los seis años de conservación legal (§4).
  - No incluyen Storage (§3).

## 2. `pg_dump` cifrado fuera de Supabase (semanal)

Una copia lógica completa de la base de datos, cifrada, en DigitalOcean Spaces (Frankfurt, `fra1`), en una cuenta distinta de la de Supabase.

```sh
# Variables (en los secretos del job, nunca en el repositorio):
#   SUPABASE_DB_URL      cadena de conexión directa (Project → Settings → Database), con el usuario postgres
#   BACKUP_AGE_RECIPIENT clave pública de age (la privada, en el gestor de contraseñas de los owners)
#   SPACES_KEY / SPACES_SECRET / SPACES_BUCKET

STAMP=$(date -u +%Y-%m-%d)
pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges \
  --schema=public --schema=private --schema=auth --schema=storage \
  --file="gnerai-os-$STAMP.dump"
age --recipient "$BACKUP_AGE_RECIPIENT" --output "gnerai-os-$STAMP.dump.age" "gnerai-os-$STAMP.dump"
rclone copyto "gnerai-os-$STAMP.dump.age" "spaces:$SPACES_BUCKET/db/weekly/gnerai-os-$STAMP.dump.age"
shred -u "gnerai-os-$STAMP.dump"   # el volcado sin cifrar no se queda en el runner
```

- **Versión de `pg_dump`:** la misma versión mayor que el servidor (Postgres 17), o una más nueva.
- **Cifrado:** [age](https://age-encryption.org) con clave pública; solo quien tiene la clave privada puede descifrar. La clave privada se guarda en el gestor de contraseñas compartido por los owners (al menos dos personas con acceso), **nunca** en el mismo bucket ni en el repositorio. Alternativa equivalente: `gpg --symmetric --cipher-algo AES256`.
- **Dónde se ejecuta:** un workflow programado de GitHub Actions es lo más sencillo (el repositorio ya usa Actions para CI). Ejemplo de disparador: `on: schedule: - cron: "0 3 * * 0"` (domingos, 03:00 UTC). Si falla, GitHub avisa por email; además, el workflow puede avisar por Telegram como el cron diario.
- **El día 1 de cada mes** el mismo job copia el último volcado semanal a `db/monthly/`, y **el 1 de enero** a `db/yearly/` (cierre del ejercicio anterior).

## 3. Copia de Storage a DigitalOcean Spaces (semanal)

Supabase Storage habla el protocolo S3 (Project → Storage → S3 Connection: endpoint, región y claves de acceso). Con `rclone` se sincroniza cada bucket con Spaces:

```sh
# rclone.conf con dos remotos S3: "supabase" (endpoint de Storage de Supabase) y "spaces" (fra1.digitaloceanspaces.com)
STAMP=$(date -u +%Y-%m-%d)
# Todos los buckets (hoy `invoices`; también los que se añadan): nada se queda fuera por olvido.
for BUCKET in $(rclone lsf --dirs-only supabase: | tr -d /); do
  rclone sync "supabase:$BUCKET" "spaces:$SPACES_BUCKET/storage/$BUCKET" \
    --backup-dir "spaces:$SPACES_BUCKET/storage-history/$STAMP/$BUCKET" \
    --checksum --transfers 8
done
```

- `--backup-dir` guarda aparte cualquier fichero que se vaya a sobrescribir o borrar en el destino: aunque alguien borrara un PDF en Supabase, la versión anterior sigue en `storage-history/`.
- Los PDF emitidos no cambian nunca (son la copia legal), así que la copia semanal solo añade los de la semana.
- El bucket de Spaces es **privado**, con claves de acceso propias del job (solo escritura en ese bucket) y con el cifrado en reposo del proveedor.

## 4. Conservación: al menos 6 años

- **Norma:** el art. 30 del Código de Comercio obliga a conservar libros, correspondencia, documentación y justificantes **seis años** desde el último asiento. La normativa tributaria (prescripción de 4 años, art. 66 LGT) queda cubierta dentro de ese plazo.
- **Calendario de retención:**

  | Copia | Se conserva |
  |---|---|
  | Diaria de Supabase | 7 días (o la ventana de PITR) |
  | `db/weekly/` | 3 meses |
  | `db/monthly/` | 2 años |
  | `db/yearly/` | 7 años desde el cierre del ejercicio (6 legales + 1 de margen) |
  | `storage/` | Siempre (no se borra nada) |
  | `storage-history/` | 7 años |

- La caducidad se configura con reglas de ciclo de vida del bucket de Spaces (por prefijo), no a mano.
- **Antes de borrar nada** (una regla de ciclo de vida que caduca), confirmar con la gestoría que el ejercicio está cerrado y sin inspecciones abiertas.

## 5. Prueba de restauración (cada trimestre)

Una copia que no se ha restaurado nunca no es una copia. Una vez por trimestre (sugerencia: la semana después de presentar el modelo 303), un owner sigue esta lista y apunta el resultado.

**Preparación**

- [ ] Proyecto de Supabase de pruebas (o Supabase local con `supabase start`), vacío.
- [ ] Clave privada de age a mano (del gestor de contraseñas).

**Base de datos**

- [ ] Descargar el último volcado semanal de Spaces y descifrarlo: `age --decrypt --identity clave.txt gnerai-os-AAAA-MM-DD.dump.age > restore.dump`.
- [ ] Restaurar: `pg_restore --no-owner --no-privileges --clean --if-exists -d "$STAGING_DB_URL" restore.dump`. Anotar cuánto tarda.
- [ ] Aplicar las migraciones que falten si el volcado es anterior a la última (`supabase migration up`).
- [ ] Comparar con producción (misma fecha de corte):
  - [ ] Número de clientes, contratos y facturas emitidas por emisor y año.
  - [ ] Último número de cada serie (`select * from public.series_counters('<org>')`).
  - [ ] Suma de la base imponible del último trimestre (el total del libro registro que se exporta en Ajustes → Datos).

**Ficheros**

- [ ] Copiar el bucket `invoices` desde `spaces:…/storage/invoices` al Storage de pruebas.
- [ ] Abrir cinco PDF al azar desde la app de pruebas y comprobar que son los emitidos (número, importe, fecha).

**Arranque**

- [ ] Arrancar la app contra el proyecto de pruebas (`.env.local` apuntando a él) y entrar con magic link.
- [ ] Exportar el libro registro del último trimestre y comparar sus totales con el de producción.

**Registro**

- [ ] Apuntar fecha, quién, cuánto tardó cada paso (objetivo: menos de 4 horas en total) y cualquier problema.
- [ ] Borrar el proyecto de pruebas y el volcado descifrado.

## 6. Qué hacer si pasa algo

| Situación | Qué se usa |
|---|---|
| Un error de datos de hace menos de 7 días (una migración mal hecha) | Backup diario de Supabase o PITR, al momento anterior |
| Se ha perdido el proyecto o la cuenta de Supabase | Proyecto nuevo + último `pg_dump` + copia de Storage (lista del §5) |
| Falta un PDF emitido en Storage | `storage/` o `storage-history/` de Spaces |
| Hace falta un dato de hace años (inspección) | `db/yearly/` o `db/monthly/` restaurado en un proyecto aparte |

Después de cualquier restauración en producción, comprobar el último número de cada serie antes de emitir: el contador nunca puede quedar por debajo de la última factura (la base de datos lo impide), pero sí por debajo de facturas que se hubieran emitido después de la copia.
