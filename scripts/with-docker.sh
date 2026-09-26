#!/bin/sh
# Ejecuta un comando (la CLI de Supabase) contra el Docker de esta máquina.
# Docker Desktop en Mac instala su CLI en ~/.docker/bin (a veces fuera del PATH)
# y no siempre crea /var/run/docker.sock. Con OrbStack o Linux no cambia nada.
if ! command -v docker >/dev/null 2>&1 && [ -x "$HOME/.docker/bin/docker" ]; then
  export PATH="$HOME/.docker/bin:$PATH"
fi
if [ -z "$DOCKER_HOST" ] && [ ! -S /var/run/docker.sock ] && [ -S "$HOME/.docker/run/docker.sock" ]; then
  export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
fi
exec "$@"
