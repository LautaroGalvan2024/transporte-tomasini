#!/usr/bin/python3
"""One-time, reviewed bootstrap of Tomasini-only SSH deployment access. Never installs the app."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
try:
    import pwd
except ImportError:
    pwd = None
import re
import shutil
import subprocess
import sys
import time

BASE = Path('/opt/tomasini')
OPS = BASE / 'ops/ci'
CI_HOME = Path('/var/lib/tomasini-ci')
SUDOERS = Path('/etc/sudoers.d/tomasini-ci')
SAFE_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(arguments, input=None):
    result = subprocess.run(arguments, input=input, capture_output=True, text=True, env=SAFE_ENV, timeout=30, cwd='/')
    require(result.returncode == 0, 'Bootstrap command failed; inspect private setup diagnostics.')
    return result.stdout.strip()


def public_key(value):
    parts = value.strip().split()
    require(len(parts) in (2, 3) and parts[0] == 'ssh-ed25519', 'Use the dedicated Ed25519 public key.')
    raw = base64.b64decode(parts[1], validate=True)
    require(len(raw) == 51 and raw[:19] == b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20', 'Invalid Ed25519 public key.')
    return 'ssh-ed25519 ' + parts[1] + ' tomasini-github-actions'


def root_file(path, content, mode=0o600, created=None):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    if created:
        info = os.fstat(fd)
        created((info.st_dev, info.st_ino))
    with os.fdopen(fd, 'wb') as output:
        output.write(content if isinstance(content, bytes) else content.encode())
    os.chown(path, 0, 0)
    os.chmod(path, mode)


def export_diagnostic(source, probe_directory, error=None):
    require(source.parent == Path('/home/mozzi') and re.fullmatch(r'tomasini-ci-(?:bootstrap|repair)-[a-f0-9]{16}', source.name), 'Unexpected diagnostic destination.')
    payload = {'status': 'failed' if error else 'probe_passed', 'errorType': type(error).__name__ if error else None,
               'message': str(error)[:2000] if error else None, 'buildLog': ''}
    if probe_directory is not None:
        require(probe_directory.parent == BASE / 'private/ci' and re.fullmatch('[a-f0-9]{16}', probe_directory.name), 'Unexpected probe diagnostic source.')
        log = probe_directory / 'build.log'
        if log.is_file() and not log.is_symlink():
            with log.open('rb') as stream:
                payload['buildLog'] = stream.read(1024 * 1024).decode('utf-8', errors='replace')
    destination = source / 'ci-build-diagnostic.json'
    root_file(destination, json.dumps(payload, indent=2))
    identity = pwd.getpwnam('mozzi')
    os.chown(destination, identity.pw_uid, identity.pw_gid)


def bootstrap(args, recovery=None):
    require(os.geteuid() == 0 and sys.platform.startswith('linux'), 'Run the reviewed bootstrap with sudo on the VPS.')
    os.umask(0o077)
    source = Path(__file__).resolve().parent
    manifest = json.loads(Path(args.manifest).read_text())
    expected = manifest['expectedRelease']
    require(re.fullmatch('[a-f0-9]{64}', expected), 'Invalid expected deployment.')
    names = {'ci_deploy.py', 'install_vps.py', 'update_vps.py', 'setup_ci.py', 'ci.pub'}
    require(set(manifest['files']) == names, 'Unexpected bootstrap files.')
    for name, fingerprint in manifest['files'].items():
        path = source / name
        require(not path.is_symlink() and path.is_file() and re.fullmatch('[a-f0-9]{64}', fingerprint) and sha256(path) == fingerprint, 'Bootstrap file differs from the reviewed copy.')
    key = public_key((source / 'ci.pub').read_text())
    current = BASE / 'current'
    require(current.is_symlink() and current.resolve() == BASE / 'releases' / expected[:16], 'The active application differs from the reviewed release.')
    receipt_path = BASE / 'private/updates' / expected[:16] / 'receipt.json'
    require(json.loads(receipt_path.read_text())['release'] == expected, 'The installed receipt does not match.')
    forbidden = [CI_HOME, SUDOERS, BASE / 'private/ci-bootstrap.json']
    if recovery is None:
        forbidden += [OPS, BASE / 'private/ci']
    else:
        require(recovery['failedSha256'] == sha256(BASE / 'private/ci-bootstrap-failed.json'), 'The failed bootstrap changed after recovery validation.')
        for name in ['ci_deploy.py', 'install_vps.py', 'update_vps.py']:
            require(sha256(OPS / name) == manifest['files'][name], 'Recovery helpers do not match the reviewed replacement.')
    for target in forbidden:
        require(not target.exists() and not target.is_symlink(), 'CI resources already exist; do not repeat bootstrap.')
    try:
        pwd.getpwnam('tomasini-ci')
        raise RuntimeError('The CI account already exists.')
    except KeyError:
        pass
    try:
        pwd.getpwnam('tomasini-ci-build')
        raise RuntimeError('The transient build identity is already occupied.')
    except KeyError:
        pass
    sshd = dict(line.split(' ', 1) for line in run(['/usr/sbin/sshd', '-T', '-C', 'user=tomasini-ci,host=localhost,addr=127.0.0.1']).splitlines() if ' ' in line)
    require(sshd.get('pubkeyauthentication') == 'yes' and '.ssh/authorized_keys' in sshd.get('authorizedkeysfile', '').split(), 'SSH does not support the isolated authorized_keys path.')
    require(sshd.get('usepam') == 'yes', 'The locked CI account needs the reviewed PAM/key-authentication policy.')
    require(sshd.get('authorizedkeyscommand', 'none') == 'none' and sshd.get('forcecommand', 'none') == 'none', 'Existing SSH command policy needs manual review.')
    require(not sshd.get('allowusers') and not sshd.get('allowgroups') and not sshd.get('denyusers') and not sshd.get('denygroups'), 'Existing SSH account policy needs manual review.')
    sys.path.insert(0, str(source))
    import install_vps as core
    before = core.snapshot_existing()
    require(all(status == 200 for status in before['health'].values()), 'An existing application is unhealthy.')
    require(core.status_http(f'https://{core.HOST}/api/ready') == 200, 'Tomasini is unhealthy.')
    own_pid = core.run(['systemctl', 'show', 'tomasini.service', '-p', 'MainPID', '--value'])
    env_sha = sha256(BASE / 'private/api.env')
    require(shutil.disk_usage('/opt').free > 4 * 1024**3, 'Insufficient space for the bounded build probe.')
    ops_parent = OPS.parent
    if ops_parent.exists():
        require(ops_parent.is_dir() and not ops_parent.is_symlink() and ops_parent.stat().st_uid == 0 and ops_parent.stat().st_mode & 0o022 == 0, 'Operational parent must be immutable.')
    else:
        ops_parent.mkdir(mode=0o755)
        os.chmod(ops_parent, 0o755)
    if recovery is None:
        OPS.mkdir(mode=0o755)
        os.chmod(OPS, 0o755)
    access_files = {}
    probe_directory = None
    try:
        if recovery is None:
            for name in ['ci_deploy.py', 'install_vps.py', 'update_vps.py']:
                root_file(OPS / name, (source / name).read_bytes(), 0o644)
                require(sha256(OPS / name) == manifest['files'][name], 'Operational copy hash mismatch.')
            root_file(OPS / 'deploy-root', '#!/bin/sh\n[ "$#" -eq 0 ] || exit 64\nexec /usr/bin/python3 -I /opt/tomasini/ops/ci/ci_deploy.py root\n', 0o755)
            (BASE / 'private/ci').mkdir(mode=0o700)
        # Exercise the complete Linux preparation path before granting unattended access.
        sys.path.insert(0, str(OPS))
        import ci_deploy as ci
        probe_id = sha256(Path(args.manifest))[:16]
        probe_directory = BASE / 'private/ci' / probe_id
        probe_directory.mkdir(mode=0o700)
        probe_source = probe_directory / 'source'
        probe_source.mkdir(mode=0o755)
        for name in sorted(ci.ALLOWED_FILES):
            target = probe_source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(current / name, target)
            os.chmod(target, 0o644)
        for name in ci.ALLOWED_TREES:
            shutil.copytree(current / name, probe_source / name, symlinks=True)
        for parent, directories, files in os.walk(probe_source):
            os.chmod(parent, 0o755)
        volume = ci.build_isolated(core, probe_source, probe_id, probe_directory, probe=True)
        try:
            ci.verify_built_tree(volume['project'])
            require((volume['project'] / 'probe.txt').read_text().strip() == 'v24.21.0', 'The build sandbox did not use the pinned Node runtime.')
            ci.verify_no_schema_change(current, volume['project'])
        finally:
            ci.cleanup_build_volume(core, volume, discard=True)
        root_file(probe_directory / 'probe-receipt.json', json.dumps({'status': 'full_build_probe_passed', 'runtime': '24.21.0', 'npmCi': True, 'prismaGenerate': True, 'schemaUnchanged': True, 'applicationNotActivated': True}))
        run(['/usr/sbin/useradd', '--system', '--user-group', '--home-dir', str(CI_HOME), '--no-create-home', '--shell', '/bin/sh', 'tomasini-ci'])
        run(['/usr/sbin/usermod', '--lock', 'tomasini-ci'])
        CI_HOME.mkdir(mode=0o755)
        os.chmod(CI_HOME, 0o755)
        (CI_HOME / '.ssh').mkdir(mode=0o755)
        os.chmod(CI_HOME / '.ssh', 0o755)
        rule = 'Defaults:tomasini-ci env_reset,!requiretty\ntomasini-ci ALL=(root) NOPASSWD: /opt/tomasini/ops/ci/deploy-root ""\n'
        rule_path = OPS / 'sudoers.reviewed'
        root_file(rule_path, rule, 0o440)
        run(['/usr/sbin/visudo', '-cf', str(rule_path)])
        root_file(SUDOERS, rule, 0o440, lambda identity: access_files.__setitem__(SUDOERS, identity))
        run(['/usr/sbin/visudo', '-cf', '/etc/sudoers'])
        authorized_keys = CI_HOME / '.ssh/authorized_keys'
        root_file(authorized_keys, 'restrict,command="/usr/bin/python3 -I /opt/tomasini/ops/ci/ci_deploy.py receive" ' + key + '\n', 0o644, lambda identity: access_files.__setitem__(authorized_keys, identity))
        core.verify_existing(before)
        require(core.run(['systemctl', 'show', 'tomasini.service', '-p', 'MainPID', '--value']) == own_pid and core.status_http(f'https://{core.HOST}/api/ready') == 200, 'Application changed during access bootstrap.')
        require(sha256(BASE / 'private/api.env') == env_sha, 'Application environment changed.')
        receipt = {'status': 'ci_access_configured', 'user': 'tomasini-ci', 'host': '72.60.50.213', 'expectedRelease': expected,
                   'publicKey': key, 'timestamp': time.time(), 'files': manifest['files'],
                   'verification': {'existingApplicationsPreserved': True, 'applicationNotRestarted': True, 'fullBuildProbePassed': True, 'schemaPolicy': 'identical-to-active-only'}}
        root_file(BASE / 'private/ci-bootstrap.json', json.dumps(receipt, indent=2))
        public_receipt = source / 'ci-public-receipt.json'
        require(source.parent == Path('/home/mozzi') and re.fullmatch(r'tomasini-ci-(?:bootstrap|repair)-[a-f0-9]{16}', source.name), 'Unexpected public receipt destination.')
        root_file(public_receipt, json.dumps(receipt, indent=2))
        os.chown(public_receipt, pwd.getpwnam('mozzi').pw_uid, pwd.getpwnam('mozzi').pw_gid)
        export_diagnostic(source, probe_directory)
        # Only the public receipt is returned; no credential is generated or exported by the VPS.
        print(json.dumps(receipt), flush=True)
        return 0
    except Exception as error:
        cleanup_issues = []
        for path, identity in reversed(list(access_files.items())):
            try:
                info = path.lstat()
                require((info.st_dev, info.st_ino) == identity and info.st_uid == 0 and not path.is_symlink(), 'An access file changed identity; do not remove it.')
                path.unlink()
            except Exception:
                cleanup_issues.append(path.name)
        key_path = CI_HOME / '.ssh/authorized_keys'
        try:
            root_file(BASE / 'private/ci-bootstrap-failed.json', json.dumps({'status': 'needs_review', 'timestamp': time.time(),
                      'keyDisabled': not (key_path.exists() or key_path.is_symlink()), 'sudoRuleRemoved': not (SUDOERS.exists() or SUDOERS.is_symlink()), 'cleanupIssues': cleanup_issues}))
        except Exception:
            pass
        try:
            export_diagnostic(source, probe_directory, error)
        except Exception:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args()
    try:
        return bootstrap(args)
    except Exception as error:
        try:
            source = Path(__file__).resolve().parent
            if not (source / 'ci-build-diagnostic.json').exists():
                export_diagnostic(source, None, error)
        except Exception:
            pass
        print(json.dumps({'status': 'failed', 'error': type(error).__name__, 'message': str(error)}), file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
