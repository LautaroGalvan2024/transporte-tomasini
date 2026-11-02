import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest
from types import SimpleNamespace
import contextlib
import io
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install_vps.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_hba_scopes_only_own_roles(self):
        block = installer.hba_block()
        self.assertIn('host tomasini_prod tomasini_prod_app,tomasini_prod_migrator,tomasini_prod_backup 127.0.0.1/32 scram-sha-256', block)
        self.assertNotIn('mozzi', block)
        self.assertNotIn('horizontes', block)
        self.assertNotIn('host all all', block)
        self.assertIn('0.0.0.0/0 reject', block)
        self.assertIn('::/0 reject', block)

    def test_vhost_is_specific_not_default(self):
        config = installer.nginx_config(True)
        self.assertIn('server_name tomasini.72-60-50-213.sslip.io;', config)
        self.assertIn('proxy_pass http://127.0.0.1:3102;', config)
        self.assertNotIn('default_server', config)
        self.assertNotIn('mozzi', config)
        self.assertIn('proxy_set_header X-Forwarded-For $remote_addr;', config)

    def test_service_caps_and_private_runtime(self):
        config = installer.service_unit().replace('\\', '/')
        for value in ['User=tomasini', '/opt/tomasini/runtime/bin/node', 'MemoryMax=512M',
                      'CPUQuota=40%', 'ProtectSystem=strict', 'NoNewPrivileges=true']:
            self.assertIn(value, config)
        self.assertNotIn('User=root', config)

    def test_archive_path_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'malicious.tar'
            with tarfile.open(archive, 'w') as bundle:
                item = tarfile.TarInfo('../escape')
                item.size = 0
                bundle.addfile(item)
            with self.assertRaises(installer.InstallationError):
                installer.safe_extract(archive, Path(directory) / 'target')
            self.assertFalse((Path(directory) / 'escape').exists())

    def test_write_new_preserves_existing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config'
            path.write_text('original')
            with self.assertRaises(FileExistsError):
                installer.write_new(path, 'replacement')
            self.assertEqual(path.read_text(), 'original')

    def test_no_global_restart_or_database_reset_in_source(self):
        source = Path(installer.__file__).read_text()
        self.assertNotIn("['systemctl', 'restart'", source)
        self.assertNotIn('DROP DATABASE', source)
        self.assertNotIn('DROP ROLE', source)
        self.assertNotIn('migrate reset', source)
        self.assertNotIn('killall', source)

    def test_changed_existing_config_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'existing'
            path.write_text('changed')
            snapshot = {'files': {str(path): {'sha256': 'not-the-current-hash'}}, 'pids': {}, 'health': {}}
            with self.assertRaises(installer.InstallationError):
                installer.verify_existing(snapshot)

    def test_privileged_executable_does_not_depend_on_path(self):
        source = Path(installer.__file__).read_text()
        exporter = Path(installer.__file__).with_name('export_artifacts.py').read_text()
        self.assertNotIn("['runuser'", source)
        self.assertNotIn("['runuser'", exporter)
        self.assertIn("['/usr/sbin/runuser'", source)
        self.assertIn("['/usr/sbin/runuser'", exporter)

    def test_resume_rejects_later_failure_phase_before_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / 'private').mkdir()
            (base / 'private/failed.json').write_text('{"phase":"migraciones propias","rollbackIssues":[]}')
            args = SimpleNamespace(release_sha='a' * 64, node_sha='a' * 64, release='archive', node_archive='node')
            with patch.object(installer, 'BASE', base), patch.object(installer.sys, 'platform', 'linux'), patch.object(installer.os, 'geteuid', return_value=0, create=True), patch.object(installer, 'sha256', return_value='a' * 64), patch.object(installer, 'run') as command:
                # Windows reports st_uid=0 for a local file, matching the protected-root fixture.
                with self.assertRaisesRegex(installer.InstallationError, 'solo admite'):
                    installer.validate_resume(args)
                command.assert_not_called()

    def test_private_diagnostic_redacts_known_passwords(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / 'private').mkdir()
            with patch.object(installer, 'BASE', base), patch.object(installer, 'PRIVATE_VALUES', ['secret-test']):
                installer.record_command_failure('npm', 'before secret-test after', 'failure', 1)
            files = list((base / 'private').glob('command-failure-*.json'))
            self.assertEqual(len(files), 1)
            content = files[0].read_text()
            self.assertNotIn('secret-test', content)
            self.assertIn('[privado]', content)

    def test_export_failure_keeps_successful_installation(self):
        exporter = Path(installer.__file__).with_name('export_artifacts.py')
        args = ['install_vps.py', '--release', 'release', '--release-sha', 'a' * 64,
                '--node-archive', 'node', '--node-sha', 'b' * 64,
                '--export-helper', str(exporter), '--export-helper-sha', installer.sha256(exporter)]
        with (patch.object(installer.sys, 'argv', args), patch.object(installer, 'install') as install,
             patch.object(installer, 'run', side_effect=installer.InstallationError('export failed')) as command,
             contextlib.redirect_stderr(io.StringIO())):
            self.assertEqual(installer.main(), 2)
            install.assert_called_once()
            command.assert_called_once()


if __name__ == '__main__':
    unittest.main()
