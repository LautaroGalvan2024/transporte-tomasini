#!/usr/bin/env python3
"""Initial Tomasini installation. No action occurs on import; never reuse on an existing install."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
try:
    import pwd
except ImportError:  # Windows can run the offline verification suite.
    pwd = None
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

BASE = Path('/opt/tomasini')
SITE = Path('/etc/nginx/sites-available/tomasini')
ENABLED = Path('/etc/nginx/sites-enabled/tomasini')
HBA = Path('/etc/postgresql/16/main/pg_hba.conf')
UNIT = Path('/etc/systemd/system/tomasini.service')
PORT = 3102
DATABASE = 'tomasini_prod'
ROLES = ('tomasini_prod_app', 'tomasini_prod_migrator', 'tomasini_prod_backup')
HOST = 'tomasini.72-60-50-213.sslip.io'
SAFE_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}
PRIVATE_VALUES: list[str] = []


class InstallationError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise InstallationError(message)


def record_command_failure(label, stdout, stderr, status):
    directory = BASE / 'private'
    if not directory.is_dir():
        return
    def scrub(value):
        text = value.decode(errors='replace') if isinstance(value, bytes) else str(value or '')
        for secret in PRIVATE_VALUES:
            text = text.replace(secret, '[privado]')
        return text[-32000:]
    try:
        write_new(directory / f'command-failure-{time.time_ns()}.json',
                  json.dumps({'label': label, 'status': status, 'stdout': scrub(stdout), 'stderr': scrub(stderr)}, indent=2))
    except OSError:
        pass


def run(args, *, input=None, env=None, timeout=120, label='Operación', check=True, cwd=None):
    try:
        result = subprocess.run(args, input=input, text=True, capture_output=True,
                                env=env or SAFE_ENV, timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired as error:
        record_command_failure(label, error.stdout, error.stderr, 'timeout')
        raise InstallationError(f'{label}: tiempo agotado; diagnóstico en el directorio privado.') from error
    if check and result.returncode:
        record_command_failure(label, result.stdout, result.stderr, result.returncode)
        # SQL, npm and environment output can contain credentials; never echo raw output.
        raise InstallationError(f'{label}: código {result.returncode}. Revisar el estado privado; no se ejecutarán resets.')
    return result.stdout.strip()


def prepare_scoped(args, *, env, timeout, label, cwd):
    unit = f'tomasini-prepare-{secrets.token_hex(8)}.scope'
    require(run(['systemctl', 'show', unit, '-p', 'LoadState', '--value'], check=False) == 'not-found', 'El scope propio ya existe.')
    try:
        # --scope is synchronous and inherits environment without exposing secrets as arguments.
        return run(['systemd-run', '--scope', '--quiet', '--collect', f'--unit={unit}',
                    '--property=MemoryMax=1G', '--property=CPUQuota=40%', '--property=TasksMax=128',
                    *args], env=env, timeout=timeout, label=label, cwd=cwd)
    finally:
        run(['systemctl', 'stop', unit], check=False, label='Cerrar únicamente scope propio')


def sql(statement):
    return run(['/usr/sbin/runuser', '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', 'postgres'],
               input=statement, label='PostgreSQL administrativo', cwd='/')


def dbsql(statement):
    return run(['/usr/sbin/runuser', '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', DATABASE],
               input=statement, label='PostgreSQL Tomasini', cwd='/')


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_new(path, content, mode=0o600):
    path = Path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, 'w') as stream:
        stream.write(content)


def atomic_write(path, content):
    path = Path(path)
    stat = path.stat()
    fd, temp = tempfile.mkstemp(prefix='.tomasini-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
        os.chmod(temp, stat.st_mode & 0o777)
        os.chown(temp, stat.st_uid, stat.st_gid)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def safe_extract(archive, destination):
    destination = Path(destination).resolve()
    with tarfile.open(archive) as bundle:
        for member in bundle.getmembers():
            target = (destination / member.name).resolve()
            require(target.is_relative_to(destination), 'El archivo incluye una ruta fuera del release.')
        bundle.extractall(destination, filter='data')


def status_http(url):
    with urllib.request.urlopen(url, timeout=15) as response:
        return response.status


def snapshot_existing():
    files = {}
    for path in Path('/etc/nginx').rglob('*'):
        if path.is_symlink():
            files[str(path)] = {'link': os.readlink(path), 'sha256': sha256(path) if path.is_file() else None}
        elif path.is_file():
            files[str(path)] = {'sha256': sha256(path)}
    pids = {unit: run(['systemctl', 'show', unit, '-p', 'MainPID', '--value'])
            for unit in ['nginx', 'postgresql@16-main', 'pm2-mozzi.service', 'horizontes-demo.service']}
    require(all(pid.isdigit() and int(pid) > 0 for pid in pids.values()), 'Un servicio existente no tiene proceso activo.')
    pm2_children = Path(f'/proc/{pids["pm2-mozzi.service"]}/task/{pids["pm2-mozzi.service"]}/children').read_text().strip()
    return {
        'files': files,
        'pids': pids,
        'pm2Children': pm2_children,
        'health': {url: status_http(url) for url in [
            'https://mozzi-app.com/', 'https://mozzi-api.com/api/salud',
            'https://horizontes-five.vercel.app/',
            'https://horizontes-api.72-60-50-213.sslip.io/api/salud',
        ]},
    }


def verify_existing(snapshot):
    for name, expected in snapshot['files'].items():
        path = Path(name)
        require(path.exists() or path.is_symlink(), 'Desapareció una configuración preexistente; detener y revisar.')
        if expected['sha256'] is not None:
            require(sha256(path) == expected['sha256'], 'Cambió una configuración preexistente; detener y revisar.')
        if 'link' in expected:
            require(path.is_symlink() and os.readlink(path) == expected['link'], 'Cambió un enlace preexistente.')
    for unit, expected in snapshot['pids'].items():
        require(run(['systemctl', 'show', unit, '-p', 'MainPID', '--value']) == expected,
                f'Cambió el proceso de {unit}; no se harán reinicios automáticos.')
    if 'pm2Children' in snapshot:
        pm2 = snapshot['pids']['pm2-mozzi.service']
        require(Path(f'/proc/{pm2}/task/{pm2}/children').read_text().strip() == snapshot['pm2Children'],
                'Cambió un proceso administrado por PM2; requiere revisión sin reinicios automáticos.')
    for url, expected in snapshot['health'].items():
        require(status_http(url) == expected == 200, 'Falló una comprobación HTTP de una aplicación existente.')


def hba_block():
    roles = ','.join(ROLES)
    return f'''# BEGIN TOMASINI EXCLUSIVE
host {DATABASE} {roles} 127.0.0.1/32 scram-sha-256
local {DATABASE} {roles} scram-sha-256
host all {roles} 0.0.0.0/0 reject
host all {roles} ::/0 reject
local all {roles} reject
# END TOMASINI EXCLUSIVE
'''


def nginx_config(https=False):
    redirect = f'return 301 https://{HOST}$request_uri;' if https else 'return 503;'
    config = f'''server {{
  listen 80;
  server_name {HOST};
  location ^~ /.well-known/acme-challenge/ {{ root {BASE}/acme/webroot; }}
  location / {{ {redirect} }}
}}
'''
    if https:
        config += f'''server {{
  listen 443 ssl;
  server_name {HOST};
  ssl_certificate {BASE}/acme/config/live/{HOST}/fullchain.pem;
  ssl_certificate_key {BASE}/acme/config/live/{HOST}/privkey.pem;
  client_max_body_size 1m;
  location / {{
    proxy_pass http://127.0.0.1:{PORT};
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_no_cache 1;
    proxy_cache_bypass 1;
  }}
}}
'''
    return config


def service_unit():
    return f'''[Unit]
Description=Transporte Tomasini
After=network.target postgresql.service
[Service]
Type=simple
User=tomasini
Group=tomasini
WorkingDirectory={BASE}/current
EnvironmentFile={BASE}/private/api.env
Environment=PATH={BASE}/runtime/bin:/usr/bin:/bin
Environment=HOME={BASE}/private/runtime
ExecStart={BASE}/runtime/bin/node backend/dist/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={BASE}/private/runtime
UMask=0077
MemoryMax=512M
CPUQuota=40%
TasksMax=64
[Install]
WantedBy=multi-user.target
'''


def preflight(args):
    require(sys.platform.startswith('linux'), 'El instalador se ejecuta únicamente en la VPS Linux.')
    require(os.geteuid() == 0, 'La instalación requiere sudo interactivo; no guardar su contraseña.')
    require(re.fullmatch(r'[a-f0-9]{64}', args.release_sha or '') is not None, 'Falta SHA-256 del release.')
    require(re.fullmatch(r'[a-f0-9]{64}', args.node_sha or '') is not None, 'Falta SHA-256 del runtime verificado.')
    require(sha256(args.release) == args.release_sha, 'El release no coincide con su huella.')
    require(sha256(args.node_archive) == args.node_sha, 'El runtime no coincide con su huella.')
    own_units = ['tomasini.service'] + [f'tomasini-{job}.{kind}' for job in ['notifications', 'backup', 'certificate'] for kind in ['service', 'timer']]
    for path in [BASE, SITE, ENABLED] + [Path('/etc/systemd/system') / name for name in own_units]:
        require(not path.exists() and not path.is_symlink(), f'Recurso existente: {path}; no se sobrescribe.')
    for name in own_units:
        require(run(['systemctl', 'show', name, '-p', 'LoadState', '--value'], check=False) == 'not-found',
                f'Unidad existente: {name}; no se modifica.')
    try:
        pwd.getpwnam('tomasini')
    except KeyError:
        pass
    else:
        raise InstallationError('El usuario Unix tomasini ya existe; revisar antes de instalar.')
    with socket.socket() as sock:
        require(sock.connect_ex(('127.0.0.1', PORT)) != 0, 'Puerto 3102 ocupado; no detener procesos ajenos.')
    require(shutil.disk_usage('/opt').free > 3 * 1024**3, 'Se requieren 3 GiB libres para instalación y respaldos.')
    memory = dict(re.findall(r'^(\w+):\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M))
    require(int(memory.get('MemAvailable', 0)) > 1024**2, 'Menos de 1 GiB de memoria disponible; detener instalación.')
    require(sql("SELECT count(*) FROM pg_database WHERE datname='tomasini_prod';") == '0', 'La base Tomasini ya existe.')
    require(sql("SELECT count(*) FROM pg_roles WHERE rolname IN ('tomasini_prod_app','tomasini_prod_migrator','tomasini_prod_backup');") == '0', 'Ya existen roles Tomasini.')
    require(sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;') == '0', 'HBA preexistente inválido.')
    require('# BEGIN TOMASINI EXCLUSIVE' not in HBA.read_text(), 'Ya existe configuración HBA Tomasini.')
    run(['nginx', '-t'], label='Validación Nginx previa')
    snapshot = snapshot_existing()
    require(all(code == 200 for code in snapshot['health'].values()), 'Una aplicación existente no está sana; no desplegar.')
    return snapshot


def validate_resume(args):
    require(sys.platform.startswith('linux') and os.geteuid() == 0, 'La recuperación requiere sudo en Linux.')
    require(re.fullmatch(r'[a-f0-9]{64}', args.release_sha or '') is not None and sha256(args.release) == args.release_sha, 'Release de recuperación inválido.')
    require(re.fullmatch(r'[a-f0-9]{64}', args.node_sha or '') is not None and sha256(args.node_archive) == args.node_sha, 'Runtime de recuperación inválido.')
    failure_path = BASE / 'private/failed.json'
    require(failure_path.is_file() and not failure_path.is_symlink() and failure_path.stat().st_uid == 0, 'Falta un estado de error propio y protegido.')
    failure = json.loads(failure_path.read_text())
    require(failure.get('phase') == 'preparar release' and not failure.get('rollbackIssues'), 'La recuperación solo admite preparación del release sin reversión incompleta.')
    require(not (BASE / 'private/resume-release.json').exists(), 'Ya se intentó esta recuperación; revisar el nuevo estado antes de actuar.')
    for path in [BASE / 'private/installed.json', BASE / 'private/api.env', BASE / 'private/backup.pgpass', BASE / 'private/bootstrap/admin-inicial.json', SITE, ENABLED]:
        require(not path.exists() and not path.is_symlink(), 'Hay recursos posteriores a la fase permitida; no continuar automáticamente.')
    release = BASE / 'releases' / args.release_sha[:16]
    require(release.is_dir() and not release.is_symlink() and (BASE / 'current').is_symlink() and (BASE / 'current').resolve() == release.resolve(), 'El release preparado no corresponde a la huella solicitada.')
    for path in [release / 'node_modules', release / 'backend/node_modules', release / 'frontend/node_modules']:
        require(not path.exists() and not path.is_symlink(), 'Hay dependencias parcialmente instaladas; se requiere revisión específica, sin borrarlas.')
    account = pwd.getpwnam('tomasini')
    require(account.pw_dir == str(BASE) and account.pw_shell == '/usr/sbin/nologin' and release.stat().st_uid == account.pw_uid, 'El usuario o propietario no corresponden a Tomasini.')
    expected_files = set()
    with tarfile.open(args.release) as bundle:
        for member in bundle.getmembers():
            target = release / member.name
            require(target.resolve().is_relative_to(release.resolve()) and not target.is_symlink(), 'Ruta inesperada en el release preparado.')
            if member.isfile():
                expected_files.add(Path(member.name).as_posix())
                require(target.is_file() and target.stat().st_size == member.size, 'El contenido preparado difiere del archivo original.')
                digest = hashlib.sha256()
                with bundle.extractfile(member) as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
                require(sha256(target) == digest.hexdigest(), 'Una fuente o compilación cambió tras preparar el release.')
    actual_files = {path.relative_to(release).as_posix() for path in release.rglob('*') if path.is_file() or path.is_symlink()}
    require(actual_files == expected_files, 'Hay archivos extra o faltantes en el release preparado; no ejecutar npm automáticamente.')
    require(sha256(BASE / 'operations/backup.py') == sha256(release / 'infra/backup.py') and (BASE / 'operations/backup.py').stat().st_uid == 0, 'El respaldo privilegiado no coincide con la fuente original.')
    require(run([str(BASE / 'runtime/bin/node'), '--version']) == 'v24.21.0', 'Runtime preparado inesperado.')
    require((BASE / 'runtime/bin/node').stat().st_uid == 0 and (BASE / 'runtime/lib/node_modules/npm/bin/npm-cli.js').stat().st_uid == 0, 'Runtime sin propiedad root esperada.')
    units = ['tomasini.service'] + [f'tomasini-{job}.{kind}' for job in ['notifications', 'backup', 'certificate'] for kind in ['service', 'timer']]
    for name in units:
        path = Path('/etc/systemd/system') / name
        require(not path.exists() and not path.is_symlink() and run(['systemctl', 'show', name, '-p', 'LoadState', '--value'], check=False) == 'not-found', 'Hay una unidad posterior a la fase de preparación.')
    with socket.socket() as sock:
        require(sock.connect_ex(('127.0.0.1', PORT)) != 0, 'Puerto de Tomasini ocupado; no se detienen procesos.')
    require(sql("SELECT count(*) FROM pg_database WHERE datname='tomasini_prod';") == '0', 'La base propia ya existe; no se retoma esta fase.')
    require(sql("SELECT count(*) FROM pg_roles WHERE rolname IN ('tomasini_prod_app','tomasini_prod_migrator','tomasini_prod_backup');") == '0', 'Ya existen roles posteriores a la fase permitida.')
    require(HBA.read_text() == (BASE / 'private/pg_hba.before.conf').read_text(), 'HBA cambió desde la preparación; no se sobrescribe.')
    require(sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;') == '0', 'HBA inválido.')
    require(shutil.disk_usage('/opt').free > 3 * 1024**3, 'Espacio libre insuficiente para retomar.')
    memory = dict(re.findall(r'^(\w+):\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M))
    require(int(memory.get('MemAvailable', 0)) > 1024**2, 'Memoria disponible insuficiente para retomar.')
    run(['nginx', '-t'], label='Validación Nginx antes de recuperar')
    snapshot = json.loads((BASE / 'private/preflight.json').read_text())
    verify_existing(snapshot)
    return snapshot


def install(args):
    resume = getattr(args, 'resume_release', False)
    snapshot = validate_resume(args) if resume else preflight(args)
    hba_before = HBA.read_text()
    roles_created = False
    hba_changed = False
    site_created = False
    service_created = False
    created_job_units = []
    phase = 'preparar release'
    try:
        release = BASE / 'releases' / args.release_sha[:16]
        if resume:
            write_new(BASE / 'private/resume-release.json', json.dumps({'release': args.release_sha, 'validatedAt': time.time(), 'originalFailureSha256': sha256(BASE / 'private/failed.json')}, indent=2))
        else:
            BASE.mkdir(mode=0o755)
            for relative, mode in [('private', 0o750), ('private/runtime', 0o700), ('private/bootstrap', 0o700), ('releases', 0o755), ('backups', 0o700),
                                   ('acme', 0o755), ('acme/webroot', 0o755), ('runtime-staging', 0o755)]:
                (BASE / relative).mkdir(mode=mode)
            write_new(BASE / 'private/preflight.json', json.dumps(snapshot, indent=2))
            write_new(BASE / 'private/pg_hba.before.conf', hba_before)
            release.mkdir(mode=0o755)
            safe_extract(args.release, release)
            require((release / 'backend/dist/server.js').is_file(), 'El release no contiene backend compilado.')
            require((release / 'frontend/dist/index.html').is_file(), 'El release no contiene frontend compilado.')
            operations = BASE / 'operations'
            operations.mkdir(mode=0o755)
            shutil.copyfile(release / 'infra/backup.py', operations / 'backup.py')
            os.chmod(operations / 'backup.py', 0o750)
            safe_extract(args.node_archive, BASE / 'runtime-staging')
            entries = list((BASE / 'runtime-staging').iterdir())
            require(len(entries) == 1 and (entries[0] / 'bin/node').is_file(), 'Runtime Node inesperado.')
            entries[0].rename(BASE / 'runtime')
            (BASE / 'runtime-staging').rmdir()
            (BASE / 'current').symlink_to(release)
            run(['useradd', '--system', '--home-dir', str(BASE), '--shell', '/usr/sbin/nologin', 'tomasini'], label='Usuario propio')
        uid = pwd.getpwnam('tomasini').pw_uid
        gid = pwd.getpwnam('tomasini').pw_gid
        os.chown(BASE / 'private', 0, gid)
        for path in [BASE / 'private/runtime', BASE / 'private/bootstrap', release]:
            os.chown(path, uid, gid)
        env = {**SAFE_ENV, 'PATH': f'{BASE}/runtime/bin:' + SAFE_ENV['PATH'], 'HOME': str(BASE / 'private/runtime'),
               'npm_config_cache': str(BASE / 'private/runtime/npm-cache'),
               'XDG_CACHE_HOME': str(BASE / 'private/runtime/cache')}
        npm = str(BASE / 'runtime/lib/node_modules/npm/bin/npm-cli.js')
        node = str(BASE / 'runtime/bin/node')
        run(['chown', '-R', 'tomasini:tomasini', str(release)], label='Propiedad del release nuevo')
        prepare_scoped(['/usr/sbin/runuser', '-u', 'tomasini', '--', node, npm, 'ci', '--prefix', str(release), '--no-audit', '--no-fund'],
            env=env, timeout=600, label='Dependencias del release propio', cwd=str(release))
        phase = 'base y roles nuevos'
        passwords = {role: secrets.token_hex(32) for role in ROLES}
        PRIVATE_VALUES.extend(passwords.values())
        sql('BEGIN; ' + ' '.join(f"CREATE ROLE {role} LOGIN PASSWORD '{passwords[role]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT {10 if role.endswith('_app') else 2};" for role in ROLES) + ' COMMIT;')
        roles_created = True
        sql(f'CREATE DATABASE {DATABASE} OWNER tomasini_prod_migrator; REVOKE ALL ON DATABASE {DATABASE} FROM PUBLIC; GRANT CONNECT ON DATABASE {DATABASE} TO tomasini_prod_app,tomasini_prod_backup;')
        dbsql('CREATE SCHEMA tomasini AUTHORIZATION tomasini_prod_migrator; REVOKE ALL ON SCHEMA public FROM PUBLIC;')
        require(HBA.read_text() == hba_before, 'HBA cambió durante la preparación; no sobrescribir cambios concurrentes.')
        atomic_write(HBA, hba_block() + hba_before)
        hba_changed = True
        require(sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;') == '0', 'HBA nuevo inválido.')
        sql('SELECT pg_reload_conf();')
        for role in ROLES:
            pg_env = {**env, 'PGPASSWORD': passwords[role], 'PGCONNECT_TIMEOUT': '5'}
            identity = run(['psql', '-X', '-h', '127.0.0.1', '-U', role, '-d', DATABASE, '-Atc', 'SELECT current_database()||\':\'||current_user'], env=pg_env, label='Identidad del rol propio')
            require(identity == f'{DATABASE}:{role}', 'Identidad PostgreSQL inesperada.')
            denied = subprocess.run(['psql', '-X', '-h', '127.0.0.1', '-U', role, '-d', 'postgres', '-Atc', 'SELECT 1'], env=pg_env, capture_output=True, text=True)
            require(denied.returncode != 0 and 'pg_hba.conf rejects' in denied.stderr, 'No se comprobó aislamiento HBA efectivo.')
        dbsql('GRANT USAGE ON SCHEMA tomasini TO tomasini_prod_app,tomasini_prod_backup; ALTER DEFAULT PRIVILEGES FOR ROLE tomasini_prod_migrator IN SCHEMA tomasini GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO tomasini_prod_app; ALTER DEFAULT PRIVILEGES FOR ROLE tomasini_prod_migrator IN SCHEMA tomasini GRANT USAGE,SELECT ON SEQUENCES TO tomasini_prod_app; ALTER DEFAULT PRIVILEGES FOR ROLE tomasini_prod_migrator IN SCHEMA tomasini GRANT SELECT ON TABLES TO tomasini_prod_backup; ALTER DEFAULT PRIVILEGES FOR ROLE tomasini_prod_migrator IN SCHEMA tomasini GRANT SELECT ON SEQUENCES TO tomasini_prod_backup;')
        api_env = {**env, 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(PORT),
                   'APP_ORIGIN': f'https://{HOST}',
                   'DATABASE_URL': f'postgresql://tomasini_prod_app:{passwords[ROLES[0]]}@127.0.0.1:5432/{DATABASE}?schema=tomasini'}
        migrate_env = {**api_env, 'MIGRATION_DATABASE_URL': f'postgresql://tomasini_prod_migrator:{passwords[ROLES[1]]}@127.0.0.1:5432/{DATABASE}?schema=tomasini'}
        phase = 'migraciones propias'
        prepare_scoped(['/usr/sbin/runuser', '-u', 'tomasini', '--', node, npm, '--prefix', str(release), 'run', 'db:generate', '--workspace', '@tomasini/backend'], env=migrate_env, timeout=180, label='Cliente Prisma propio para Linux', cwd=str(release))
        prepare_scoped(['/usr/sbin/runuser', '-u', 'tomasini', '--', node, npm, '--prefix', str(release), 'run', 'db:migrate', '--workspace', '@tomasini/backend'], env=migrate_env, timeout=180, label='Migraciones Tomasini', cwd=str(release))
        dbsql('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA tomasini TO tomasini_prod_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA tomasini TO tomasini_prod_app; GRANT SELECT ON ALL TABLES IN SCHEMA tomasini TO tomasini_prod_backup; GRANT SELECT ON ALL SEQUENCES IN SCHEMA tomasini TO tomasini_prod_backup; REVOKE ALL ON tomasini._prisma_migrations FROM tomasini_prod_app;')
        sql("ALTER ROLE tomasini_prod_migrator NOLOGIN PASSWORD NULL;")
        write_new(BASE / 'private/api.env', '\n'.join(f'{key}={api_env[key]}' for key in ['NODE_ENV','HOST','PORT','APP_ORIGIN','DATABASE_URL']) + '\n')
        os.chown(BASE / 'private/api.env', 0, gid)
        os.chmod(BASE / 'private/api.env', 0o640)
        write_new(BASE / 'private/backup.pgpass', f'127.0.0.1:5432:{DATABASE}:tomasini_prod_backup:{passwords[ROLES[2]]}\n')
        run(['/usr/sbin/runuser', '-u', 'tomasini', '--', node, npm, '--prefix', str(release), 'run', 'admin:create', '--workspace', '@tomasini/backend', '--', '--username=admin', '--name=Administrador', f'--credentials-file={BASE}/private/bootstrap/admin-inicial.json'], env=api_env, label='Acceso administrativo propio', cwd=str(release))
        os.chown(BASE / 'private/bootstrap/admin-inicial.json', 0, 0)
        os.chmod(BASE / 'private/bootstrap/admin-inicial.json', 0o600)
        os.chown(BASE / 'private/bootstrap', 0, 0)
        os.chmod(BASE / 'private/bootstrap', 0o700)
        # Runtime cannot replace code that root-owned maintenance jobs later execute.
        run(['chown', '-R', '--no-dereference', 'root:root', str(release)], label='Bloquear propiedad del release')
        run(['chmod', '-R', 'go-w', str(release)], label='Quitar escritura del release a la aplicación')
        phase = 'servicio propio'
        write_new(UNIT, service_unit(), 0o644)
        service_created = True
        run(['systemctl', 'daemon-reload'], label='Registrar unidad propia')
        run(['systemctl', 'start', 'tomasini'], label='Iniciar únicamente Tomasini')
        for attempt in range(20):
            try:
                if status_http(f'http://127.0.0.1:{PORT}/api/ready') == 200:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            raise InstallationError('La API propia no superó readiness.')
        verify_existing(snapshot)
        phase = 'HTTPS propio'
        write_new(SITE, nginx_config(), 0o644)
        ENABLED.symlink_to(SITE)
        site_created = True
        run(['nginx', '-t'], label='Validar virtual host nuevo')
        run(['systemctl', 'reload', 'nginx'], label='Recarga gradual Nginx')
        verify_existing(snapshot)
        run(['certbot', 'certonly', '--webroot', '--webroot-path', str(BASE / 'acme/webroot'),
             '--config-dir', str(BASE / 'acme/config'), '--work-dir', str(BASE / 'acme/work'),
             '--logs-dir', str(BASE / 'acme/logs'), '--cert-name', HOST, '-d', HOST,
             '--register-unsafely-without-email', '--agree-tos', '--non-interactive', '--no-directory-hooks'],
            timeout=180, label='Certificado exclusivo')
        atomic_write(SITE, nginx_config(True))
        run(['nginx', '-t'], label='Validar HTTPS nuevo')
        run(['systemctl', 'reload', 'nginx'], label='Recarga gradual HTTPS')
        require(status_http(f'https://{HOST}/api/ready') == 200, 'Readiness público falló.')
        phase = 'respaldos y tareas propias'
        install_jobs(created_job_units)
        run(['systemctl', 'enable', 'tomasini'], label='Habilitar únicamente Tomasini')
        verify_existing(snapshot)
        write_new(BASE / 'private/postflight.json', json.dumps(snapshot_existing(), indent=2))
        write_new(BASE / 'private/installed.json', json.dumps({'release': args.release_sha, 'node': args.node_sha, 'host': HOST, 'database': DATABASE, 'timestamp': time.time(),
            'verification': {'existingApplicationsPreserved': True, 'publicReadiness': 200, 'firstBackupValidated': True,
                             'beforeSha256': sha256(BASE / 'private/preflight.json'), 'afterSha256': sha256(BASE / 'private/postflight.json')}}, indent=2))
        print(f'Tomasini instalado: https://{HOST}. Credencial inicial en /opt/tomasini/private/bootstrap/admin-inicial.json (no se imprime).')
    except Exception as original:
        rollback_issues = []
        def attempt(label, operation):
            try:
                operation()
            except Exception:
                rollback_issues.append(label)
        for job in reversed(created_job_units):
            attempt(f'detener {job}', lambda job=job: run(['systemctl', 'disable', '--now', job], label='Detener unidad nueva'))
        if service_created:
            attempt('detener servicio Tomasini', lambda: run(['systemctl', 'disable', '--now', 'tomasini'], label='Detener servicio nuevo'))
        if roles_created:
            attempt('deshabilitar roles Tomasini', lambda: sql(' '.join(f'ALTER ROLE {role} NOLOGIN;' for role in ROLES)))
        if site_created:
            def withdraw_site():
                ENABLED.unlink(missing_ok=True)
                run(['nginx', '-t'], label='Validación al retirar enlace propio')
                run(['systemctl', 'reload', 'nginx'], label='Retirar virtual host propio')
            attempt('retirar virtual host Tomasini', withdraw_site)
        if hba_changed:
            def restore_hba():
                require(HBA.read_text() == hba_block() + hba_before, 'HBA tuvo cambios concurrentes; no se sobrescribe.')
                atomic_write(HBA, hba_before)
                require(sql('SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;') == '0', 'HBA restaurado inválido.')
                sql('SELECT pg_reload_conf();')
            attempt('restaurar bloque HBA propio', restore_hba)
        attempt('verificar aplicaciones preexistentes', lambda: verify_existing(snapshot))
        if (BASE / 'private').is_dir():
            failure_name = 'failed-resume-release.json' if resume else 'failed.json'
            attempt('registrar estado de error', lambda: write_new(BASE / 'private' / failure_name, json.dumps({'phase': phase, 'time': time.time(), 'rollbackIssues': rollback_issues})))
        if rollback_issues:
            raise InstallationError(f'Falla en {phase}; reversión parcial, revisar: {", ".join(rollback_issues)}. No se reinició ningún servicio compartido.') from original
        raise


def install_jobs(created_units):
    hook = BASE / 'renew-certificate.sh'
    write_new(hook, '#!/bin/sh\nset -eu\n/usr/sbin/nginx -t\n/usr/bin/systemctl reload nginx\n', 0o750)
    jobs = {
        'notifications': ('tomasini', f'{BASE}/runtime/bin/node {BASE}/runtime/lib/node_modules/npm/bin/npm-cli.js run notifications:run --workspace @tomasini/backend', '*:0/15'),
        'backup': ('root', f'/usr/bin/python3 {BASE}/operations/backup.py', '*-*-* 03:15:00 America/Argentina/Buenos_Aires'),
        'certificate': ('root', f'/usr/bin/certbot renew --config-dir {BASE}/acme/config --work-dir {BASE}/acme/work --logs-dir {BASE}/acme/logs --cert-name {HOST} --non-interactive --no-directory-hooks --deploy-hook {hook}', '*-*-* 04:15:00 America/Argentina/Buenos_Aires'),
    }
    for name, (user, command, calendar) in jobs.items():
        environment = f'EnvironmentFile={BASE}/private/api.env\nEnvironment=PATH={BASE}/runtime/bin:/usr/bin:/bin\nEnvironment=HOME={BASE}/private/runtime\n' if name == 'notifications' else ''
        hardening = f'NoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths={BASE}/private/runtime\n' if name == 'notifications' else ''
        service_name = f'tomasini-{name}.service'
        timer_name = f'tomasini-{name}.timer'
        write_new(Path('/etc/systemd/system') / service_name, f'''[Unit]
Description=Tomasini {name}
[Service]
Type=oneshot
User={user}
WorkingDirectory={BASE}/current
{environment}ExecStart={command}
Nice=10
MemoryMax=256M
CPUQuota=25%
UMask=0077
{hardening}\
''', 0o644)
        created_units.append(service_name)
        write_new(Path('/etc/systemd/system') / timer_name, f'''[Unit]
Description=Tomasini {name} schedule
[Timer]
OnCalendar={calendar}
Persistent=true
RandomizedDelaySec=30
[Install]
WantedBy=timers.target
''', 0o644)
        created_units.append(timer_name)
    run(['systemctl', 'daemon-reload'], label='Registrar timers propios')
    run(['systemctl', 'start', 'tomasini-backup.service'], timeout=120, label='Primer respaldo propio')
    for name in jobs:
        run(['systemctl', 'enable', '--now', f'tomasini-{name}.timer'], label='Habilitar timer propio')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    parser.add_argument('--release-sha', required=True)
    parser.add_argument('--node-archive', required=True)
    parser.add_argument('--node-sha', required=True)
    parser.add_argument('--resume-release', action='store_true', help='Retomar exclusivamente una preparación fallida comprobada, sin borrar ni reinicializar recursos.')
    parser.add_argument('--export-helper', help='Exportador revisado a ejecutar dentro de esta misma autenticación sudo.')
    parser.add_argument('--export-helper-sha')
    args = parser.parse_args()
    export_helper = None
    if args.export_helper or args.export_helper_sha:
        try:
            export_helper = Path(args.export_helper or '').resolve()
            require(export_helper.parent == Path(__file__).resolve().parent and export_helper.name in ['export_artifacts.py', 'export_artifacts_v2.py'], 'Ubicación del exportador no admitida.')
            require(re.fullmatch(r'[a-f0-9]{64}', args.export_helper_sha or '') is not None and sha256(export_helper) == args.export_helper_sha, 'El exportador no coincide con la huella revisada.')
        except Exception as error:
            print(f'Preflight del exportador: {error}', file=sys.stderr)
            return 1
    try:
        install(args)
    except Exception as error:
        print(f'Instalación detenida: {type(error).__name__}: {error}', file=sys.stderr)
        return 1
    if export_helper:
        try:
            run([sys.executable, str(export_helper), '--release-sha', args.release_sha],
                label='Entrega privada posterior al despliegue', timeout=180, cwd='/')
            print('Entrega privada preparada dentro de la misma autenticación sudo.')
        except Exception:
            # Installation already succeeded. Export failure must never roll it back.
            print('Tomasini quedó instalado; la entrega privada está pendiente y tiene diagnóstico protegido.', file=sys.stderr)
            return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
