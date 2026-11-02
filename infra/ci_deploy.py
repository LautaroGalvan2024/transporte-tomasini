#!/usr/bin/python3
"""Fixed SSH receiver and privileged code-only deployer. Installed root-owned by setup_ci.py."""
from __future__ import annotations

import hashlib
import gzip
import json
import os
from pathlib import Path, PurePosixPath
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
try:
    import fcntl
except ImportError:
    fcntl = None

BASE = Path('/opt/tomasini')
OPS = BASE / 'ops/ci'
ROOT_COMMAND = OPS / 'deploy-root'
CI_USER = 'tomasini-ci'
MAX_ARCHIVE = 3 * 1024 * 1024
MAX_UNPACKED = 64 * 1024 * 1024
MAX_MEMBERS = 5000
MAX_BUILT = 1024 * 1024 * 1024
DIAGNOSTIC_DIRECTORY = None
SAFE_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}
COMMAND = re.compile(r'deploy ([a-f0-9]{64}) ([a-f0-9]{40})\Z')
ALLOWED_FILES = {'package.json', 'package-lock.json', 'backend/package.json', 'backend/prisma.config.ts',
                 'backend/tsconfig.json', 'backend/tsconfig.build.json', 'frontend/package.json', 'infra/backup.py',
                 'backend/scripts/bootstrap-admin.ts', 'backend/scripts/migrate.ts', 'backend/scripts/run-notifications.ts'}
ALLOWED_TREES = ('backend/prisma/', 'backend/src/', 'backend/dist/', 'frontend/dist/')


class DeployError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise DeployError(message)


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            result.update(chunk)
    return result.hexdigest()


def parse_command(value):
    match = COMMAND.fullmatch(value)
    require(match is not None, 'Only deploy SHA256 COMMIT is accepted.')
    return match.groups()


def receive():
    release_sha, commit = parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    # No caller-controlled paths/arguments reach sudo. The root process validates the protocol again.
    child = subprocess.Popen(['/usr/bin/sudo', '-n', '--', str(ROOT_COMMAND)], stdin=subprocess.PIPE, env=SAFE_ENV)
    try:
        child.stdin.write(json.dumps({'release': release_sha, 'commit': commit}).encode() + b'\n')
        size = 0
        while True:
            chunk = sys.stdin.buffer.read(65536)
            if not chunk:
                break
            size += len(chunk)
            require(size <= MAX_ARCHIVE, 'Archive exceeds the allowed size.')
            child.stdin.write(chunk)
        child.stdin.close()
        signal.alarm(0)
        return child.wait(timeout=1200)
    finally:
        if child.poll() is None:
            child.stdin.close()
            child.wait(timeout=1200)


def read_archive(stream, path, expected):
    total = 0
    result = hashlib.sha256()
    with path.open('xb') as output:
        os.chmod(path, 0o600)
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            total += len(chunk)
            require(total <= MAX_ARCHIVE, 'Archive exceeds the allowed size.')
            result.update(chunk)
            output.write(chunk)
    require(total > 0 and result.hexdigest() == expected, 'Archive hash does not match.')


def permitted_path(name, directory=False):
    require(name and not name.startswith('/') and '\\' not in name and '\x00' not in name, 'Invalid archive path.')
    parts = name.rstrip('/').split('/')
    require(all(part not in ('', '.', '..') for part in parts), 'Invalid archive path.')
    require(not any(part.startswith('.') or part in ('node_modules', '__pycache__') for part in parts), 'Private or unexpected archive path.')
    normalized = '/'.join(parts)
    require(len(normalized) < 240, 'Archive path too long.')
    allowed = normalized in ALLOWED_FILES or any((normalized + '/').startswith(prefix) for prefix in ALLOWED_TREES)
    if directory:
        allowed = allowed or any(item.startswith(normalized + '/') for item in ALLOWED_FILES | set(ALLOWED_TREES))
    require(allowed, 'Archive contains an unapproved path.')
    return normalized


