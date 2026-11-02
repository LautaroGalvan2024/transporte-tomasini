#!/usr/bin/python3
"""Run the real deploy sandbox only on a disposable GitHub-hosted Ubuntu runner."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

BASE = Path('/opt/tomasini')
REPOSITORY = 'LautaroGalvan2024/transporte-tomasini'
SAFE_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def guard_runner_environment(environment):
    require(environment.get('GITHUB_ACTIONS') == 'true', 'This smoke test only runs in GitHub Actions.')
    require(environment.get('RUNNER_ENVIRONMENT') == 'github-hosted' and environment.get('RUNNER_OS') == 'Linux',
            'This smoke test requires a disposable GitHub-hosted Linux runner.')
    require(environment.get('GITHUB_REPOSITORY') == REPOSITORY, 'Unexpected CI repository.')
    require(all(re.fullmatch(r'[1-9][0-9]*', environment.get(name, '')) for name in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT')),
            'Missing GitHub run identity.')
    require(environment.get('GITHUB_WORKSPACE') and environment.get('RUNNER_TOOL_CACHE'), 'Missing runner paths.')


def load_helper(name, workspace):
    specification = importlib.util.spec_from_file_location(name, workspace / 'infra' / (name + '.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def checked_output(arguments, check=True):
    result = subprocess.run(arguments, check=check, capture_output=True, text=True, env=SAFE_ENV, timeout=30)
    return result.stdout.strip()


def copy_release(workspace, destination, ci):
    """Copy exactly the production archive selection; never copy workspace dependencies or env files."""
    def copy(path, relative):
        info = path.lstat()
        ci.permitted_path(relative.as_posix(), stat.S_ISDIR(info.st_mode))
        target = destination / relative
        if stat.S_ISDIR(info.st_mode):
            target.mkdir(parents=True, exist_ok=True, mode=0o755)
            os.chmod(target, 0o755)
            for child in sorted(path.iterdir()):
                copy(child, relative / child.name)
        else:
            require(stat.S_ISREG(info.st_mode), 'Release input contains a link or special file.')
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            with path.open('rb') as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            os.chmod(target, 0o644)

    for name in sorted(ci.ALLOWED_FILES | set(ci.ALLOWED_TREES)):
        relative = Path(name.rstrip('/'))
        for parent in relative.parents:
            require(not (workspace / parent).is_symlink(), 'Release input parent cannot be a symlink.')
        copy(workspace / relative, relative)
    for parent, _, _ in os.walk(destination):
        os.chmod(parent, 0o755)
    require(not (destination / 'node_modules').exists(), 'Dependencies must be installed by the sandbox.')


def diagnostics(directory, unit):
    # The fake fixture has no credentials. JSON encoding keeps npm output from becoming workflow commands.
    log = directory / 'build.log'
    if log.is_file() and not log.is_symlink():
        with log.open('rb') as stream:
            stream.seek(max(0, log.stat().st_size - 16000))
            print(json.dumps({'sandboxLogTail': stream.read(16000).decode(errors='replace')}), flush=True)
    try:
        journal = checked_output(['/usr/bin/journalctl', '--unit', unit, '--no-pager', '--lines', '40', '--output', 'short'])
        print(json.dumps({'sandboxJournal': journal[-16000:]}), flush=True)
    except Exception:
        print('Sandbox journal unavailable.', flush=True)


def cleanup_fixture(core, ci, identifier, directory, original_identity, attempted):
    """Remove only this new fixture and its exact build mount; never recurse through a mounted image."""
    info = BASE.lstat()
    require((info.st_dev, info.st_ino) == original_identity and stat.S_ISDIR(info.st_mode) and info.st_uid == 0,
            'Fixture identity changed; cleanup stopped.')
    state = 'tomasini-ci-build-' + identifier
    build = Path('/var/lib/private') / state
    alias = Path('/var/lib') / state
    image = directory / 'build.ext4'
    if attempted:
        core.run(['systemctl', 'stop', state + '.service'], check=False)
        active = core.run(['systemctl', 'show', state + '.service', '-p', 'ActiveState', '--value'], check=False)
        require(active not in ('active', 'activating', 'deactivating', 'reloading'), 'Build is still running; cleanup stopped.')
    if os.path.ismount(build):
        device = core.run(['/usr/bin/findmnt', '-n', '-o', 'SOURCE', '--mountpoint', str(build)])
        require(re.fullmatch(r'/dev/loop[0-9]+', device), 'Unexpected fixture mount device.')
        backing = core.run(['/usr/sbin/losetup', '--noheadings', '--output', 'BACK-FILE', device])
        require(Path(backing).resolve() == image.resolve(), 'Build mount does not belong to the fixture.')
        ci.cleanup_build_volume(core, {'build': build, 'project': build / 'project', 'image': image,
                                     'state': state, 'device': device}, discard=True)
    else:
        if alias.is_symlink():
            require(alias.resolve() == build, 'Build alias changed; cleanup stopped.')
            alias.unlink()
        require(not alias.exists(), 'Unexpected build alias; cleanup stopped.')
        if build.exists():
            require(build.is_dir() and not build.is_symlink(), 'Unexpected build directory; cleanup stopped.')
            build.rmdir()  # Only an empty directory left by an interrupted allocation is allowed here.
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        target = line.split()[4]
        require(target != str(BASE) and not target.startswith(str(BASE) + '/'), 'A fixture mount remains; cleanup stopped.')
    shutil.rmtree(BASE)  # BASE was absent before this run, identity checked; symlink runtime is not followed.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--node', required=True)
    args = parser.parse_args()
    guard_runner_environment(os.environ)
    require(sys.platform.startswith('linux') and os.geteuid() == 0, 'Use sudo only on the disposable Linux runner.')
    workspace = Path(args.workspace).resolve(strict=True)
    require(workspace == Path(os.environ['GITHUB_WORKSPACE']).resolve(strict=True)
            and Path(__file__).resolve() == workspace / 'infra/ci_sandbox_smoke.py', 'Unexpected workspace/script path.')
    os_release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    require(os_release.get('ID', '').strip('"') == 'ubuntu' and os_release.get('VERSION_ID', '').strip('"') == '24.04',
            'The smoke test requires Ubuntu 24.04.')
    require(Path('/proc/1/comm').read_text().strip() == 'systemd', 'The runner must boot systemd.')
    require(checked_output(['/usr/bin/systemctl', '--version']).splitlines()[0].startswith('systemd 255 '),
            'Review compatibility before changing the systemd 255 smoke environment.')
    node = Path(args.node).resolve(strict=True)
    cache = Path(os.environ['RUNNER_TOOL_CACHE']).resolve(strict=True)
    require(node == cache / 'node/24.21.0/x64/bin/node' and checked_output([str(node), '--version']) == 'v24.21.0',
            'Use the Node 24.21.0 runtime installed by setup-node.')
    runtime = node.parent.parent
    require((runtime / 'lib/node_modules/npm/bin/npm-cli.js').is_file(), 'Complete Node/npm runtime is required.')
    require(not BASE.exists() and not BASE.is_symlink(), 'Refusing to touch an existing Tomasini installation.')
    identifier = hashlib.sha256((os.environ['GITHUB_RUN_ID'] + ':' + os.environ['GITHUB_RUN_ATTEMPT']).encode()).hexdigest()[:16]
    state = 'tomasini-ci-build-' + identifier
    for path in (Path('/var/lib/private') / state, Path('/var/lib') / state):
        require(not path.exists() and not path.is_symlink(), 'Build fixture path already exists.')
    require(checked_output(['/usr/bin/systemctl', 'show', state + '.service', '-p', 'LoadState', '--value'], check=False) == 'not-found',
            'Build fixture unit already exists.')
    # These helpers are imported only after the disposable-runner and path guards have passed.
    core, ci = load_helper('install_vps', workspace), load_helper('ci_deploy', workspace)
    os.umask(0o077)
    BASE.mkdir(mode=0o755)
    os.chmod(BASE, 0o755)
    info = BASE.stat()
    identity = (info.st_dev, info.st_ino)
    directory = BASE / 'private/ci' / identifier
    attempted = False
    try:
        directory.mkdir(parents=True, mode=0o700)
        (BASE / 'runtime').symlink_to(runtime, target_is_directory=True)
        source = directory / 'source'
        source.mkdir(mode=0o755)
        copy_release(workspace, source, ci)
        attempted = True
        volume = ci.build_isolated(core, source, identifier, directory, probe=True)
        try:
            ci.verify_built_tree(volume['project'])
            ci.verify_no_schema_change(source, volume['project'])
            require((volume['project'] / 'probe.txt').read_text().strip() == 'v24.21.0', 'Sandbox used an unexpected Node runtime.')
            require((volume['project'] / 'node_modules/@prisma/client').is_dir(), 'Sandbox dependencies were not installed.')
            require((volume['project'] / 'backend/dist/server.js').is_file()
                    and (volume['project'] / 'frontend/dist/index.html').is_file(), 'Build artifacts missing from sandbox.')
        finally:
            ci.cleanup_build_volume(core, volume, discard=True)
    except Exception:
        diagnostics(directory, state + '.service')
        raise
    finally:
        cleanup_fixture(core, ci, identifier, directory, identity, attempted)
    print(json.dumps({'status': 'sandbox_smoke_passed', 'node': '24.21.0', 'systemd': '255', 'npmCi': True,
                      'prismaGenerate': True, 'schemaUnchanged': True, 'fixtureRemoved': True}), flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'sandbox_smoke_failed', 'error': type(error).__name__, 'message': str(error)}), file=sys.stderr)
        sys.exit(1)
