#!/usr/bin/env bash
# Trae a este ordenador las copias nocturnas del servidor y hace una copia completa de la base.
#
# Las copias del servidor viven en el MISMO servidor: si se pierde, se pierden con él. Esto las deja
# también fuera. SOLO COPIA: no borra nada, ni aquí ni en el servidor (rsync sin --delete). Se puede
# lanzar a mano o programar, p. ej. cada noche con `crontab -e`:
#   30 4 * * * cd /ruta/a/GNERAIOS && bash deploy/traer-copias.sh >> ~/GNERAI_copias/traer.log 2>&1
# Las copias antiguas se van acumulando: se limpian a mano cuando haga falta espacio.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=deploy/.env.production
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'; }
DEST="${GNERAI_COPIAS:-$HOME/GNERAI_copias}"
SSH_TARGET=$(get DEPLOY_SSH)
mkdir -p "$DEST/servidor" "$DEST/base"

# 1) Lo que guarda el servidor cada noche (tablas + ficheros de Storage).
rsync -a "$SSH_TARGET:/var/backups/gneraios/" "$DEST/servidor/"
echo "✓ copias del servidor en $DEST/servidor ($(ls "$DEST/servidor" | wc -l | tr -d ' ') días)"

# 2) Copia completa de la base (esquemas public, private, auth y storage), con pg_dump.
STAMP=$(date +%Y%m%d-%H%M%S)
pg_dump "$(get SUPABASE_DB_URL)" --format=custom --no-owner --schema=public --schema=private --schema=auth --schema=storage \
  --file="$DEST/base/gnerai-$STAMP.dump"
echo "✓ copia completa de la base: gnerai-$STAMP.dump ($(du -h "$DEST/base/gnerai-$STAMP.dump" | cut -f1))"
