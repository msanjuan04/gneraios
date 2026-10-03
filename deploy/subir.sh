#!/usr/bin/env bash
# GNERAI OS · subir a producción (https://gneraios.gnerai.com) en un solo paso, desde este Mac:
#
#   bash deploy/subir.sh
#
# 1. Base de datos. Usa exclusivamente el proyecto Supabase autorizado y aplica las migraciones
#    pendientes tras verificar credenciales y hacer respaldo.
# 2. App. La compila para el servidor con Docker (linux/amd64: el servidor no tiene memoria para
#    compilar) y la sube a root@46.101.185.148. Allí queda en /opt/gneraios, con pm2 («gneraios»,
#    puerto 3300), su sitio en nginx y el certificado HTTPS de Let's Encrypt. No toca los demás sitios.
# 3. Equipo. La provisión de usuarios se hace aparte tras auditar la organización existente:
#    desplegar código no debe inventar correos ni sobrescribir accesos.
#
# Se puede lanzar las veces que haga falta: las siguientes solo suben la versión nueva.
# Los secretos viven en deploy/.env.production (no se sube a git) y nunca se imprimen.

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=deploy/.env.production
DOMAIN=gneraios.gnerai.com
PORT=3300
EXPECTED_SUPABASE_REF=cnjroerndjuqocbitzye

