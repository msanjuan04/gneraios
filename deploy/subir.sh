#!/usr/bin/env bash
# GNERAI OS · subir a producción (https://gneraios.gnerai.com) en un solo paso, desde este Mac:
#
#   bash deploy/subir.sh
#
# 1. Base de datos. La primera vez crea el proyecto «gneraios» en Supabase (Frankfurt), en la
#    cuenta de GNERAI: pide un token de esa cuenta y deja que elijas la organización. Después, y en
#    cada subida, aplica las migraciones que falten.
# 2. App. La compila para el servidor con Docker (linux/amd64: el servidor no tiene memoria para
#    compilar) y la sube a root@46.101.185.148. Allí queda en /opt/gneraios, con pm2 («gneraios»,
#    puerto 3300), su sitio en nginx y el certificado HTTPS de Let's Encrypt. No toca los demás sitios.
# 3. Socios. La primera vez crea la org GNERAI y las cuentas y códigos de los tres socios, y guarda
#    los códigos en deploy/codigos-produccion.txt (solo en este Mac; bórralo cuando los tengáis).
#
# Se puede lanzar las veces que haga falta: las siguientes solo suben la versión nueva.
# Los secretos viven en deploy/.env.production (no se sube a git) y nunca se imprimen.

set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=deploy/.env.production
DOMAIN=gneraios.gnerai.com
PORT=3300
REGION=eu-central-1
CODES_FILE=deploy/codigos-produccion.txt
# Los tres socios (el primero crea la org). Sin email configurado, el email solo identifica la cuenta.
SOCIOS=("Marc Sanjuan <marcsanjuansard@gmail.com>" "Hugo Lago <hugo.lago@gnerai.test>" "Marc Cortada <marc.cortada@gnerai.test>")

export PATH="$HOME/.docker/bin:$PATH"
SUPABASE=(pnpm exec supabase)

say() { printf '\n\033[1;34m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() {
  printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
# put CLAVE VALOR: guarda en deploy/.env.production sin enseñarlo.
put() {
  python3 - "$ENV_FILE" "$1" "$2" <<'PY'
import re, sys
path, key, value = sys.argv[1:4]
text = open(path).read()
line = f"{key}={value}"
if re.search(rf"^{re.escape(key)}=", text, flags=re.M):
    text = re.sub(rf"^{re.escape(key)}=.*$", lambda _: line, text, flags=re.M)
else:
    text = text.rstrip("\n") + "\n" + line + "\n"
open(path, "w").write(text)
PY
}
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);$1})"; }

[ -f "$ENV_FILE" ] || fail "Falta $ENV_FILE."
SSH_TARGET=$(get DEPLOY_SSH)
[ -n "$SSH_TARGET" ] && [[ "$SSH_TARGET" != *PON_AQUI* ]] || fail "Falta DEPLOY_SSH en $ENV_FILE (p. ej. root@46.101.185.148)."

say "Comprobaciones"
docker info >/dev/null 2>&1 || fail "Docker no está en marcha: abre Docker Desktop y vuelve a lanzar el script."
ok "Docker en marcha"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" true || fail "No puedo entrar por SSH a $SSH_TARGET."
ok "Acceso al servidor ($SSH_TARGET)"

