#!/usr/bin/env python3
"""Configura la conexión SQL de cnjroerndjuqocbitzye sin mostrar la contraseña."""

from getpass import getpass
from pathlib import Path
from subprocess import run, TimeoutExpired
from urllib.parse import quote
import os
import shutil
import sys
import tempfile


REF = "cnjroerndjuqocbitzye"
ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env.local"


def main() -> int:
    if not ENV.is_file():
        print("Falta .env.local en la raíz del proyecto.")
        return 1
    if not shutil.which("psql"):
        print("Falta psql para verificar la conexión.")
        return 1

    password = getpass("Contraseña de la base de datos de cnjroerndjuqocbitzye: ")
    if not password:
        print("Sin contraseña; no se modificó .env.local.")
        return 1

    uri = (
        f"postgresql://postgres:{quote(password, safe='')}"
        f"@db.{REF}.supabase.co:5432/postgres?sslmode=require"
    )
    try:
        result = run(
            ["psql", uri, "-X", "-A", "-t", "-c", "select 1"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except TimeoutExpired:
        print("La conexión tardó demasiado; no se modificó .env.local.")
        return 1
    if result.returncode or result.stdout.strip() != "1":
        print("Supabase rechazó la conexión. Revisa la contraseña; no se modificó .env.local.")
        return 1

    # La contraseña suelta ya no hace falta: conservar solo la URL validada.
    lines = [line for line in ENV.read_text().splitlines() if not line.startswith("SUPABASE_DB_PASSWORD=")]
    entry = f"SUPABASE_DB_URL={uri}"
    replaced = False
    for index, line in enumerate(lines):
        if line.startswith("SUPABASE_DB_URL="):
            lines[index] = entry
            replaced = True
            break
    if not replaced:
        lines.append(entry)

    fd, name = tempfile.mkstemp(prefix=".env.local.", dir=ROOT)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            stream.write("\n".join(lines) + "\n")
        os.replace(name, ENV)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print("Conexión SQL verificada y guardada en .env.local; contraseña suelta retirada.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