export PATH="$HOME/.docker/bin:$PATH"
# La CLI de Supabase fijada en el repo (la de Homebrew puede no entender supabase/config.toml).
if [ -x node_modules/.bin/supabase ]; then SUPABASE=(node_modules/.bin/supabase); else SUPABASE=(pnpm exec supabase); fi

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() {
  printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
[ -f "$ENV_FILE" ] || fail "Falta $ENV_FILE."
REF=$(get SUPABASE_PROJECT_REF)
[ "$REF" = "$EXPECTED_SUPABASE_REF" ] || fail "SUPABASE_PROJECT_REF debe ser $EXPECTED_SUPABASE_REF; no se creará ni usará otro proyecto."
[ "$(get NEXT_PUBLIC_SUPABASE_URL)" = "https://$REF.supabase.co" ] || fail "NEXT_PUBLIC_SUPABASE_URL no coincide con $REF."
SSH_TARGET=$(get DEPLOY_SSH)
[ -n "$SSH_TARGET" ] && [[ "$SSH_TARGET" != *PON_AQUI* ]] || fail "Falta DEPLOY_SSH en $ENV_FILE (p. ej. root@46.101.185.148)."

say "Comprobaciones"
# Con Docker se compila en linux/amd64; sin él, en este Mac (el bundle no lleva binarios nativos:
# se comprueba antes de subirlo).
if docker info >/dev/null 2>&1; then
  BUILD=docker
  ok "Docker en marcha"
else
  BUILD=local
  ok "Sin Docker: se compila en local (standalone, sin dependencias nativas)"
fi
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" true || fail "No puedo entrar por SSH a $SSH_TARGET."
ok "Acceso al servidor ($SSH_TARGET)"

# --- 1. Base de datos: solo proyecto existente autorizado. ------------------------------

for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do
  value=$(get "$key")
  [ -n "$value" ] && [[ "$value" != *PON_AQUI* ]] || fail "Falta $key en $ENV_FILE."
done

DB_URL=$(get SUPABASE_DB_URL)
[ -n "$DB_URL" ] && [[ "$DB_URL" != *PON_AQUI* ]] && [[ "$DB_URL" != *'[YOUR-PASSWORD]'* ]] || fail "Falta SUPABASE_DB_URL de $REF en $ENV_FILE."
python3 - "$DB_URL" "$REF" <<'PY' || fail "SUPABASE_DB_URL no corresponde al proyecto autorizado."
import sys
from urllib.parse import urlparse

url, ref = sys.argv[1:]
parsed = urlparse(url)
direct = parsed.hostname == f"db.{ref}.supabase.co" and parsed.username == "postgres"
pooler = (parsed.hostname or "").endswith(".pooler.supabase.com") and parsed.username == f"postgres.{ref}"
if parsed.scheme not in ("postgres", "postgresql") or not (direct or pooler) or not parsed.password:
    raise SystemExit(1)
PY
command -v pg_dump >/dev/null 2>&1 || fail "Falta pg_dump para el respaldo obligatorio previo a migrar."
mkdir -p deploy/backups
chmod 700 deploy/backups
BACKUP=deploy/backups/${REF}-$(date +%Y%m%d%H%M%S).dump
say "Base de datos: respaldo previo"
pg_dump "$DB_URL" --format=custom --no-owner --no-privileges --file "$BACKUP" || fail "No se pudo completar el respaldo; no se aplicaron migraciones."
chmod 600 "$BACKUP"
ok "Respaldo guardado en $BACKUP"

say "Base de datos: migraciones"
if "${SUPABASE[@]}" db push --db-url "$DB_URL" --yes 2>&1 | grep --line-buffered -viE "new version|recommend updating" | tee deploy/db-push.log | sed 's/^/  /'; then
  :
else
  fail "Las migraciones han fallado (arriba el error; completo en deploy/db-push.log)."
fi
unset DB_URL
ok "Base de datos al día"

# --- 2. App ------------------------------------------------------------------------------------
say "App: compilando para el servidor (unos minutos)"
# REUSE_BUILD=1 vuelve a subir el deploy/out que ya hay (p. ej. tras un fallo al subir).
if [ "${REUSE_BUILD:-}" = 1 ] && [ -f deploy/out/server.js ]; then
  ok "Reutilizo deploy/out (REUSE_BUILD=1)"
else
rm -rf deploy/out
if [ "$BUILD" = docker ]; then
  docker build --platform linux/amd64 --target bundle --output type=local,dest=deploy/out \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$(get NEXT_PUBLIC_SUPABASE_URL)" \
    --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)" \
    --build-arg NEXT_PUBLIC_APP_URL="$(get NEXT_PUBLIC_APP_URL)" \
    --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="$(get NEXT_PUBLIC_VAPID_PUBLIC_KEY)" \
    . >deploy/build.log 2>&1 || fail "La compilación ha fallado: mira deploy/build.log."
else
  # Mismo resultado que la etapa «bundle» del Dockerfile: standalone + .next/static + public.
  # Las NEXT_PUBLIC_* se incrustan al compilar: van del fichero de producción, no de .env.local.
  rm -rf .next
  env NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=4096 \
    NEXT_PUBLIC_SUPABASE_URL="$(get NEXT_PUBLIC_SUPABASE_URL)" \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)" \
    NEXT_PUBLIC_APP_URL="$(get NEXT_PUBLIC_APP_URL)" \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY="$(get NEXT_PUBLIC_VAPID_PUBLIC_KEY)" \
    node_modules/.bin/next build --webpack >deploy/build.log 2>&1 || fail "La compilación ha fallado: mira deploy/build.log."
  mkdir -p deploy/out/.next/static deploy/out/public
  cp -R .next/standalone/. deploy/out/
  cp -R .next/static/. deploy/out/.next/static/
  cp -R public/. deploy/out/public/
  for f in $(find src/council/agents -name '*.md'); do
    [ -f "deploy/out/$f" ] || fail "Falta $f en el standalone: revisa outputFileTracingIncludes."
  done
fi
fi
[ -f deploy/out/server.js ] || fail "La compilación no ha dejado server.js (mira deploy/build.log)."

# PDF: pdfkit (el motor de react-pdf) carga sus fuentes estándar con require() y el trazado de
# ficheros de Next solo se lleva la versión .mjs, así que en el servidor ninguna factura, presupuesto
# o propuesta se generaba («Cannot find module .../standard-fonts/Helvetica.cjs»). Se completa la
# carpeta con la del proyecto y se comprueba, con el propio bundle, que un PDF sale de verdad.
PDFKIT_SRC=$(ls -d node_modules/.pnpm/pdfkit@*/node_modules/pdfkit 2>/dev/null | head -1 || true)
for dest in deploy/out/node_modules/.pnpm/pdfkit@*/node_modules/pdfkit; do
  [ -d "$dest" ] && [ -n "$PDFKIT_SRC" ] && cp -R "$PDFKIT_SRC/js/." "$dest/js/"
done
REACT_DIR=$(ls -d deploy/out/node_modules/.pnpm/react@*/node_modules/react 2>/dev/null | head -1 || true)
if [ -n "$REACT_DIR" ] && ls -d deploy/out/node_modules/@react-pdf >/dev/null 2>&1; then
  cat >deploy/out/.smoke-pdf.mjs <<'JS'
