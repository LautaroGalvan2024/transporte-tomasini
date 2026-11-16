#!/usr/bin/python3
"""Switch only the existing Tomasini installation to its registered domains."""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import secrets
import socket
import stat
import subprocess
import sys
import tempfile
import time

FRONT = 'transporte-tomasini.com'
API = 'transporte-tomasini-api.com'
LEGACY = 'tomasini.72-60-50-213.sslip.io'
NAMES = (FRONT, API, 'www.' + FRONT, 'www.' + API)
IP = '72.60.50.213'
BASE = Path('/opt/tomasini')
OPS = BASE / 'ops/ci'
STATE = BASE / 'private/domain-cutover'
SITE = Path('/etc/nginx/sites-available/tomasini')
ENABLED = Path('/etc/nginx/sites-enabled/tomasini')
RENEW = Path('/etc/systemd/system/tomasini-certificate.service')
CORE = OPS / 'install_vps.py'
ENV = BASE / 'private/api.env'
FILES = {'site': SITE, 'renew': RENEW, 'core': CORE, 'env': ENV}
OLD_SHA = {
    'site': 'aab4b2a50a7ff8795560556eace30b89f99bc2b25f0455b235aa73ce6b2e928d',
    'renew': '2c3439b27a59b3266cf5c1e12b7292bd033dedb29599e72314d6d1e4632a2620',
    'core': 'bb562b4683b3dccf5fa7c658fc1da6b9d197a98aba6d5c02ecd523d19d02c3f5',
}
UPDATE_SHA = '8c4365decd3c0c133ee80dfe03758a94e4b0be4be8ae8f84ca641aa274649c5a'
RUN_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C.UTF-8'}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def protected(path, directory=False):
    info = path.lstat()
    kind = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1
    require(kind and info.st_uid == 0 and not info.st_mode & 0o022, 'Propiedad inesperada en ' + str(path))


def run(*args, timeout=60):
    result = subprocess.run(args, capture_output=True, text=True, env=RUN_ENV, timeout=timeout, cwd='/')
    require(result.returncode == 0, 'Falló ' + str(args[0]) + ' al configurar dominios Tomasini.')
    if args[0] == 'nginx':
        require('conflicting server name' not in result.stderr, 'Nginx informa un conflicto de nombres.')
    return result.stdout.strip()


def server(names, body, certificate=None):
    listen = 'listen 443 ssl;' if certificate else 'listen 80;'
    tls = ''
    if certificate:
        directory = f'/opt/tomasini/acme/config/live/{certificate}'
        tls = f'  ssl_certificate {directory}/fullchain.pem;\n  ssl_certificate_key {directory}/privkey.pem;\n'
    return f'server {{\n  {listen}\n  server_name {" ".join(names)};\n{tls}{body}\n}}\n'


def http(names, target=None):
    action = f'return 308 https://{target}$request_uri;' if target else 'return 503;'
    return server(names, '  location ^~ /.well-known/acme-challenge/ { root /opt/tomasini/acme/webroot; }\n'
                         f'  location / {{ {action} }}')


def site_config():
    proxy = '''    proxy_pass http://127.0.0.1:3102;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;'''
    front = f'  client_max_body_size 1m;\n  location / {{\n{proxy}\n  }}'
    api = f'  client_max_body_size 1m;\n  location ^~ /api/ {{\n{proxy}\n  }}\n  location / {{ return 404; }}'
    result = http([FRONT, 'www.' + FRONT, LEGACY], FRONT) + http([API, 'www.' + API], API)
    result += server([FRONT], front, FRONT) + server([API], api, FRONT)
    for alias, target, cert in [(LEGACY, FRONT, LEGACY), ('www.' + FRONT, FRONT, FRONT), ('www.' + API, API, FRONT)]:
        result += server([alias], f'  return 308 https://{target}$request_uri;', cert)
    return result


def new_env(original):
    lines = original.splitlines(keepends=True)
    keys = [i for i, line in enumerate(lines) if line.lstrip().startswith(b'APP_ORIGIN=')]
    require(len(keys) == 1 and lines[keys[0]].rstrip(b'\r\n') == f'APP_ORIGIN=https://{LEGACY}'.encode(),
            'APP_ORIGIN previo inesperado.')
    lines[keys[0]] = lines[keys[0]].replace(LEGACY.encode(), FRONT.encode())
    return b''.join(lines)


def new_renew(original):
    lines = original.splitlines(keepends=True)
    start = [line for line in lines if line.startswith(b'ExecStart=/usr/bin/certbot renew ')]
    old_name = f'--cert-name {LEGACY} '.encode()
    require(len(start) == 1 and old_name in start[0], 'Unidad de renovación inesperada.')
    # Certbot renew processes every lineage in this dedicated directory even if
    # renewing one fails. Two sequential systemd commands would skip the second.
    return original.replace(start[0], start[0].replace(old_name, b''))


