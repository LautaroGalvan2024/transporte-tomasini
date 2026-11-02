#!/usr/bin/env python3
"""Private handoff after successful installation; no credentials are printed."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

BASE = Path('/opt/tomasini')


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def export(release_sha):
    if os.geteuid() != 0 or not re.fullmatch('[a-f0-9]{64}', release_sha):
        raise RuntimeError('Se requiere sudo y una huella de release válida.')
    receipt = json.loads((BASE / 'private/installed.json').read_text())
    if receipt.get('release') != release_sha or not receipt.get('verification', {}).get('existingApplicationsPreserved'):
        raise RuntimeError('El release no tiene una instalación verificada.')
    candidates = sorted(path for path in (BASE / 'backups').iterdir()
                        if re.fullmatch(r'tomasini_prod-\d{4}-\d{2}-\d{2}\.dump', path.name)
                        and path.is_file() and not path.is_symlink() and path.with_suffix('.json').is_file())
    if not candidates:
        raise RuntimeError('No hay un respaldo completo de Tomasini para recuperar.')
    backup = candidates[-1]
    metadata = json.loads(backup.with_suffix('.json').read_text())
    if metadata.get('database') != 'tomasini_prod' or digest(backup) != metadata.get('sha256'):
        raise RuntimeError('La huella del respaldo no coincide.')
    destination = Path('/home/mozzi') / ('tomasini-deploy-' + release_sha[:16]) / 'handoff'
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    # Files are created by the SSH user, never by root inside user-controlled paths.
    create_directory = 'import os,sys; os.mkdir(sys.argv[1],0o700)'
    result = subprocess.run(['/usr/sbin/runuser', '-u', 'mozzi', '--', 'python3', '-c', create_directory, str(destination)],
                            env=env, cwd='/', capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError('No se creó un directorio privado nuevo; no se sobrescribe un handoff anterior.')
    copy = 'import os,sys,shutil; fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600); f=os.fdopen(fd,"wb"); shutil.copyfileobj(sys.stdin.buffer,f); f.close()'
    files = {
        'admin-inicial.json': BASE / 'private/bootstrap/admin-inicial.json',
        'installed.json': BASE / 'private/installed.json',
        'preflight.json': BASE / 'private/preflight.json',
        'postflight.json': BASE / 'private/postflight.json',
        'tomasini_prod.dump': backup,
        'backup-manifest.json': backup.with_suffix('.json'),
    }
    for name, source in files.items():
        if not source.is_file() or source.is_symlink() or source.stat().st_uid != 0:
            raise RuntimeError('Un artefacto de origen no cumple los permisos esperados.')
        with source.open('rb') as stream:
            result = subprocess.run(['/usr/sbin/runuser', '-u', 'mozzi', '--', 'python3', '-c', copy, str(destination / name)],
                                    stdin=stream, env=env, cwd='/', capture_output=True, timeout=120)
        if result.returncode:
            raise RuntimeError('La entrega privada quedó incompleta; conservar el estado para revisión.')
    print('Entrega privada preparada; credenciales y respaldo no se imprimieron.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-sha', required=True)
    args = parser.parse_args()
    try:
        export(args.release_sha)
    except Exception as error:
        print(f'El sistema ya está instalado; la descarga privada sigue pendiente: {error}')
        raise SystemExit(2)