def extract_verified(archive, destination):
    # Bound decompression before tarfile interprets extended headers or allocates member data.
    with tempfile.TemporaryFile() as expanded, gzip.open(archive, 'rb') as compressed:
        expanded_size = 0
        while True:
            chunk = compressed.read(65536)
            if not chunk:
                break
            expanded_size += len(chunk)
            require(expanded_size <= MAX_UNPACKED + MAX_MEMBERS * 1024 + 10240, 'Expanded gzip stream exceeds the allowed size.')
            expanded.write(chunk)
        expanded.seek(0)
        with tarfile.open(fileobj=expanded, mode='r:') as bundle:
            _extract_tar(bundle, destination)


def _extract_tar(bundle, destination):
    seen, members, total = set(), [], 0
    for member in bundle:
        require(len(members) < MAX_MEMBERS, 'Archive contains too many members.')
        require(member.isdir() or member.isfile(), 'Links and special archive entries are forbidden.')
        name = permitted_path(member.name, member.isdir())
        require(name not in seen, 'Duplicate archive entry.')
        require(member.size >= 0 and not member.sparse, 'Sparse/invalid archive member.')
        total += member.size
        require(total <= MAX_UNPACKED, 'Expanded archive exceeds the allowed size.')
        seen.add(name)
        members.append((name, member))
    for name, member in members:
        target = destination / name
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True, mode=0o755)
        else:
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            with bundle.extractfile(member) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            os.chmod(target, 0o644)
    # The privileged receiver has umask077; source is public code for the isolated builder.
    for parent, directories, files in os.walk(destination):
        os.chmod(parent, 0o755)
    for required in ['package.json', 'package-lock.json', 'backend/dist/server.js', 'backend/prisma/schema.prisma', 'frontend/dist/index.html']:
        require((destination / required).is_file(), 'Required release file missing.')


def schema_manifest(release):
    prisma = release / 'backend/prisma'
    result = {}
    for path in sorted(prisma.rglob('*')):
        require(not path.is_symlink(), 'Prisma source cannot contain symlinks.')
        if path.is_file():
            result[path.relative_to(prisma).as_posix()] = digest(path)
    require('schema.prisma' in result and any(name.endswith('/migration.sql') for name in result), 'Incomplete Prisma history.')
    return result


def verify_no_schema_change(old, incoming):
    require(schema_manifest(old) == schema_manifest(incoming), 'Schema/migration changes require a separately reviewed manual deployment.')


def active_release_sha(old):
    candidates = [BASE / 'private/ci' / old.name / 'receipt.json', BASE / 'private/updates' / old.name / 'receipt.json', BASE / 'private/installed.json']
    matches = set()
    for path in candidates:
        if path.is_file() and not path.is_symlink():
            value = json.loads(path.read_text()).get('release', '')
            if re.fullmatch('[a-f0-9]{64}', value) and value.startswith(old.name):
                matches.add(value)
    require(len(matches) == 1, 'The active release has no unambiguous full receipt hash.')
    return matches.pop()


def root_helpers():
    # Python -I ignores caller PYTHONPATH and the uploaded release is never imported as root.
    require(Path(__file__).resolve().parent == OPS, 'Deployer is not installed in the trusted directory.')
    for path in [OPS, OPS / 'ci_deploy.py', OPS / 'install_vps.py', OPS / 'update_vps.py']:
        info = path.lstat()
        require(info.st_uid == 0 and not stat.S_ISLNK(info.st_mode) and info.st_mode & 0o022 == 0, 'Operational code is not immutable.')
    sys.path.insert(0, str(OPS))
    import install_vps as core
    import update_vps as update
    return core, update


