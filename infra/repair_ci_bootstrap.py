#!/usr/bin/python3
"""Recover only the known pre-access CI bootstrap failure; never reinstall or deploy the application."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
try:
    import pwd
except ImportError:
    pwd = None
import re
import sys
import time

BASE = Path('/opt/tomasini')
OPS = BASE / 'ops/ci'
OLD_MANIFEST_SHA = 'd2fb207d5d6eb240436dffee5b68cdb9022bab68a0b5adc786849f56fdc51f63'
OLD_RECEIVER_SHA = '118c9986be4465aa01c8b1aaa8d24897a3d5eaecdf0864dc889aff4ce0e21996'
EXPECTED_RELEASE = '1bce449e4b5e8c4a9b46ecedee9c37066b23e6ee2d3041ac7319acd82f949080'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_failure(receipt):
    require(receipt.get('status') == 'needs_review' and receipt.get('keyDisabled') is True and
            receipt.get('sudoRuleRemoved') is True and receipt.get('cleanupIssues') == [], 'Failure is not the known pre-access state.')


def repair(args):
    require(os.geteuid() == 0 and sys.platform.startswith('linux'), 'Recovery requires the reviewed sudo entry.')
    os.umask(0o077)
    source = Path(__file__).resolve().parent
    require(source.parent == Path('/home/mozzi') and re.fullmatch(r'tomasini-ci-repair-[a-f0-9]{16}', source.name), 'Unexpected recovery source directory.')
    manifest = json.loads(Path(args.manifest).read_text())
    names = {'repair_ci_bootstrap.py', 'setup_ci.py', 'ci_deploy.py', 'install_vps.py', 'update_vps.py', 'ci.pub', 'previous-setup.json', 'setup.json'}
    require(set(manifest['files']) == names, 'Unexpected recovery files.')
    for name, fingerprint in manifest['files'].items():
        path = source / name
        require(re.fullmatch('[a-f0-9]{64}', fingerprint) and path.is_file() and not path.is_symlink() and digest(path) == fingerprint, 'Recovery artifact changed after review.')
    require(digest(source / 'previous-setup.json') == OLD_MANIFEST_SHA, 'Wrong original bootstrap manifest.')
    previous = json.loads((source / 'previous-setup.json').read_text())
    new = json.loads((source / 'setup.json').read_text())
    require(previous['expectedRelease'] == new['expectedRelease'] == EXPECTED_RELEASE, 'Unexpected application baseline.')
    require(previous['files']['ci_deploy.py'] == OLD_RECEIVER_SHA and previous['files']['ci.pub'] == new['files']['ci.pub'], 'Wrong prior receiver or public key.')
    for name, fingerprint in new['files'].items():
        require(manifest['files'].get(name) == fingerprint, 'Nested setup manifest differs from recovery artifacts.')
    current = BASE / 'current'
    require(current.is_symlink() and current.resolve() == BASE / 'releases' / EXPECTED_RELEASE[:16], 'The application changed; do not recover automatically.')
    require(json.loads((BASE / 'private/updates' / EXPECTED_RELEASE[:16] / 'receipt.json').read_text())['release'] == EXPECTED_RELEASE, 'Application receipt changed.')
    for path in [OPS, BASE / 'private/ci']:
        require(path.is_dir() and not path.is_symlink() and path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0, 'Operational directory changed identity.')
    for name in ['ci_deploy.py', 'install_vps.py', 'update_vps.py']:
        path = OPS / name
        require(path.is_file() and not path.is_symlink() and path.stat().st_uid == 0 and path.stat().st_mode & 0o022 == 0 and digest(path) == previous['files'][name], 'Existing operational helper differs from the known failed attempt.')
    for name in ['install_vps.py', 'update_vps.py']:
        require(new['files'][name] == previous['files'][name], 'Recovery cannot replace shared operational helpers.')
    expected_wrapper = '#!/bin/sh\n[ "$#" -eq 0 ] || exit 64\nexec /usr/bin/python3 -I /opt/tomasini/ops/ci/ci_deploy.py root\n'
    wrapper = OPS / 'deploy-root'
    require(wrapper.is_file() and not wrapper.is_symlink() and wrapper.stat().st_uid == 0 and wrapper.stat().st_mode & 0o022 == 0 and wrapper.read_text() == expected_wrapper, 'Privileged entrypoint changed.')
    failure_path = BASE / 'private/ci-bootstrap-failed.json'
    require(failure_path.is_file() and not failure_path.is_symlink() and failure_path.stat().st_uid == 0, 'Missing protected original failure receipt.')
    validate_failure(json.loads(failure_path.read_text()))
    for path in [Path('/var/lib/tomasini-ci'), Path('/etc/sudoers.d/tomasini-ci'), BASE / 'private/ci-bootstrap.json', OPS / 'sudoers.reviewed']:
        require(not path.exists() and not path.is_symlink(), 'Access setup progressed beyond the recoverable phase.')
    for user in ['tomasini-ci', 'tomasini-ci-build']:
        try:
            pwd.getpwnam(user)
            raise RuntimeError('A CI identity already exists; do not repeat setup.')
        except KeyError:
            pass
    old_probe = BASE / 'private/ci' / OLD_MANIFEST_SHA[:16]
    require((old_probe / 'build.log').read_text().strip() == 'Failed to parse IP address prefix: localhost', 'The failure log is not the known parser failure.')
    old_image = old_probe / 'build.ext4'
    require(old_image.is_file() and not old_image.is_symlink() and old_image.stat().st_uid == 0 and old_image.stat().st_nlink == 1, 'Original build image missing or changed identity.')
    for path in [Path('/var/lib/private') / ('tomasini-ci-build-' + OLD_MANIFEST_SHA[:16]), Path('/var/lib') / ('tomasini-ci-build-' + OLD_MANIFEST_SHA[:16])]:
        require(not path.exists() and not path.is_symlink(), 'The original build still has an active mount or alias; do not recover.')
    sys.path.insert(0, str(source))
    import setup_ci as setup
    repair_id = digest(args.manifest)[:16]
    directory = BASE / 'private' / ('ci-repair-' + repair_id)
    require(not directory.exists() and not directory.is_symlink(), 'This recovery was already attempted.')
    directory.mkdir(mode=0o700)
    setup.root_file(directory / 'receiver.before.py', (OPS / 'ci_deploy.py').read_bytes())
    setup.root_file(directory / 'failure.before.json', failure_path.read_bytes())
    setup.root_file(directory / 'manifest.json', Path(args.manifest).read_bytes())
    setup.root_file(directory / 'validated.json', json.dumps({'status': 'validated_pre_access_recovery', 'failedSha256': digest(failure_path), 'originalReceiverSha256': OLD_RECEIVER_SHA, 'newReceiverSha256': new['files']['ci_deploy.py'], 'timestamp': time.time()}))
    temporary = OPS / ('receiver.repair-' + repair_id)
    setup.root_file(temporary, (source / 'ci_deploy.py').read_bytes(), 0o644)
    require(digest(OPS / 'ci_deploy.py') == OLD_RECEIVER_SHA and digest(temporary) == new['files']['ci_deploy.py'], 'Receiver changed before atomic replacement.')
    os.replace(temporary, OPS / 'ci_deploy.py')
    try:
        result = setup.bootstrap(argparse.Namespace(manifest=str(source / 'setup.json')), recovery={'failedSha256': digest(failure_path)})
        setup.root_file(directory / 'complete.json', json.dumps({'status': 'recovered_and_ci_configured', 'timestamp': time.time(), 'originalFailurePreserved': True, 'originalImagePreserved': True}))
        return result
    except Exception as error:
        setup.root_file(directory / 'failure.json', json.dumps({'status': 'needs_review', 'errorType': type(error).__name__, 'message': str(error)[:2000], 'timestamp': time.time()}))
        if not (source / 'ci-build-diagnostic.json').exists():
            setup.export_diagnostic(source, None, error)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    args = parser.parse_args()
    try:
        return repair(args)
    except Exception as error:
        # Even an early validation failure gets a bounded, credential-free receipt for the SSH user.
        try:
            source = Path(__file__).resolve().parent
            destination = source / 'ci-build-diagnostic.json'
            require(source.parent == Path('/home/mozzi') and re.fullmatch(r'tomasini-ci-repair-[a-f0-9]{16}', source.name), 'Invalid diagnostic destination.')
            if not destination.exists() and not destination.is_symlink():
                fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'w') as output:
                    json.dump({'status': 'failed', 'errorType': type(error).__name__, 'message': str(error)[:2000], 'buildLog': ''}, output)
                identity = pwd.getpwnam('mozzi')
                os.chown(destination, identity.pw_uid, identity.pw_gid)
        except Exception:
            pass
        print(json.dumps({'status': 'failed', 'error': type(error).__name__, 'message': str(error)}), file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