def replace(path, data):
    info = path.stat()
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.tomasini-domain-')
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def reload_nginx():
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')


def neighbors(core):
    snapshot = core.snapshot_existing()
    for path in (SITE, ENABLED):
        del snapshot['files'][str(path)]
    return snapshot


def dns_ready():
    for host in NAMES:
        addresses = {result[4][0] for result in socket.getaddrinfo(host, 80, type=socket.SOCK_STREAM)}
        require(addresses == {IP}, f'{host} debe resolver únicamente a {IP} antes del corte.')


def obtain_cert():
    root = BASE / 'acme'
    challenge = root / 'webroot/.well-known/acme-challenge'
    for directory in (challenge.parent, challenge):
        if not directory.exists():
            directory.mkdir(mode=0o755)
            directory.chmod(0o755)
        protected(directory, directory=True)
    token = secrets.token_hex(24)
    path = challenge / token
    with path.open('x') as stream:
        stream.write(token)
    try:
        path.chmod(0o644)
        for host in NAMES:
            require(run('curl', '-fsS', '--max-time', '12', f'http://{host}/.well-known/acme-challenge/{token}') == token,
                    'HTTP-01 no responde en ' + host)
    finally:
        path.unlink()
    domain_args = [arg for host in NAMES for arg in ('-d', host)]
    run('certbot', 'certonly', '--webroot', '--webroot-path', str(root / 'webroot'),
        '--config-dir', str(root / 'config'), '--work-dir', str(root / 'work'), '--logs-dir', str(root / 'logs'),
        '--cert-name', FRONT, *domain_args, '--non-interactive', '--no-directory-hooks', '--keep-until-expiring',
        '--agree-tos', '--register-unsafely-without-email', timeout=240)


def check_lineages():
    lineages = {p.name for p in (BASE / 'acme/config/renewal').glob('*.conf')}
    require(lineages == {LEGACY + '.conf', FRONT + '.conf'}, 'Directorios de renovación de Tomasini inesperados.')


def verify_public(update):
    require(run('systemctl', 'is-active', 'tomasini-certificate.timer') == 'active', 'Timer de renovación inactivo.')
    renewal = run('systemctl', 'show', 'tomasini-certificate.service', '-p', 'ExecStart', '--value')
    check_lineages()
    require('--cert-name' not in renewal and f'--config-dir {BASE}/acme/config ' in renewal, 'Renovación incompleta en systemd.')
    update.runtime_environment()
    update.verify_tomasini()
    update.verify_public_release((BASE / 'current').resolve(strict=True))
    for host in (FRONT, API):
        ready = json.loads(run('curl', '-fsS', '--max-time', '15', f'https://{host}/api/ready'))
        require(ready == {'status': 'ok'}, 'Readiness incorrecto en ' + host)
        status = run('curl', '-sS', '--max-time', '15', '-o', '/dev/null', '-w', '%{http_code}', f'https://{host}/api/trips/export')
        require(status == '401', 'Descarga sin sesión inesperada en ' + host)
    require(run('curl', '-sS', '--max-time', '15', '-o', '/dev/null', '-w', '%{http_code}', f'https://{API}/') == '404',
            'El dominio de la API debe limitarse a /api/.')
    for alias, target in [(LEGACY, FRONT), ('www.' + FRONT, FRONT), ('www.' + API, API)]:
        suffix = '/join?check=tomasini'
        status = run('curl', '-sS', '--max-time', '15', '-o', '/dev/null', '-w', '%{http_code} %{redirect_url}', 'https://' + alias + suffix)
        require(status == f'308 https://{target}{suffix}', 'Redirección inesperada en ' + alias)


def backups():
    if not STATE.exists():
        with tempfile.TemporaryDirectory(dir=STATE.parent, prefix='.tomasini-domain-') as tmp:
            staging = Path(tmp) / 'saved'
            staging.mkdir(mode=0o700)
            for key, path in FILES.items():
                data = path.read_bytes()
                require(key not in OLD_SHA or sha(data) == OLD_SHA[key], 'Configuración inicial inesperada en ' + key)
                (staging / key).write_bytes(data)
            new_env((staging / 'env').read_bytes())
            os.rename(staging, STATE)
    protected(STATE, directory=True)
    require(STATE.stat().st_mode & 0o077 == 0, 'La copia privada de recuperación debe tener modo 0700.')
    for key in FILES:
        protected(STATE / key)
    old = {key: (STATE / key).read_bytes() for key in FILES}
    require(all(sha(old[key]) == expected for key, expected in OLD_SHA.items()), 'Respaldo operativo inesperado.')
    return old