def build_arguments(source, identifier, probe=False):
    state = 'tomasini-ci-build-' + identifier
    unit = state + '.service'
    script = 'set -eu\ntest "$(stat -c %d /tmp)" = "$(stat -c %d .)"\ntest "$(stat -c %d /var/tmp)" = "$(stat -c %d .)"\ncp -R --no-preserve=ownership /input/. .\n/runtime/bin/node /runtime/lib/node_modules/npm/bin/npm-cli.js ci --include=dev --no-audit --no-fund\n/runtime/bin/node /runtime/lib/node_modules/npm/bin/npm-cli.js run db:generate --workspace @tomasini/backend\n'
    if probe:
        script = 'set -eu\ntest "$(id -u)" -ne 0\ntest ! -e /opt/tomasini/private\ntest ! -e /var/www\ntest ! -w /runtime\n' + script + '/runtime/bin/node --version > probe.txt\n'
    properties = [
        'DynamicUser=yes', 'User=tomasini-ci-build', f'StateDirectory={state}', 'StateDirectoryMode=0700',
        f'WorkingDirectory=/var/lib/{state}/project', 'PrivateTmp=yes', 'PrivateDevices=yes', 'ProtectSystem=strict',
        'ProtectHome=yes', 'ProtectProc=invisible', 'ProcSubset=pid', 'NoNewPrivileges=yes',
        'CapabilityBoundingSet=', 'RestrictSUIDSGID=yes', 'RestrictNamespaces=yes', 'LockPersonality=yes',
        'MemoryMax=1G', 'CPUQuota=40%', 'TasksMax=128', 'RuntimeMaxSec=900', 'KillMode=control-group',
        'TemporaryFileSystem=/opt:ro /var:ro /srv:ro',
        # Explicit binds take precedence over DynamicUser's implicit PrivateTmp on systemd255.
        # Both temporary locations share the same hard disk quota as the build itself.
        f'BindPaths=/var/lib/private/{state}/.ci-tmp:/tmp /var/lib/private/{state}/.ci-var-tmp:/var/tmp',
        f'BindReadOnlyPaths={source}:/input {BASE}/runtime:/runtime',
        'InaccessiblePaths=-/run/postgresql -/run/redis -/etc/postgresql -/etc/ssh',
        # systemd-run's D-Bus property parser accepts one prefix per assignment.
        'IPAddressDeny=127.0.0.0/8', 'IPAddressDeny=::1/128', 'IPAddressDeny=72.60.50.213/32',
        'IPAddressDeny=10.0.0.0/8', 'IPAddressDeny=172.16.0.0/12', 'IPAddressDeny=192.168.0.0/16',
        'IPAddressAllow=127.0.0.53/32',
        'Environment=NODE_ENV=production PATH=/runtime/bin:/usr/bin:/bin HOME=/tmp npm_config_cache=/tmp/npm-cache XDG_CACHE_HOME=/tmp/cache',
    ]
    return ['systemd-run', '--wait', '--pipe', '--collect', '--quiet', f'--unit={unit}',
            *[f'--property={value}' for value in properties], '/bin/sh', '-c', script]


def bounded_build_command(arguments, logfile):
    # Stream untrusted npm output, retaining at most 1MiB and stopping at 8MiB total.
    # Never use capture_output/communicate, which would allocate unbounded root memory.
    process = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=SAFE_ENV, cwd='/')
    total, retained, deadline = 0, 0, time.monotonic() + 960
    try:
        with logfile.open('xb') as output, selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                require(time.monotonic() < deadline, 'Build exceeded its timeout.')
                for key, events in selector.select(timeout=1):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    total += len(chunk)
                    require(total <= 8 * 1024 * 1024, 'Build output exceeded its limit.')
                    accepted = chunk[:max(0, 1024 * 1024 - retained)]
                    output.write(accepted)
                    retained += len(accepted)
        require(process.wait(timeout=5) == 0, 'Isolated preparation failed; inspect private build.log.')
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        process.stdout.close()


