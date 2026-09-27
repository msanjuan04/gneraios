# check=skip=FromPlatformFlagConstDisallowed
#
# GNERAI OS · Next.js en modo standalone para producción (linux/amd64).
#
#   Bundle para el droplet (lo hace deploy/build.sh):
#     docker build --platform linux/amd64 --target bundle --output type=local,dest=deploy/out \
#       --build-arg NEXT_PUBLIC_SUPABASE_URL=… (y el resto de ARG NEXT_PUBLIC_* de abajo) .
#   Imagen ejecutable (la etapa final, la de por defecto):
#     docker build --platform linux/amd64 -t gneraios --build-arg … .
#     docker run --rm -p 3000:3000 --env-file <variables de ejecución> gneraios
#
# Las NEXT_PUBLIC_* se incrustan en el JavaScript al compilar: son build args, no variables de
# ejecución. Los secretos solo se leen al arrancar y nunca entran en la imagen ni en el bundle.
# La plataforma va fija porque el bundle lleva binarios nativos (p. ej. sharp) para el servidor.

FROM --platform=linux/amd64 node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# --- Dependencias ------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm en la versión exacta de `packageManager` (package.json), vía corepack.
RUN corepack enable && corepack install
# Sin scripts de instalación: la build no necesita el binario de la CLI de Supabase ni el de esbuild.
RUN --mount=type=cache,id=gneraios-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm/store

# --- Build -------------------------------------------------------------------
FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
RUN : "${NEXT_PUBLIC_SUPABASE_URL:?falta --build-arg NEXT_PUBLIC_SUPABASE_URL}" \
      "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?falta --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}" \
      "${NEXT_PUBLIC_APP_URL:?falta --build-arg NEXT_PUBLIC_APP_URL}" \
      "${NEXT_PUBLIC_VAPID_PUBLIC_KEY:?falta --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY}" \
 && pnpm build
# Los prompts del consejo se leen del disco al ejecutar: que no falte ninguno en el standalone
# (outputFileTracingIncludes en next.config.ts). La lista sale del código, no se repite aquí.
RUN test -f .next/standalone/server.js \
 && for f in $(find src/council/agents -name '*.md'); do \
      [ -f ".next/standalone/$f" ] || { echo "Falta $f en .next/standalone: revisa outputFileTracingIncludes" >&2; exit 1; }; \
    done

# --- Bundle: solo la app lista para `node server.js` --------------------------
# Se exporta con `--target bundle --output type=local,dest=…` y se sube tal cual al servidor.
FROM scratch AS bundle
COPY --from=build /app/.next/standalone /
COPY --from=build /app/.next/static /.next/static
COPY --from=build /app/public /public

# --- Runtime -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=bundle --chown=node:node / /app/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