import { createRequire } from "node:module";
const React = createRequire(process.cwd() + "/")(process.env.REACT_DIR);
const rp = await import("@react-pdf/renderer");
const doc = React.createElement(rp.Document, null, React.createElement(rp.Page, null, React.createElement(rp.Text, null, "prueba")));
const pdf = await rp.renderToBuffer(doc);
if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("no es un PDF");
JS
  ( cd deploy/out && REACT_DIR="$PWD/../../$REACT_DIR" node .smoke-pdf.mjs ) >deploy/smoke-pdf.log 2>&1 \
    || { tail -8 deploy/smoke-pdf.log >&2; rm -f deploy/out/.smoke-pdf.mjs; fail "Con este bundle no se generan PDFs: no se sube (deploy/smoke-pdf.log)."; }
  rm -f deploy/out/.smoke-pdf.mjs
  ok "PDF: el bundle genera PDFs"
fi

# sharp (next/image) es el único paquete con binarios por plataforma: si el bundle lleva los de
# macOS, se cambian por los de linux-x64 del registro npm, en la misma estructura pnpm del standalone.
SHARP_PKG=$(ls -d deploy/out/node_modules/.pnpm/sharp@*/ 2>/dev/null | head -1 || true)
if [ -n "$SHARP_PKG" ] && ls -d deploy/out/node_modules/.pnpm/@img+sharp-darwin-* >/dev/null 2>&1; then
  SHARP_VERSION=$(node -p "require('./${SHARP_PKG}node_modules/sharp/package.json').version")
  SHARP_TMP=$(mktemp -d)
  (cd "$SHARP_TMP" && npm init -y >/dev/null 2>&1 &&
    npm install --no-save --no-audit --no-fund --ignore-scripts --os=linux --cpu=x64 --libc=glibc "sharp@$SHARP_VERSION" >/dev/null 2>&1) ||
    fail "No se pudieron descargar los binarios linux-x64 de sharp@$SHARP_VERSION."
  for p in sharp-linux-x64 sharp-libvips-linux-x64; do
    ver=$(node -p "require('$SHARP_TMP/node_modules/@img/$p/package.json').version")
    mkdir -p "deploy/out/node_modules/.pnpm/@img+$p@$ver/node_modules/@img"
    cp -R "$SHARP_TMP/node_modules/@img/$p" "deploy/out/node_modules/.pnpm/@img+$p@$ver/node_modules/@img/"
    ln -sfn "../../../@img+$p@$ver/node_modules/@img/$p" "${SHARP_PKG}node_modules/@img/$p"
  done
  LIBVIPS_VERSION=$(node -p "require('$SHARP_TMP/node_modules/@img/sharp-libvips-linux-x64/package.json').version")
  ln -sfn "../../../@img+sharp-libvips-linux-x64@$LIBVIPS_VERSION/node_modules/@img/sharp-libvips-linux-x64" \
    "deploy/out/node_modules/.pnpm/@img+sharp-linux-x64@$SHARP_VERSION/node_modules/@img/sharp-libvips-linux-x64"
  rm -rf "$SHARP_TMP" deploy/out/node_modules/.pnpm/@img+sharp-darwin-* deploy/out/node_modules/.pnpm/@img+sharp-libvips-darwin-*
  find "${SHARP_PKG}node_modules/@img" -maxdepth 1 -name '*darwin*' -exec rm -f {} +
  ok "sharp: binarios linux-x64 $SHARP_VERSION (libvips $LIBVIPS_VERSION)"
fi
if find deploy/out -name '*.node' | grep -vE 'linux-x64' | grep -q .; then
  fail "El bundle lleva binarios nativos que no son linux-x64; compila con Docker (linux/amd64)."
fi
ok "Compilada ($(du -sh deploy/out | cut -f1))"

# Arranque de prueba en este Mac antes de subirlo: el bundle responde a /api/health con las
# variables de producción (sin tocar la base: health no escribe).
say "App: arranque de prueba del bundle"
SMOKE_PORT=3399
( set -a; . "$ENV_FILE"; set +a; cd deploy/out && NODE_ENV=production PORT=$SMOKE_PORT HOSTNAME=127.0.0.1 exec node server.js ) >deploy/smoke.log 2>&1 &
SMOKE_PID=$!
SMOKE_OK=0
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$SMOKE_PORT/api/health" >/dev/null 2>&1 && { SMOKE_OK=1; break; }
  sleep 1
