#!/usr/bin/env python3
"""Daily logical backup of only tomasini_prod; keeps fourteen completed daily backups."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import subprocess

BASE = Path('/opt/tomasini')


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def main():
    directory = BASE / 'backups'
    if not directory.is_dir() or directory.resolve() != Path('/opt/tomasini/backups'):
        raise RuntimeError('Destino de respaldos propio no disponible.')
    date = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    output = directory / f'tomasini_prod-{date}.dump'
    manifest = output.with_suffix('.json')
    if output.exists() and manifest.exists():
        metadata = json.loads(manifest.read_text())
        if digest(output) != metadata['sha256']:
            raise RuntimeError('La copia diaria existente no coincide con su huella; no se sobrescribe.')
        return
    if output.exists():
        raise RuntimeError('Copia parcial previa; requiere revisión antes de reintentar.')
    temporary = output.with_suffix('.partial')
    if temporary.exists():
        raise RuntimeError('Existe un respaldo parcial; no se sobrescribe.')
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'PGPASSFILE': str(BASE / 'private/backup.pgpass'), 'PGCONNECT_TIMEOUT': '10'}
    result = subprocess.run(['/usr/bin/pg_dump', '-h', '127.0.0.1', '-U', 'tomasini_prod_backup',
                             '-d', 'tomasini_prod', '-Fc', '--no-owner', '--no-acl', '-f', str(temporary)],
                            env=env, capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError('pg_dump falló; conserva el archivo parcial para revisión.')
    os.chmod(temporary, 0o600)
    verify = subprocess.run(['/usr/bin/pg_restore', '--list', str(temporary)], env=env, capture_output=True, timeout=30)
    if verify.returncode or temporary.stat().st_size == 0:
        raise RuntimeError('No se pudo validar el archivo de respaldo.')
    temporary.rename(output)
    manifest.write_text(json.dumps({'database': 'tomasini_prod', 'createdAt': datetime.now(timezone.utc).isoformat(),
                                    'sha256': digest(output), 'bytes': output.stat().st_size}))
    os.chmod(manifest, 0o600)
    complete = sorted(path for path in directory.glob('tomasini_prod-????-??-??.dump') if path.with_suffix('.json').exists())
    for old in complete[:-14]:
        if old.parent.resolve() != directory.resolve() or old.is_symlink():
            raise RuntimeError('Retención encontró una ruta ajena; no se elimina.')
        old.unlink()
        old.with_suffix('.json').unlink()
    print('Respaldo Tomasini completado y listado validado; retención de 14 copias diarias.')


if __name__ == '__main__':
    main()