# --- 1. Base de datos --------------------------------------------------------------------------
REF=$(get SUPABASE_PROJECT_REF)
if [ -z "$REF" ]; then
  say "Base de datos: proyecto nuevo «gneraios» en Supabase"
  echo "  Necesito un token de la cuenta de Supabase de GNERAI (no la de ningún cliente)."
  echo "  Si GNERAI no tiene cuenta, créala antes en https://supabase.com (el plan gratis vale para probar)."
  echo "  Token: https://supabase.com/dashboard/account/tokens → Generate new token"
  echo "  (O deja vacío y pulsa Intro para usar la sesión de «pnpm exec supabase login», hecha antes con la cuenta de GNERAI.)"
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    printf "  Pega el token (no se ve al escribir) y pulsa Intro: "
    read -rs SUPABASE_ACCESS_TOKEN
    echo
  fi
  # Sin espacios ni restos del pegado; un token de Supabase empieza por sbp_.
  SUPABASE_ACCESS_TOKEN=$(printf '%s' "$SUPABASE_ACCESS_TOKEN" | tr -d '[:space:]' | sed $'s/\x1b\\[20[01]~//g')
  if [ -n "$SUPABASE_ACCESS_TOKEN" ]; then
    [[ "$SUPABASE_ACCESS_TOKEN" == sbp_* ]] || fail "Eso no parece un token de Supabase (empieza por sbp_). Vuelve a lanzar el script y pégalo cuando lo pida."
    export SUPABASE_ACCESS_TOKEN
  else
    unset SUPABASE_ACCESS_TOKEN
    echo "  Uso la sesión de la CLI de Supabase: comprueba abajo que las organizaciones son las de GNERAI."
  fi

  ORGS=$("${SUPABASE[@]}" orgs list -o json 2>deploy/supabase.log) || {
    grep -viE "new version|recommend updating" deploy/supabase.log | sed 's/^/  /' || true
    fail "Supabase no acepta ese token (arriba el motivo)."
  }
  COUNT=$(echo "$ORGS" | json 'const l=Array.isArray(j)?j:(j.organizations||[]); console.log(l.length)')
  ORG_ID=""
  ORG_NAME=""
  if [ "$COUNT" -gt 0 ]; then
    echo "  Organizaciones de esa cuenta:"
    echo "$ORGS" | json 'const l=Array.isArray(j)?j:(j.organizations||[]); l.forEach((o,i)=>console.log(`    ${i+1}. ${o.name}`))'
    CHOICE=1
    if [ "$COUNT" -gt 1 ]; then
      printf "  ¿En cuál creo el proyecto? (número): "
      read -r CHOICE
    fi
    export CHOICE
    ORG_ID=$(echo "$ORGS" | json 'const l=Array.isArray(j)?j:(j.organizations||[]); const o=l[Number(process.env.CHOICE)-1]; if(!o) process.exit(1); console.log(o.slug||o.id)') ||
      fail "Número de organización no válido."
    ORG_NAME=$(echo "$ORGS" | json 'const l=Array.isArray(j)?j:(j.organizations||[]); console.log(l[Number(process.env.CHOICE)-1].name)')
  elif [ -n "$(get SUPABASE_ORG_ID)" ]; then
    # La organización que se creó en una pasada anterior (el token no siempre la lista).
    ORG_ID=$(get SUPABASE_ORG_ID)
    echo "  Uso la organización de la vez anterior ($ORG_ID)."
  else
    # El token no enseña ninguna (cuenta nueva, otra cuenta o un token con permisos limitados).
    echo "  Con ese token Supabase no me enseña ninguna organización."
    echo "  Si ya tenéis una: ábrela en supabase.com y copia su ID de la dirección (supabase.com/dashboard/org/ESTE-ID)."
    printf "  Pega el ID de la organización, o deja vacío y pulsa Intro para crear una nueva «GNERAI» (gratis): "
    read -r ORG_ID
    ORG_ID=$(printf '%s' "$ORG_ID" | tr -d '[:space:]' | sed -E 's#.*/org/##; s#/.*##')
    if [ -z "$ORG_ID" ]; then
      "${SUPABASE[@]}" orgs create GNERAI -o json >deploy/supabase-org.json 2>deploy/supabase.log || {
        grep -viE "new version|recommend updating" deploy/supabase.log | sed 's/^/  /' || true
        fail "No he podido crear la organización (arriba el motivo)."
      }
      # La CLI contesta «Created organization: <id>» (o JSON, según la versión).
      ORG_ID=$(sed -nE 's/.*[Cc]reated organization:[[:space:]]*([a-z0-9]+).*/\1/p' deploy/supabase-org.json | head -1)
      [ -n "$ORG_ID" ] || ORG_ID=$(json 'console.log(j.slug||j.id)' <deploy/supabase-org.json 2>/dev/null || true)
      rm -f deploy/supabase-org.json
      [ -n "$ORG_ID" ] || fail "He creado la organización pero no sé su ID: vuelve a lanzar el script (ya saldrá en la lista)."
      ok "Organización GNERAI creada"
    fi
    ORG_NAME=$ORG_ID
  fi
  [ -n "$ORG_NAME" ] || ORG_NAME=$ORG_ID
  put SUPABASE_ORG_ID "$ORG_ID"
  printf "  Voy a crear «gneraios» (Frankfurt) en «%s». ¿Sigo? (s/N): " "$ORG_NAME"
  read -r YES
  [[ "$YES" =~ ^[sS] ]] || fail "Cancelado: no he creado nada."

  DB_PASSWORD=$(node -e 'console.log(require("crypto").randomBytes(24).toString("base64").replace(/[^A-Za-z0-9]/g,"").slice(0,28))')
  if ! CREATED=$("${SUPABASE[@]}" projects create gneraios --org-id "$ORG_ID" --db-password "$DB_PASSWORD" --region "$REGION" -o json 2>deploy/supabase.log); then
    grep -viE "new version|recommend updating" deploy/supabase.log | sed 's/^/  /' || true
    grep -q "Forbidden" deploy/supabase.log && echo "  Ese token no tiene permiso para crear proyectos: haz «pnpm exec supabase login» con la cuenta de GNERAI y vuelve a lanzar el script dejando el token vacío."
    fail "Supabase no ha dejado crear el proyecto (arriba el motivo; p. ej. el límite de 2 proyectos gratis por cuenta)."
  fi
  REF=$(echo "$CREATED" | json 'console.log(j.ref||j.id)')
  export REF
  put SUPABASE_PROJECT_REF "$REF"
  put SUPABASE_DB_PASSWORD "$DB_PASSWORD"
  ok "Proyecto creado: $REF (https://supabase.com/dashboard/project/$REF)"

  printf "  Esperando a que esté listo"
  for _ in $(seq 1 60); do
    STATUS=$("${SUPABASE[@]}" projects list -o json 2>/dev/null | json 'const l=j.projects||j; const p=l.find(p=>p.ref===process.env.REF||p.id===process.env.REF); console.log(p?p.status:"")' || true)
    [ "$STATUS" = "ACTIVE_HEALTHY" ] && break
    printf "."
    sleep 5
  done
  echo
  [ "$STATUS" = "ACTIVE_HEALTHY" ] || fail "El proyecto no ha arrancado a tiempo; vuelve a lanzar el script en un par de minutos."

  KEYS=$("${SUPABASE[@]}" projects api-keys --project-ref "$REF" -o json 2>/dev/null) || fail "No he podido leer las claves del proyecto."
  PUBLISHABLE=$(echo "$KEYS" | json 'const k=j.find(k=>k.type==="publishable")||j.find(k=>k.name==="anon"); console.log(k.api_key)')
  SECRET=$(echo "$KEYS" | json 'const k=j.find(k=>k.type==="secret")||j.find(k=>k.name==="service_role"); console.log(k.api_key)')
  put NEXT_PUBLIC_SUPABASE_URL "https://$REF.supabase.co"
  put NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$PUBLISHABLE"
  put SUPABASE_SECRET_KEY "$SECRET"
  unset PUBLISHABLE SECRET KEYS

  # Conexión por el pooler (IPv4) para las migraciones.
  POOLER=$(curl -fsS -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-none}" "https://api.supabase.com/v1/projects/$REF/config/database/pooler" 2>/dev/null |
    json 'const l=Array.isArray(j)?j:[j]; const p=l.find(p=>p.database_type==="PRIMARY")||l[0]; console.log(`${p.db_user}@${p.db_host}:${p.db_port===6543?5432:p.db_port}/${p.db_name}`)' || true)
  [ -n "$POOLER" ] || POOLER="postgres.$REF@aws-0-$REGION.pooler.supabase.com:5432/postgres"
  put SUPABASE_DB_URL "postgresql://${POOLER%%@*}:$DB_PASSWORD@${POOLER#*@}"
  unset DB_PASSWORD

  # Acceso: nadie de fuera puede darse de alta; los enlaces de Supabase apuntan al dominio.
  if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && curl -fsS -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"disable_signup\": true, \"site_url\": \"https://$DOMAIN\", \"uri_allow_list\": \"https://$DOMAIN/auth/confirm\"}" >/dev/null 2>&1; then
    ok "Altas cerradas y URL del sitio configurada"
  else
    echo "  ⚠️  No he podido cerrar las altas: en Supabase → Authentication → Sign In / Providers, desactiva «Allow new users to sign up»."
  fi
  unset SUPABASE_ACCESS_TOKEN || true
