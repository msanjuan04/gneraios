#!/usr/bin/env bash
# GNERAI OS · trae todos los datos del proyecto Supabase anterior al actual.
#
#   python3 scripts/configurar-proyecto-anterior.py   # una vez: guarda la conexión al antiguo
#   bash scripts/migrar-proyecto-anterior.sh           # copia datos, usuarios y códigos; luego Storage
#
# Qué hace, en orden y sin preguntar:
#   1. Comprueba que el destino es el proyecto autorizado y que está vacío (0 orgs; como mucho el
#      usuario provisional creado por prod:socios).
#   2. Respaldo del destino (pg_dump) en deploy/backups/.
#   3. Volcado SOLO DE DATOS del origen: esquemas public y private, y las tablas de Auth que
#      identifican a las personas (auth.users, auth.identities, auth.mfa_factors). Las sesiones no
#      se copian: cada uno vuelve a entrar con su código de siempre.
#   4. Carga en el destino en una sola transacción con session_replication_role = replica (los
#      triggers de negocio y las FK no se reevalúan: los datos ya eran válidos en el origen).
#   5. Compara el recuento de cada tabla entre origen y destino y para si algo no cuadra.
#   6. Copia los ficheros de Storage (scripts/copiar-storage-anterior.ts) si hay clave del origen.
#
# El esquema del destino es un superconjunto del origen (las migraciones nuevas solo añaden tablas y
# columnas opcionales), así que la carga no necesita transformar nada.

set -euo pipefail
cd "$(dirname "$0")/.."

NEW_ENV=deploy/.env.production
OLD_ENV=deploy/.env.anterior
NEW_REF=cnjroerndjuqocbitzye
OLD_REF=bxyutkqommdonnoiyozn

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
get() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2- || true; }
q() { PGCONNECT_TIMEOUT=15 psql "$1" -X -A -t -v ON_ERROR_STOP=1 -c "$2"; }

[ -f "$NEW_ENV" ] || fail "Falta $NEW_ENV."
[ -f "$OLD_ENV" ] || fail "Falta $OLD_ENV: ejecuta antes python3 scripts/configurar-proyecto-anterior.py"
command -v pg_dump >/dev/null && command -v psql >/dev/null || fail "Faltan pg_dump/psql."

NEW_DB=$(get "$NEW_ENV" SUPABASE_DB_URL)
OLD_DB=$(get "$OLD_ENV" OLD_DB_URL)
[[ "$NEW_DB" == *"$NEW_REF"* ]] || fail "SUPABASE_DB_URL de $NEW_ENV no es del proyecto $NEW_REF."
[[ "$OLD_DB" == *"$OLD_REF"* ]] || fail "OLD_DB_URL de $OLD_ENV no es del proyecto $OLD_REF."

say "Comprobaciones"
OLD_ORGS=$(q "$OLD_DB" "select count(*) from public.orgs")
OLD_USERS=$(q "$OLD_DB" "select count(*) from auth.users")
NEW_ORGS=$(q "$NEW_DB" "select count(*) from public.orgs")
NEW_USERS=$(q "$NEW_DB" "select count(*) from auth.users")
ok "Origen $OLD_REF: $OLD_ORGS org(s), $OLD_USERS usuario(s)"
ok "Destino $NEW_REF: $NEW_ORGS org(s), $NEW_USERS usuario(s)"
[ "$OLD_ORGS" -ge 1 ] || fail "El origen no tiene ninguna organización: nada que migrar."
if [ "$NEW_ORGS" -ne 0 ] && [ "${FORCE:-}" != 1 ]; then
  fail "El destino ya tiene datos ($NEW_ORGS org). No se mezcla nada; si de verdad quieres cargar encima, FORCE=1."
fi
[ "$NEW_USERS" -le 1 ] || [ "${FORCE:-}" = 1 ] || fail "El destino tiene $NEW_USERS usuarios de Auth; se esperaba como mucho el provisional."

mkdir -p deploy/backups && chmod 700 deploy/backups
STAMP=$(date +%Y%m%d%H%M%S)

say "Respaldo del destino"
NEW_BACKUP=deploy/backups/${NEW_REF}-antes-migracion-$STAMP.dump
pg_dump "$NEW_DB" --format=custom --no-owner --no-privileges --file "$NEW_BACKUP" || fail "No se pudo respaldar el destino; no se toca nada."
chmod 600 "$NEW_BACKUP"
ok "Respaldo en $NEW_BACKUP"