def restore(old, new, staged, core, snapshot, *, interrupted=False):
    # Check every file before attempting rollback. Never overwrite a concurrent edit.
    current = {key: path.read_bytes() for key, path in FILES.items()}
    for key in FILES:
        allowed = [old[key], new[key]]
        if key == 'site':
            allowed.append(staged)
        require(current[key] in allowed, 'Reversión detenida por un cambio ajeno en ' + key)
    restored = {key for key in FILES if current[key] != old[key]}
    for key in restored:
        replace(FILES[key], old[key])
    (STATE / 'active.json').unlink(missing_ok=True)
    # A prior process can stop after restoring a file and before reloading its service.
    if interrupted or 'renew' in restored:
        run('systemctl', 'daemon-reload')
    if interrupted or 'env' in restored:
        run('systemctl', 'restart', 'tomasini.service')
    reload_nginx()
    for attempt in range(30):
        try:
            if core.status_http('https://' + LEGACY + '/api/ready') == 200:
                break
        except OSError:
            pass
        time.sleep(0.5)
    else:
        raise RuntimeError('No respondió el origen anterior.')
    core.verify_existing(snapshot)


def cutover(args):
    import fcntl
    require(sys.platform.startswith('linux') and os.geteuid() == 0 and sys.flags.isolated and sys.dont_write_bytecode
            and os.environ.get('SUDO_USER') == 'mozzi', 'Usar el launcher operativo revisado.')
    os.umask(0o077)
    source = Path(__file__).resolve().parent
    require(source.parent == Path('/run') and source.name.startswith('tomasini-domain.'), 'Staging inesperado.')
    for directory in [source, BASE, BASE / 'private', OPS.parent, OPS]:
        protected(directory, directory=True)
    for path in [source / 'install_vps.py', *FILES.values(), OPS / 'update_vps.py', BASE / 'private/update.lock']:
        protected(path)
    candidate = (source / 'install_vps.py').read_bytes()
    require(sha(candidate) == args.core_sha and sha((OPS / 'update_vps.py').read_bytes()) == UPDATE_SHA,
            'La huella de una biblioteca operativa no coincide.')
    require(ENABLED.is_symlink() and os.readlink(ENABLED) == str(SITE), 'Enlace Nginx de Tomasini inesperado.')
    with (BASE / 'private/update.lock').open('r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(sha(CORE.read_bytes()) in (OLD_SHA['core'], args.core_sha), 'Biblioteca activa inesperada.')
        sys.path.insert(0, str(OPS))
        core = importlib.import_module('install_vps')
        update = importlib.import_module('update_vps')
        snapshot = neighbors(core)
        require(not args.rollback or STATE.exists(), 'No hay un intento previo para revertir.')
        old = backups()
        staged = old['site'] + http(NAMES).encode()
        new = {'site': site_config().encode(), 'env': new_env(old['env']), 'core': candidate, 'renew': new_renew(old['renew'])}
        active = STATE / 'active.json'
        if args.rollback:
            restore(old, new, staged, core, snapshot, interrupted=True)
            print('Dominios anteriores de Tomasini restablecidos.')
            return
        dns_ready()
        if active.exists():
            protected(active)
            require(all(FILES[k].read_bytes() == new[k] for k in ('site', 'core', 'renew')), 'Configuración activa inesperada.')
            verify_public(update)
            print('Dominios de Tomasini verificados.')
            return
        if any(path.read_bytes() != old[key] for key, path in FILES.items()):
            restore(old, new, staged, core, snapshot, interrupted=True)
        update.runtime_environment()
        update.verify_tomasini()
        require(run('systemctl', 'show', 'tomasini-certificate.service', '-p', 'FragmentPath', '--value') == str(RENEW)
                and not run('systemctl', 'show', 'tomasini-certificate.service', '-p', 'DropInPaths', '--value'),
                'Unidad de certificados inesperada.')
        run('nginx', '-t')
        try:
            replace(SITE, staged)
            reload_nginx()
            obtain_cert()
            check_lineages()
            replace(SITE, new['site'])
            reload_nginx()
            replace(RENEW, new['renew'])
            run('systemctl', 'daemon-reload')
            replace(CORE, candidate)
            replace(ENV, new['env'])
            run('systemctl', 'restart', 'tomasini.service')
            core.HOST = FRONT
            verify_public(update)
            core.verify_existing(snapshot)
            with active.open('x') as receipt:
                json.dump({'hosts': NAMES, 'time': time.time(), 'coreSha256': args.core_sha}, receipt)
            # The next CI process imports the freshly installed helper independently.
            run('/usr/bin/python3', '-I', '-B', '-c', 'import sys;sys.path.insert(0,sys.argv[1]);'
                'import update_vps as u;assert u.core.HOST==sys.argv[2];u.runtime_environment()', str(OPS), FRONT)
        except BaseException:
            restore(old, new, staged, core, snapshot)
            raise
    print('Dominios y servicios vecinos verificados. Corte de Tomasini completado.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core-sha', required=True)
    parser.add_argument('--rollback', action='store_true')
    try:
        cutover(parser.parse_args())
    except Exception as error:
        print('Corte de dominios detenido:', error, file=sys.stderr)
        sys.exit(1)