done
kill "$SMOKE_PID" >/dev/null 2>&1 || true
wait "$SMOKE_PID" 2>/dev/null || true
[ "$SMOKE_OK" = 1 ] || { tail -20 deploy/smoke.log >&2; fail "El bundle no responde en local: no se sube (deploy/smoke.log)."; }
ok "El bundle arranca y responde"

say "App: subiendo a $SSH_TARGET"
RELEASE=/opt/gneraios/releases/$(date +%Y%m%d%H%M%S)
ssh "$SSH_TARGET" "mkdir -p $RELEASE"
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C deploy/out -czf - . | ssh "$SSH_TARGET" "tar -C $RELEASE -xzf - 2>/dev/null"
# Variables de ejecución (sin las que solo sirven para desplegar), con permisos 600. Las que solo
# viven en el servidor (proveedor de email, política de acceso) se conservan si aquí no se dan.
grep -vE '^(#|$|DEPLOY_SSH=|SUPABASE_DB_URL=|SUPABASE_DB_PASSWORD=|SUPABASE_PROJECT_REF=|SUPABASE_ORG_ID=)' "$ENV_FILE" |
  ssh "$SSH_TARGET" 'umask 077 && cat > /etc/gneraios.env.new && for key in BREVO_API_KEY RESEND_API_KEY AUTH_MFA_REQUIRED AUTH_DEVICE_CONFIRMATION; do
    grep -q "^$key=" /etc/gneraios.env.new || grep "^$key=" /etc/gneraios.env 2>/dev/null >> /etc/gneraios.env.new || true
  done && mv /etc/gneraios.env.new /etc/gneraios.env'
ok "Subida a $RELEASE"

ssh "$SSH_TARGET" bash -s -- "$RELEASE" "$PORT" "$DOMAIN" <<'REMOTE'
set -euo pipefail
RELEASE=$1
PORT=$2
DOMAIN=$3

ln -sfn "$RELEASE" /opt/gneraios/current
cat >/opt/gneraios/run.sh <<EOF
#!/usr/bin/env bash
set -a
. /etc/gneraios.env
set +a
export NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 NODE_OPTIONS=--max-old-space-size=384
cd /opt/gneraios/current
exec node server.js
EOF
chmod 700 /opt/gneraios/run.sh

if pm2 describe gneraios >/dev/null 2>&1; then
  pm2 restart gneraios --update-env >/dev/null
else
  pm2 start /opt/gneraios/run.sh --name gneraios --interpreter bash >/dev/null
fi
pm2 save >/dev/null
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { pm2 logs gneraios --lines 40 --nostream; exit 1; }
echo "  ✓ App en marcha en el servidor (pm2 «gneraios», puerto $PORT)"

# Tareas programadas (hora del servidor: Europe/Madrid). Cada una llama a /api/cron/<trabajo> de la
# app con CRON_SECRET; «watchdog» reinicia la app si deja de responder. Registro en
# /var/log/gneraios/cron.log. Copias nocturnas en /var/backups/gneraios (BACKUP_DIR).
mkdir -p /var/log/gneraios /var/backups/gneraios
chmod 700 /var/backups/gneraios
cat >/opt/gneraios/cron.sh <<'CRONSH'
#!/usr/bin/env bash
# GNERAI OS · tareas programadas del servidor (deploy/subir.sh). Uso: cron.sh <trabajo>
set -uo pipefail
JOB=${1:?falta el trabajo}
set -a
. /etc/gneraios.env
set +a
LOG=/var/log/gneraios/cron.log
BASE=http://127.0.0.1:@PORT@
stamp() { date '+%Y-%m-%d %H:%M:%S'; }
if [ "$JOB" = watchdog ]; then
  for _ in 1 2 3; do
    curl -fsS -m 10 "$BASE/api/health" >/dev/null 2>&1 && exit 0
    sleep 10
  done
  echo "$(stamp) watchdog: la app no responde, la reinicio" >>"$LOG"
  pm2 restart gneraios >/dev/null 2>&1
  exit 0
