import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('update_vps', Path(__file__).with_name('update_vps.py'))
update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)


def sample_plan():
    return {'version': 1, 'releaseSha256': 'b' * 64, 'previousReleaseSha256': 'a' * 64,
            'backwardCompatible': True, 'migrationPolicy': 'additive',
            'migrations': [{'name': '202611020001_initial', 'sha256': 'c' * 64},
                           {'name': '202611020002_invitations', 'sha256': 'd' * 64}],
            'pendingMigrations': ['202611020002_invitations']}


class UpdateTests(unittest.TestCase):
    def test_only_reviewed_additive_suffix_is_accepted(self):
        plan = sample_plan()
        update.validate_plan(plan, 'b' * 64)
        plan['pendingMigrations'] = ['202611020001_initial']
        with self.assertRaises(update.core.InstallationError):
            update.validate_plan(plan, 'b' * 64)

    def test_divergent_or_failed_applied_migration_stops(self):
        plan = sample_plan()
        applied = [{'name': '202611020001_initial', 'checksum': 'c' * 64, 'finished': True, 'rolledBack': False}]
        update.check_history(applied, plan['migrations'], plan['pendingMigrations'])
        for field, value in [('checksum', 'e' * 64), ('finished', False), ('rolledBack', True)]:
            changed = [{**applied[0], field: value}]
            with self.assertRaises(update.core.InstallationError):
                update.check_history(changed, plan['migrations'], plan['pendingMigrations'])

    def test_migration_password_is_revoked_even_when_job_and_stop_fail(self):
        statements = []
        def sql(statement):
            statements.append(statement)
            return ''
        def run(arguments, **kwargs):
            if arguments[:2] == ['systemctl', 'show']:
                return 'not-found'
            raise update.core.InstallationError('simulated job/stop error')
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(update.core, 'sql', side_effect=sql), patch.object(update.core, 'run', side_effect=run):
                with self.assertRaises(update.core.InstallationError):
                    update.migrate_isolated(Path('/release'), Path(directory))
            self.assertTrue(any('LOGIN PASSWORD' in statement for statement in statements))
            self.assertIn('ALTER ROLE tomasini_prod_migrator NOLOGIN PASSWORD NULL;', statements)
            self.assertTrue(any('pg_terminate_backend' in statement for statement in statements))
            self.assertFalse((Path(directory) / 'migration.env').exists())

    def test_update_never_initializes_accounts_or_resets_database(self):
        source = Path(update.__file__).read_text()
        for forbidden in ['admin:create', 'seed:demo', 'DROP DATABASE', 'DROP TABLE', 'migrate reset', 'CREATE ROLE', 'CREATE DATABASE', "'restart', 'nginx'", "'restart', 'postgresql'"]:
            self.assertNotIn(forbidden, source)
        self.assertIn("['systemctl', 'restart', 'tomasini.service']", source)

    def test_uncertain_enable_result_still_revokes_migrator(self):
        statements = []
        def sql(statement):
            statements.append(statement)
            if len(statements) == 1:
                raise update.core.InstallationError('response lost after possible commit')
            return ''
        def run(arguments, **kwargs):
            return 'not-found' if arguments[:2] == ['systemctl', 'show'] else ''
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(update.core, 'sql', side_effect=sql), patch.object(update.core, 'run', side_effect=run):
                with self.assertRaises(update.core.InstallationError):
                    update.migrate_isolated(Path('/release'), Path(directory))
            self.assertIn('ALTER ROLE tomasini_prod_migrator NOLOGIN PASSWORD NULL;', statements)
            self.assertTrue(any('pg_terminate_backend' in statement for statement in statements))
            self.assertFalse((Path(directory) / 'migration.env').exists())


if __name__ == '__main__':
    unittest.main()