say "Volcado de datos del origen"
DATA=deploy/backups/${OLD_REF}-datos-$STAMP.sql
AUTH=deploy/backups/${OLD_REF}-auth-$STAMP.sql
# Esquemas de la app. Los intentos de acceso son ruido de seguridad: no se llevan.
pg_dump "$OLD_DB" --data-only --no-owner --no-privileges --schema=public --schema=private \
  --exclude-table=public.access_code_attempts --file "$DATA" || fail "Falló el volcado de public/private."
# Personas: usuarios, identidades y factores TOTP. Las sesiones y los retos MFA no se copian.
pg_dump "$OLD_DB" --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities --table=auth.mfa_factors --file "$AUTH" || fail "Falló el volcado de auth."
chmod 600 "$DATA" "$AUTH"
ok "Datos: $(du -h "$DATA" | cut -f1) · Auth: $(du -h "$AUTH" | cut -f1)"

say "Carga en el destino (una transacción)"
# El usuario provisional (prod:socios) sobraría y chocaría por email: fuera antes de cargar las personas
# reales. Se borra ANTES de entrar en modo réplica: así las FK en cascada (identidades, códigos,
# dispositivos) sí se ejecutan y no queda nada huérfano.
{
  echo "delete from auth.users;"
  echo "delete from public.access_codes;"
  echo "delete from public.trusted_devices;"
  echo "delete from auth.identities i where not exists (select 1 from auth.users u where u.id = i.user_id);"
  echo "set session_replication_role = replica;"
  cat "$AUTH"
  cat "$DATA"
  echo "analyze;"
} | psql "$NEW_DB" -X -q -v ON_ERROR_STOP=1 --single-transaction >deploy/migracion-$STAMP.log 2>&1 || {
  tail -20 "deploy/migracion-$STAMP.log" >&2
  fail "La carga falló y se deshizo entera (deploy/migracion-$STAMP.log). El destino sigue como antes."
}
ok "Cargado"

say "Comprobación tabla a tabla"
MISMATCH=0
while IFS='|' read -r schema table; do
  [ -n "$table" ] || continue
  [ "$schema.$table" = "public.access_code_attempts" ] && continue
  a=$(q "$OLD_DB" "select count(*) from $schema.\"$table\"")
  b=$(q "$NEW_DB" "select count(*) from $schema.\"$table\"")
  if [ "$a" != "$b" ]; then
    printf '  \033[31m✗\033[0m %-45s origen %s · destino %s\n' "$schema.$table" "$a" "$b"
    MISMATCH=1
  fi
done < <(q "$OLD_DB" "select schemaname || '|' || tablename from pg_tables where schemaname in ('public','private') order by 1")
for t in auth.users auth.identities auth.mfa_factors; do
  a=$(q "$OLD_DB" "select count(*) from $t"); b=$(q "$NEW_DB" "select count(*) from $t")
  [ "$a" = "$b" ] || { printf '  \033[31m✗\033[0m %-45s origen %s · destino %s\n' "$t" "$a" "$b"; MISMATCH=1; }
done
[ "$MISMATCH" = 0 ] || fail "Hay tablas que no cuadran (arriba). Revisa antes de usar la app."
ok "Todas las tablas cuadran con el origen ($(q "$NEW_DB" "select count(*) from public.clients") clientes, $(q "$NEW_DB" "select count(*) from public.invoices") facturas, $(q "$NEW_DB" "select count(*) from auth.users") personas)"
ok "Los códigos de acceso y dispositivos de confianza de siempre vuelven a valer"

if [ -n "$(get "$OLD_ENV" OLD_SUPABASE_SECRET_KEY)" ]; then
  say "Ficheros de Storage"
  node_modules/.bin/tsx scripts/copiar-storage-anterior.ts || fail "La copia de Storage no terminó bien (los datos ya están; repite solo esta parte)."
else
  printf '\n  \033[33m!\033[0m Sin OLD_SUPABASE_SECRET_KEY en %s: los ficheros de Storage (PDFs, adjuntos) no se han copiado.\n' "$OLD_ENV"
  echo "    Vuelve a ejecutar python3 scripts/configurar-proyecto-anterior.py con la clave y después:"
  echo "    node_modules/.bin/tsx scripts/copiar-storage-anterior.ts"
fi

say "Listo: $NEW_REF tiene los datos de $OLD_REF"
echo "  Entra en https://gneraios.gnerai.com con tu código de siempre."