def allocate_build_volume(core, identifier, directory):
    require(re.fullmatch('[a-f0-9]{16}', identifier) is not None, 'Invalid build identifier.')
    require(directory.resolve() == BASE / 'private/ci' / identifier and directory.is_dir() and not directory.is_symlink() and directory.stat().st_uid == 0, 'Build image must stay in the private deployment directory.')
    parent = Path('/var/lib/private')
    if not parent.exists() and not parent.is_symlink():
        parent.mkdir(mode=0o700)
    require(parent.is_dir() and not parent.is_symlink() and parent.stat().st_uid == 0 and parent.stat().st_mode & 0o077 == 0, 'Private build parent has unexpected ownership/permissions.')
    state = 'tomasini-ci-build-' + identifier
    build = Path('/var/lib/private') / state
    image = directory / 'build.ext4'
    require(not build.exists() and not build.is_symlink() and not (Path('/var/lib') / state).exists() and not image.exists(), 'Build resources already exist.')
    build.mkdir(mode=0o700)
    fd = os.open(image, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb'):
        pass
    info = image.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'Build image must be a new root-owned regular file.')
    core.run(['/usr/bin/fallocate', '-l', '768M', str(image)], label='Reservar disco exclusivo CI')
    os.chmod(image, 0o600)
    core.run(['/usr/sbin/mkfs.ext4', '-q', '-F', '-m', '0', str(image)], label='Formatear exclusivamente imagen CI nueva')
    core.run(['/usr/bin/mount', '-o', 'loop,nosuid,nodev', str(image), str(build)], label='Montar exclusivamente workspace CI nuevo')
    device = core.run(['/usr/bin/findmnt', '-n', '-o', 'SOURCE', '--target', str(build)])
    require(re.fullmatch(r'/dev/loop\d+', device) and os.path.ismount(build), 'Unexpected build mount.')
    for name in ['.ci-tmp', '.ci-var-tmp']:
        (build / name).mkdir(mode=0o1777)
        os.chmod(build / name, 0o1777)
    (build / 'project').mkdir(mode=0o700)
    return {'build': build, 'project': build / 'project', 'image': image, 'state': state, 'device': device}


def cleanup_build_volume(core, volume, discard):
    build, image = volume['build'], volume['image']
    require(build.parent == Path('/var/lib/private') and build.name == volume['state'], 'Unexpected cleanup target.')
    device = core.run(['/usr/bin/findmnt', '-n', '-o', 'SOURCE', '--target', str(build)])
    require(device == volume['device'] and os.path.ismount(build), 'Build mount changed; do not unmount.')
    core.run(['/usr/bin/umount', '--', str(build)], label='Desmontar únicamente workspace CI propio')
    alias = Path('/var/lib') / volume['state']
    if alias.is_symlink():
        require(alias.resolve() == build, 'Build alias changed; do not unlink.')
        alias.unlink()
    build.rmdir()
    if discard:
        require(image.name == 'build.ext4' and image.is_file() and not image.is_symlink() and image.stat().st_uid == 0, 'Unexpected build image.')
        image.unlink()


def build_isolated(core, source, identifier, directory, probe=False):
    volume = allocate_build_volume(core, identifier, directory)
    unit = volume['state'] + '.service'
    try:
        require(core.run(['systemctl', 'show', unit, '-p', 'LoadState', '--value'], check=False) == 'not-found', 'Build unit already exists.')
        try:
            bounded_build_command(build_arguments(source, identifier, probe), directory / 'build.log')
        finally:
            core.run(['systemctl', 'stop', unit], check=False, label='Cerrar únicamente build CI propio')
        return volume
    except Exception:
        cleanup_build_volume(core, volume, discard=False)
        raise


def verify_built_tree(build):
    require(build.is_dir() and not build.is_symlink(), 'Generated project must be a real directory.')
    total, count = 0, 0
    inodes = {}
    for parent, directories, files in os.walk(build, followlinks=False):
        for name in directories + files:
            path = Path(parent) / name
            info = path.lstat()
            count += 1
            require(count <= 150000, 'Generated release contains too many files.')
            if stat.S_ISLNK(info.st_mode):
                require(not os.path.isabs(os.readlink(path)), 'Generated links must be relative.')
                require(path.resolve().is_relative_to(build.resolve()), 'Generated link escapes the release.')
            else:
                require(stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode), 'Generated release has a special file.')
                if stat.S_ISREG(info.st_mode):
                    identity = (info.st_dev, info.st_ino)
                    occurrences, expected = inodes.get(identity, (0, info.st_nlink))
                    require(expected == info.st_nlink, 'Generated hardlink metadata changed.')
                    inodes[identity] = (occurrences + 1, expected)
                    total += info.st_size
                    require(total <= MAX_BUILT, 'Generated release is too large.')
    # esbuild legitimately hardlinks its binary inside node_modules. Every link must be inside this tree.
    require(all(occurrences == expected for occurrences, expected in inodes.values()), 'Generated hardlink has an external name.')


