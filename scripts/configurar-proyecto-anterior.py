#!/usr/bin/env python3
"""Guarda, sin enseñarla, la conexión SQL del proyecto Supabase anterior (bxyutkqommdonnoiyozn)
en deploy/.env.anterior para poder traer sus datos. Verifica la contraseña antes de guardarla."""

from getpass import getpass
from pathlib import Path
from subprocess import run, TimeoutExpired
from urllib.parse import quote
import os
import shutil
import sys
import tempfile


REF = "bxyutkqommdonnoiyozn"
ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / "deploy" / ".env.anterior"


def main() -> int:
    if not shutil.which("psql"):
        print("Falta psql para verificar la conexión.")
        return 1

    password = getpass(f"Contraseña de la base de datos de {REF} (no se ve al escribir): ")
    if not password:
        print("Sin contraseña; no se guardó nada.")
        return 1
    secret = getpass(f"Clave secreta (sb_secret_… o service_role) de {REF}, para copiar los ficheros de Storage [Intro para saltar]: ")

    uri = f"postgresql://postgres:{quote(password, safe='')}@db.{REF}.supabase.co:5432/postgres?sslmode=require"
    try:
        result = run(["psql", uri, "-X", "-A", "-t", "-c", "select count(*) from public.orgs"], capture_output=True, text=True, timeout=20, check=False)
    except TimeoutExpired:
        print("La conexión tardó demasiado; no se guardó nada.")
        return 1
    if result.returncode:
        print("Supabase rechazó la conexión. Revisa la contraseña; no se guardó nada.")
        return 1
    print(f"Conexión verificada: {result.stdout.strip()} organización(es) en el proyecto anterior.")

    lines = [f"OLD_SUPABASE_REF={REF}", f"OLD_DB_URL={uri}", f"OLD_SUPABASE_URL=https://{REF}.supabase.co"]
    if secret:
        lines.append(f"OLD_SUPABASE_SECRET_KEY={secret}")
    ENV.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".env.anterior.", dir=ENV.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write("\n".join(lines) + "\n")
        os.replace(name, ENV)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print(f"Guardado en {ENV.relative_to(ROOT)} (solo tu usuario puede leerlo; git lo ignora).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