fi

for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do
  value=$(get "$key")
  [ -n "$value" ] && [[ "$value" != *PON_AQUI* ]] || fail "Falta $key en $ENV_FILE."
done

say "Base de datos: migraciones"
DB_URL=$(get SUPABASE_DB_URL)
LINKED=""
if [ -n "$DB_URL" ] && [[ "$DB_URL" != *PON_AQUI* ]]; then
  PUSH=("${SUPABASE[@]}" db push --db-url "$DB_URL" --yes)
else
  # Sin la contraseña de la base de datos: la CLI entra con la sesión de «supabase login».
  echo "  Si te pide la contraseña de la base de datos y no la sabes, deja vacío y pulsa Intro."
  "${SUPABASE[@]}" link --project-ref "$REF" || fail "No he podido enlazar el proyecto $REF (¿hiciste «pnpm exec supabase login» con la cuenta de GNERAI?)."
  LINKED=1
  PUSH=("${SUPABASE[@]}" db push --linked --yes)
fi
if "${PUSH[@]}" 2>&1 | grep --line-buffered -viE "new version|recommend updating" | tee deploy/db-push.log | sed 's/^/  /'; then
  :
else
  [ -z "$LINKED" ] || "${SUPABASE[@]}" unlink --yes >/dev/null 2>&1 || true
  fail "Las migraciones han fallado (arriba el error; completo en deploy/db-push.log)."
