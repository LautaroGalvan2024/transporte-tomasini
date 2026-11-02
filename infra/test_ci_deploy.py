import base64
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('ci_deploy', Path(__file__).with_name('ci_deploy.py'))
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)
setup_spec = importlib.util.spec_from_file_location('setup_ci', Path(__file__).with_name('setup_ci.py'))
setup = importlib.util.module_from_spec(setup_spec)
setup_spec.loader.exec_module(setup)


class CiDeployTests(unittest.TestCase):
    def test_upload_alarm_is_disabled_before_waiting_for_a_long_build(self):
        events = []
        child = Mock()
        child.poll.return_value = 0
        child.stdin.close.side_effect = lambda: events.append('eof')
        def wait(timeout):
            self.assertEqual(events, ['eof', 'alarm:0'])
            self.assertGreater(timeout, 120)
            return 0
        child.wait.side_effect = wait
        command = 'deploy ' + 'a' * 64 + ' ' + 'b' * 40
        with patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': command}), patch.object(ci.subprocess, 'Popen', return_value=child), patch.object(ci.sys, 'stdin', SimpleNamespace(buffer=io.BytesIO(b'archive'))), patch.object(ci.signal, 'alarm', side_effect=lambda value: events.append(f'alarm:{value}'), create=True):
            self.assertEqual(ci.receive(), 0)

    def test_forced_command_rejects_shell_and_argument_injection(self):
        valid = 'deploy ' + 'a' * 64 + ' ' + 'b' * 40
        self.assertEqual(ci.parse_command(valid), ('a' * 64, 'b' * 40))
        for value in ['', valid + '\n', valid + '; id', valid + ' extra', 'bash', 'deploy ../../x main', valid.replace('deploy ', 'deploy  ')]:
            with self.assertRaises(ci.DeployError):
                ci.parse_command(value)

    def test_archive_hash_and_compressed_size_are_checked(self):
        payload = b'example'
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'one'
            ci.read_archive(io.BytesIO(payload), target, hashlib.sha256(payload).hexdigest())
            with self.assertRaises(ci.DeployError):
                ci.read_archive(io.BytesIO(payload), Path(directory) / 'two', 'a' * 64)
            with patch.object(ci, 'MAX_ARCHIVE', 2), self.assertRaises(ci.DeployError):
                ci.read_archive(io.BytesIO(payload), Path(directory) / 'three', hashlib.sha256(payload).hexdigest())

    def test_archive_paths_are_limited_to_release_contents(self):
        self.assertEqual(ci.permitted_path('frontend/dist/brand/tomasini.webp'), 'frontend/dist/brand/tomasini.webp')
        for name in ['../../etc/sudoers', '/etc/passwd', 'backend/src/../private', 'backend/src/.env', 'frontend/dist//a', 'backend/src/node_modules/x', 'infra/ci_deploy.py', 'backend/scripts/seed-demo.ts', 'backend\\src\\file']:
            with self.assertRaises(ci.DeployError):
                ci.permitted_path(name)

    def test_archive_links_duplicates_and_expansion_are_rejected(self):
        for kind in ['symlink', 'hardlink', 'fifo', 'duplicate', 'expanded']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                archive, destination = Path(directory) / 'test.tar.gz', Path(directory) / 'output'
                destination.mkdir()
                with tarfile.open(archive, 'w:gz') as bundle:
                    item = tarfile.TarInfo('frontend/dist/file')
                    if kind in ('symlink', 'hardlink', 'fifo'):
                        item.type = {'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE, 'fifo': tarfile.FIFOTYPE}[kind]
                        item.linkname = '/etc/passwd'
                        bundle.addfile(item)
                    else:
                        item.size = 5
                        bundle.addfile(item, io.BytesIO(b'hello'))
                        if kind == 'duplicate':
                            bundle.addfile(item, io.BytesIO(b'hello'))
                with patch.object(ci, 'MAX_UNPACKED', 3 if kind == 'expanded' else 100), self.assertRaises(ci.DeployError):
                    ci.extract_verified(archive, destination)

    def test_schema_and_all_migration_files_must_remain_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            old, new = Path(directory) / 'old', Path(directory) / 'new'
            for root in [old, new]:
                prisma = root / 'backend/prisma'
                (prisma / 'migrations/202611020001_initial').mkdir(parents=True)
                (prisma / 'schema.prisma').write_text('same schema')
                (prisma / 'migrations/202611020001_initial/migration.sql').write_text('same SQL')
            ci.verify_no_schema_change(old, new)
            (new / 'backend/prisma/schema.prisma').write_text('different schema')
            with self.assertRaises(ci.DeployError):
                ci.verify_no_schema_change(old, new)
            (new / 'backend/prisma/schema.prisma').write_text('same schema')
            (new / 'backend/prisma/migrations/202611020002_new').mkdir()
            (new / 'backend/prisma/migrations/202611020002_new/migration.sql').write_text('SELECT 1')
            with self.assertRaises(ci.DeployError):
                ci.verify_no_schema_change(old, new)

    def test_build_hardlinks_must_all_be_internal(self):
        with tempfile.TemporaryDirectory() as directory:
            build = Path(directory) / 'build'
            build.mkdir()
            first = build / 'first'
            first.write_text('binary')
            os.link(first, build / 'second')
            ci.verify_built_tree(build)
            os.link(first, Path(directory) / 'outside')
            with self.assertRaises(ci.DeployError):
                ci.verify_built_tree(build)

    def test_build_command_has_separate_identity_quotas_and_no_credentials(self):
        arguments = ci.build_arguments(Path('/input-source'), 'test-ci-contract')
        joined = ' '.join(arguments)
        for required in ['DynamicUser=yes', 'User=tomasini-ci-build', 'MemoryMax=1G', 'CPUQuota=40%', 'ProtectSystem=strict', 'TemporaryFileSystem=/opt:ro /var:ro /srv:ro', 'ci --include=dev', 'db:generate']:
            self.assertIn(required, joined)
        self.assertIn('/.ci-tmp:/tmp', joined)
        self.assertIn('/.ci-var-tmp:/var/tmp', joined)
        self.assertLess(joined.index('stat -c %d /tmp'), joined.index('ci --include=dev'))
        self.assertLess(joined.index('stat -c %d /var/tmp'), joined.index('ci --include=dev'))
        for forbidden in ['DATABASE_URL', 'EnvironmentFile=', 'db:migrate', 'admin:create']:
            self.assertNotIn(forbidden, joined)

    def test_public_key_has_only_valid_ed25519_material(self):
        blob = base64.b64encode(b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20' + b'a' * 32).decode()
        self.assertEqual(setup.public_key('ssh-ed25519 ' + blob + ' oldcomment'), 'ssh-ed25519 ' + blob + ' tomasini-github-actions')
        for key in ['ssh-rsa ' + blob, 'ssh-ed25519 xxx', 'command="id" ssh-ed25519 ' + blob]:
            with self.assertRaises(Exception):
                setup.public_key(key)

    def test_access_file_creation_is_tracked_before_a_permission_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'authorized_keys'
            created = []
            with patch.object(setup.os, 'O_NOFOLLOW', getattr(os, 'O_NOFOLLOW', 0), create=True), patch.object(setup.os, 'chown', side_effect=OSError('simulated permission error'), create=True):
                with self.assertRaises(OSError):
                    setup.root_file(path, 'restricted public key', created=created.append)
            info = path.stat()
            self.assertEqual(created, [(info.st_dev, info.st_ino)])
            self.assertEqual(path.read_text(), 'restricted public key')


if __name__ == '__main__':
    unittest.main()