def freeze_copy(build, release):
    verify_built_tree(build)
    shutil.copytree(build, release, symlinks=True)
    for parent, directories, files in os.walk(release, followlinks=False):
        for path in [Path(parent)] + [Path(parent) / name for name in directories + files]:
            if path.is_symlink():
                os.lchown(path, 0, 0)
            else:
                os.chown(path, 0, 0)
                # Preserve execution for package engines/scripts, remove all special bits and write access.
                os.chmod(path, 0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)


def deploy_root(stream):
    global DIAGNOSTIC_DIRECTORY
    require(os.geteuid() == 0 and os.environ.get('SUDO_USER') == CI_USER, 'Dedicated sudo identity required.')
    header = stream.readline(201)
    require(len(header) <= 200 and header.endswith(b'\n'), 'Invalid protocol header.')
    request = json.loads(header)
    require(set(request) == {'release', 'commit'}, 'Unexpected protocol fields.')
    release_sha, commit = parse_command(f"deploy {request['release']} {request['commit']}")
    core, update = root_helpers()
    directory = BASE / 'private/ci' / release_sha[:16]
    release = BASE / 'releases' / release_sha[:16]
    lock_fd = os.open(BASE / 'private/update.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'a') as lock:
        info = os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'Unexpected deployment lock.')
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(not directory.exists() and not directory.is_symlink() and not release.exists() and not release.is_symlink(), 'Release already exists; inspect its receipt instead of retrying.')
        directory.mkdir(mode=0o700)
        DIAGNOSTIC_DIRECTORY = directory
        archive = directory / 'release.tar.gz'
        read_archive(stream, archive, release_sha)
        signal.alarm(0)
        old = (BASE / 'current').resolve(strict=True)
        require((BASE / 'current').is_symlink() and old.parent == BASE / 'releases' and re.fullmatch('[a-f0-9]{16}', old.name), 'Current release identity is invalid.')
        require(old.stat().st_uid == 0 and old.stat().st_mode & 0o022 == 0, 'Current release is not immutable.')
        previous_sha = active_release_sha(old)
        require(core.run(['systemctl', 'is-active', 'tomasini.service']) == 'active', 'Tomasini must be healthy before deployment.')
        update.verify_tomasini()
        update.runtime_environment()
        require(shutil.disk_usage('/opt').free > 4 * 1024**3, 'Insufficient space for backup/build/release.')
        source = directory / 'source'
        source.mkdir(mode=0o755)
        extract_verified(archive, source)
        verify_no_schema_change(old, source)
        migrations = [{'name': path.parent.name, 'sha256': digest(path)} for path in sorted((source / 'backend/prisma/migrations').glob('*/migration.sql'))]
        update.check_history(update.migration_history(), migrations, [])
        snapshot = core.snapshot_existing()
        snapshot.update({'apiEnvSha256': digest(update.APP_ENV), 'hbaSha256': digest(core.HBA), 'serviceSha256': digest(core.UNIT), 'counts': update.counts()})
        update.verify_preserved(snapshot)
        core.write_new(directory / 'preflight.json', json.dumps(snapshot, indent=2))
        switched, phase = False, 'build'
        try:
            volume = build_isolated(core, source, release_sha[:16], directory)
            try:
                freeze_copy(volume['project'], release)
            finally:
                cleanup_build_volume(core, volume, discard=True)
            verify_no_schema_change(old, release)
            phase = 'backup'
            backup = BASE / 'backups' / f'ci-{release_sha[:16]}-before.dump'
            require(not backup.exists() and not backup.is_symlink(), 'Backup already exists.')
            core.run(['/usr/bin/pg_dump', '-h', '127.0.0.1', '-U', 'tomasini_prod_backup', '-d', 'tomasini_prod', '-Fc', '--no-owner', '--no-acl', '-f', str(backup)],
                     env={**SAFE_ENV, 'PGPASSFILE': str(BASE / 'private/backup.pgpass'), 'PGCONNECT_TIMEOUT': '10'}, timeout=180, label='Respaldo previo CI')
            os.chmod(backup, 0o600)
            core.run(['/usr/bin/pg_restore', '--list', str(backup)], label='Validar respaldo CI')
            core.write_new(directory / 'backup-manifest.json', json.dumps({'database': 'tomasini_prod', 'sha256': digest(backup), 'purpose': 'before-code-only-ci', 'createdAt': time.time()}))
            update.verify_preserved(snapshot)
            phase = 'activate'
            update.switch_release(release, old)
            switched = True
            core.run(['systemctl', 'restart', 'tomasini.service'], label='Activar únicamente Tomasini')
            update.verify_tomasini()
            update.verify_public_release(release)
            update.verify_preserved(snapshot)
            update.check_history(update.migration_history(), migrations, [])
            postflight = core.snapshot_existing()
            postflight.update({'apiEnvSha256': digest(update.APP_ENV), 'counts': update.counts()})
            core.write_new(directory / 'postflight.json', json.dumps(postflight, indent=2))
            receipt = {'status': 'deployed', 'kind': 'code-only-ci', 'commit': commit, 'release': release_sha,
                       'previousRelease': previous_sha, 'database': 'tomasini_prod', 'timestamp': time.time(),
                       'verification': {'existingApplicationsPreserved': True, 'apiEnvironmentPreserved': True, 'migrationRoleLocked': True,
                                        'schemaUnchanged': True, 'backupBeforeActivation': True, 'publicReadiness': 200}}
            core.write_new(directory / 'receipt.json', json.dumps(receipt, indent=2))
        except Exception as error:
            rollback = False
            if switched:
                try:
                    update.switch_release(old, release)
                    core.run(['systemctl', 'restart', 'tomasini.service'], label='Restituir solo código anterior Tomasini')
                    update.verify_tomasini()
                    rollback = True
                except Exception:
                    pass
            core.write_new(directory / 'failure.json', json.dumps({'phase': phase, 'timestamp': time.time(), 'codeRollbackVerified': rollback, 'databaseChanged': False, 'errorType': type(error).__name__}))
            raise
        # Stdout is a receipt, never process output, private paths, database contents or credentials.
        print(json.dumps({key: receipt[key] for key in ('status', 'commit', 'release', 'previousRelease')}), flush=True)
    return 0


def main():
    try:
        require(len(sys.argv) == 2 and sys.argv[1] in ('receive', 'root'), 'Invalid entrypoint.')
        os.umask(0o077)
        # A stalled SSH upload must not keep a privileged reader indefinitely.
        if hasattr(signal, 'alarm'):
            def upload_timeout(signum, frame):
                raise DeployError('SSH upload exceeded its timeout.')
            signal.signal(signal.SIGALRM, upload_timeout)
            signal.alarm(120)
        return receive() if sys.argv[1] == 'receive' else deploy_root(sys.stdin.buffer)
    except Exception as error:
        if DIAGNOSTIC_DIRECTORY is not None:
            try:
                path = DIAGNOSTIC_DIRECTORY / 'failure.json'
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'w') as output:
                    json.dump({'phase': 'preflight-or-upload', 'timestamp': time.time(), 'errorType': type(error).__name__, 'detail': str(error)[:4000], 'databaseChanged': False}, output)
            except OSError:
                pass
        print(json.dumps({'status': 'failed', 'error': type(error).__name__, 'message': 'Deployment stopped; inspect the private Tomasini receipt/diagnostic. No automatic retry.'}), file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