fi
OUT=/tmp/gneraios-cron-$JOB.json
CODE=$(curl -sS -m 290 -X POST -H "Authorization: Bearer $CRON_SECRET" -o "$OUT" -w '%{http_code}' "$BASE/api/cron/$JOB" 2>/dev/null || echo 000)
echo "$(stamp) $JOB $CODE $(head -c 300 "$OUT" 2>/dev/null | tr '\n' ' ')" >>"$LOG"
CRONSH
sed -i "s/@PORT@/$PORT/" /opt/gneraios/cron.sh
chmod 700 /opt/gneraios/cron.sh

SITES_LINE=""
if [ -d /opt/gneraios/current/.next/server/app/api/cron/sites ]; then
  SITES_LINE="*/5 * * * * root /opt/gneraios/cron.sh sites"
fi
MAIL_LINE=""
if [ -d /opt/gneraios/current/.next/server/app/api/cron/mail ]; then
  MAIL_LINE="*/5 * * * * root /opt/gneraios/cron.sh mail"
fi
cat >/etc/cron.d/gneraios <<CRONTAB
# GNERAI OS (deploy/subir.sh). Hora del servidor (Europe/Madrid).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/2 * * * * root /opt/gneraios/cron.sh push
*/5 * * * * root /opt/gneraios/cron.sh watchdog
30 6 * * * root /opt/gneraios/cron.sh daily
30 7 * * * root /opt/gneraios/cron.sh seo
15 * * * * root /opt/gneraios/cron.sh council
0 7 * * 1 root /opt/gneraios/cron.sh weekly
45 3 * * * root /opt/gneraios/cron.sh backup
$SITES_LINE
$MAIL_LINE
CRONTAB
chmod 644 /etc/cron.d/gneraios

# Registros de gneraios (los de las demás apps no se tocan).
cat >/etc/logrotate.d/gneraios <<'ROTATE'
/var/log/gneraios/*.log /root/.pm2/logs/gneraios-*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
ROTATE
echo "  ✓ Tareas programadas, copias nocturnas y vigilancia"

SITE=/etc/nginx/sites-available/$DOMAIN
if [ ! -f "$SITE" ]; then
  cat >"$SITE" <<EOF
# GNERAI OS (deploy/subir.sh). La app escucha en 127.0.0.1:$PORT.
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        # Se sobrescribe (no se añade): la app limita los intentos de entrada por esta IP.
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        # Las cookies de sesión de Supabase van troceadas y, al refrescarse, la respuesta trae varias
        # Set-Cookie largas: con los 4k por defecto nginx devolvía 502 («upstream sent too big header»).
        proxy_buffer_size 32k;
        proxy_buffers 8 32k;
        proxy_busy_buffers_size 64k;
    }
}
EOF
  ln -sfn "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
  if ! nginx -t >/dev/null 2>&1; then
    rm -f "/etc/nginx/sites-enabled/$DOMAIN" "$SITE"
    nginx -t
    echo "  ✗ La configuración de nginx no era válida: la he quitado sin recargar (los demás sitios siguen igual)." >&2
    exit 1
  fi
  systemctl reload nginx
  echo "  ✓ Sitio $DOMAIN en nginx"
fi

if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect >/dev/null 2>&1 ||
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect --register-unsafely-without-email
  echo "  ✓ Certificado HTTPS"
fi

# Se guardan las 5 últimas versiones (para volver atrás: ln -sfn <versión> /opt/gneraios/current y pm2 restart gneraios).
ls -1dt /opt/gneraios/releases/* | tail -n +6 | xargs -r rm -rf
REMOTE

printf "  Comprobando https://%s" "$DOMAIN"
for _ in $(seq 1 20); do
  curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1 && break
  printf "."
  sleep 2
done
echo
curl -fsS "https://$DOMAIN/api/health" >/dev/null || fail "https://$DOMAIN no responde todavía (mira: ssh $SSH_TARGET pm2 logs gneraios)."
ok "https://$DOMAIN responde"

say "Listo: https://$DOMAIN"
echo "  Revisa en Supabase (proyecto $REF) → Authentication → Sign In / Providers que «Allow new users to sign up» está desactivado."
echo "  Verifica la organización y los tres accesos operativos existentes; este script no crea usuarios."
