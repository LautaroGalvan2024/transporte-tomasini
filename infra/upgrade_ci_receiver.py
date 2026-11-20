#!/usr/bin/python3
"""Install Tomasini's reviewed migration receiver using its existing CI access."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

BASE = Path('/opt/tomasini')
OPS = BASE / 'ops/ci'
RECEIVER = 'ci_deploy.py'
MODULE = 'ci_migrations.py'
OLD_RECEIVER_SHA = '18ff4271c160688ab68f1d0a18eb6816ca7a923ea1442745468b7111b7712e6f'
ADDITIVE_RECEIVER_SHA = '6d3fe86123af0bb6ed6c250a5b28581fc7b309647ddabc6407c8cd0a49f58b9d'
ADDITIVE_MODULE_SHA = '69b38d1bb4f4ea5f887e99d97a18cf665286d7f3aec7245d7112e75df07a4957'
PRE_DOMAIN_CORE_SHA = 'bb562b4683b3dccf5fa7c658fc1da6b9d197a98aba6d5c02ecd523d19d02c3f5'
DOMAIN_CORE_SHA = '8f706ab8f855f22f80bd54128fd2e9a8f070a2029fac78c8d453a52f51241694'
DOMAIN_HOSTS = ['transporte-tomasini.com', 'transporte-tomasini-api.com',
                'www.transporte-tomasini.com', 'www.transporte-tomasini-api.com']
WRAPPER = '#!/bin/sh\n[ "$#" -eq 0 ] || exit 64\nexec /usr/bin/python3 -I /opt/tomasini/ops/ci/ci_deploy.py root\n'
RULE = 'Defaults:tomasini-ci env_reset,!requiretty\ntomasini-ci ALL=(root) NOPASSWD: /opt/tomasini/ops/ci/deploy-root ""\n'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def protected(path, is_directory=False):
    info = path.lstat()
    right_type = stat.S_ISDIR(info.st_mode) if is_directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1
    require(right_type and info.st_uid == 0 and not info.st_mode & 0o022,
            'Unexpected owner, type or permissions: ' + str(path))


def verify_helper(name, bootstrap_sha):
    path = OPS / name
    protected(path)
    installed = digest(path.read_bytes())
    if installed == bootstrap_sha:
        return
    # domain_cutover.py preserved the original helper and recorded the replacement.
    require(name == 'install_vps.py' and bootstrap_sha == PRE_DOMAIN_CORE_SHA and installed == DOMAIN_CORE_SHA,
            'CI helper changed: ' + name)
    state = BASE / 'private/domain-cutover'
    protected(state, is_directory=True)
    original, receipt = state / 'core', state / 'active.json'
    protected(original)
    protected(receipt)
    cutover = json.loads(receipt.read_bytes())
    require(digest(original.read_bytes()) == bootstrap_sha and cutover.get('coreSha256') == installed
            and cutover.get('hosts') == DOMAIN_HOSTS, 'Unexpected Tomasini domain cutover evidence.')


def verify_ci_access():
    for directory in (BASE, OPS.parent, OPS, BASE / 'private'):
        protected(directory, is_directory=True)
    receipt_path = BASE / 'private/ci-bootstrap.json'
    protected(receipt_path)
    receipt = json.loads(receipt_path.read_bytes())
    require(receipt['status'] == 'ci_access_configured' and receipt['user'] == 'tomasini-ci'
            and receipt['files'][RECEIVER] == OLD_RECEIVER_SHA, 'Unexpected CI bootstrap receipt.')
    for name in ('install_vps.py', 'update_vps.py'):
        verify_helper(name, receipt['files'][name])
    authorized = Path('/var/lib/tomasini-ci/.ssh/authorized_keys')
    rule = Path('/etc/sudoers.d/tomasini-ci')
    for path in (OPS / 'deploy-root', authorized, rule):
        protected(path)
    expected_key = 'restrict,command="/usr/bin/python3 -I /opt/tomasini/ops/ci/ci_deploy.py receive" ' + receipt['publicKey'] + '\n'
    require((OPS / 'deploy-root').read_text() == WRAPPER and rule.read_text() == RULE
            and authorized.read_text() == expected_key, 'Tomasini CI credentials or forced entrypoint changed.')


def install(source, ops, expected):
    require(set(expected) == {RECEIVER, MODULE} and all(re.fullmatch(r'[a-f0-9]{64}', value) for value in expected.values()),
            'Unexpected upgrade files or fingerprints.')
    require(expected[RECEIVER] != OLD_RECEIVER_SHA, 'The proposed receiver is the code-only version.')
    data = {}
    for name in expected:
        path = source / name
        protected(path)
        data[name] = path.read_bytes()
        require(digest(data[name]) == expected[name], 'Reviewed file fingerprint differs: ' + name)
        compile(data[name], name, 'exec')
    receiver, module = ops / RECEIVER, ops / MODULE
    protected(receiver)
    old = receiver.read_bytes()
    original_sha = digest(old)
    require(original_sha in {OLD_RECEIVER_SHA, ADDITIVE_RECEIVER_SHA, expected[RECEIVER]}, 'Installed receiver is outside this upgrade.')
    has_module = module.exists() or module.is_symlink()
    previous_module = None
    if has_module:
        protected(module)
        previous_module = module.read_bytes()
        allowed = {expected[MODULE]} if original_sha == OLD_RECEIVER_SHA else {ADDITIVE_MODULE_SHA, expected[MODULE]}
        require(digest(previous_module) in allowed, 'Installed migration module differs from reviewed version.')
    require(original_sha == OLD_RECEIVER_SHA or has_module, 'New receiver is missing its migration module.')
    # With an additive receiver install the rollback guard first. A power loss must
    # never leave the old rollback logic paired with the expanded migration policy.
    order = (MODULE, RECEIVER) if original_sha == OLD_RECEIVER_SHA else (RECEIVER, MODULE)
    with tempfile.TemporaryDirectory(prefix='.upgrade-', dir=ops) as tmp:
        staged = Path(tmp)
        previous = {RECEIVER: old, MODULE: previous_module}
        backups = {'previous-' + name: content for name, content in previous.items() if content is not None}
        for name, content in (data | backups).items():
            path = staged / name
            path.write_bytes(content)
            path.chmod(0o644)
        replaced = []
        try:
            for name in order:
                if data[name] != previous[name]:
                    os.replace(staged / name, ops / name)
                    replaced.append(name)
            for name in expected:
                protected(ops / name)
                require(digest((ops / name).read_bytes()) == expected[name], 'Operational copy failed verification.')
            probe = ('import sys; sys.path.insert(0,sys.argv[1]); import ci_deploy,ci_migrations; '
                     'assert callable(ci_deploy.receive) and callable(ci_deploy.deploy_root); ci_deploy.root_helpers()')
            subprocess.run(['/usr/bin/python3', '-I', '-B', '-c', probe, str(ops)], cwd='/',
                           env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C.UTF-8'},
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=15, check=True)
        except BaseException:
            for name in reversed(replaced):
                if previous[name] is None:
                    (ops / name).unlink()
                else:
                    os.replace(staged / ('previous-' + name), ops / name)
            raise


def main():
    import fcntl
    import pwd
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receiver-sha', required=True)
    parser.add_argument('--module-sha', required=True)
    args = parser.parse_args()
    require(sys.platform.startswith('linux') and os.geteuid() == 0 and sys.flags.isolated and sys.dont_write_bytecode
            and os.environ.get('SUDO_USER') == 'mozzi', 'Run this upgrade through the reviewed sudo launcher.')
    source = Path(__file__).absolute().parent
    require(source.parent == Path('/run') and re.fullmatch(r'tomasini-ci-upgrade\.[a-zA-Z0-9]+', source.name),
            'Unexpected trusted staging directory.')
    protected(source, is_directory=True)
    protected(source / Path(__file__).name)
    require(pwd.getpwnam('tomasini-ci').pw_uid != 0, 'Invalid CI user.')
    verify_ci_access()
    lock_path = BASE / 'private/update.lock'
    protected(lock_path)
    with os.fdopen(os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW), 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        expected = {RECEIVER: args.receiver_sha, MODULE: args.module_sha}
        install(source, OPS, expected)
    print(json.dumps({'status': 'ci_receiver_upgraded', 'files': expected}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Tomasini CI upgrade stopped: {error}', file=sys.stderr)
        sys.exit(1)