fi
[ -z "$LINKED" ] || "${SUPABASE[@]}" unlink --yes >/dev/null 2>&1 || true
unset DB_URL
ok "Base de datos al día"

# --- 2. App ------------------------------------------------------------------------------------
say "App: compilando para el servidor (unos minutos)"
rm -rf deploy/out
docker build --platform linux/amd64 --target bundle --output type=local,dest=deploy/out \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$(get NEXT_PUBLIC_SUPABASE_URL)" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)" \
  --build-arg NEXT_PUBLIC_APP_URL="$(get NEXT_PUBLIC_APP_URL)" \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="$(get NEXT_PUBLIC_VAPID_PUBLIC_KEY)" \
  . >deploy/build.log 2>&1 || fail "La compilación ha fallado: mira deploy/build.log."
[ -f deploy/out/server.js ] || fail "La compilación no ha dejado server.js (mira deploy/build.log)."
ok "Compilada ($(du -sh deploy/out | cut -f1))"

say "App: subiendo a $SSH_TARGET"
RELEASE=/opt/gneraios/releases/$(date +%Y%m%d%H%M%S)
ssh "$SSH_TARGET" "mkdir -p $RELEASE"
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C deploy/out -czf - . | ssh "$SSH_TARGET" "tar -C $RELEASE -xzf - 2>/dev/null"
# Variables de ejecución (sin las que solo sirven para desplegar), con permisos 600.
grep -vE '^(#|$|DEPLOY_SSH=|SUPABASE_DB_URL=|SUPABASE_DB_PASSWORD=|SUPABASE_PROJECT_REF=|SUPABASE_ORG_ID=)' "$ENV_FILE" |
  ssh "$SSH_TARGET" "umask 077 && cat > /etc/gneraios.env"
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

# --- 3. Socios ---------------------------------------------------------------------------------
if [ ! -f "$CODES_FILE" ]; then
  say "Socios: org GNERAI y códigos de acceso"
  ARGS=()
  for socio in "${SOCIOS[@]}"; do ARGS+=(--socio "$socio"); done
  pnpm exec tsx --env-file="$ENV_FILE" scripts/prod-socios.mts --org gnerai --create-org "GNERAI" "${ARGS[@]}" --yes --out "$CODES_FILE" ||
    fail "No he podido crear los socios (la app ya está subida: vuelve a lanzar el script)."
  open -e "$CODES_FILE" 2>/dev/null || true
fi

say "Listo: https://$DOMAIN"
echo "  Revisa en Supabase (proyecto $REF) → Authentication → Sign In / Providers que «Allow new users to sign up» está desactivado."
echo "  Cada socio entra escribiendo su código (están en $CODES_FILE; bórralo cuando los tengáis)."
