import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
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


def fleet_plan():
    plan = sample_plan()
    plan.update({'backwardCompatible': False, 'writePolicy': 'quiesce-tomasini',
                 'recoveryPolicy': 'forward-only',
                 'pendingMigrations': ['202611040001_trailers_optional_odometer']})
    plan['migrations'].append({'name': '202611040001_trailers_optional_odometer', 'sha256': 'e' * 64})
    return plan


def controls_plan():
    plan = sample_plan()
    plan['migrations'] = fleet_plan()['migrations'] + [{'name': update.CONTROLS_MIGRATION, 'sha256': update.CONTROLS_SQL_SHA256}]
    plan['pendingMigrations'] = [update.CONTROLS_MIGRATION]
    return plan


class InterruptedControlsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.plan = controls_plan()
        release_sha = self.plan['releaseSha256']
        self.release = self.base / 'releases' / release_sha[:16]
        self.evidence = self.base / 'private/updates' / release_sha[:16]
        self.old = self.base / 'releases' / self.plan['previousReleaseSha256'][:16]
        self.backup = self.base / 'backups' / f'update-{release_sha[:16]}-before.dump'
        self.release.mkdir(parents=True)
        self.evidence.mkdir(parents=True)
        self.old.mkdir()
        self.backup.parent.mkdir()
        (self.release / 'partial-build').write_bytes(b'partial')
        self.plan_file = self.evidence / 'plan.json'
        self.plan_file.write_bytes(json.dumps(self.plan, indent=2).encode())
        self.args = SimpleNamespace(release_sha=release_sha, plan_sha=update.core.sha256(self.plan_file))
        self.snapshot = {
            'migrationHistory': [{'name': item['name'], 'checksum': item['sha256'], 'finished': True, 'rolledBack': False}
                                 for item in self.plan['migrations'][:-1]],
            'apiEnvSha256': '1' * 64, 'hbaSha256': '2' * 64, 'serviceSha256': '3' * 64,
        }
        (self.evidence / 'preflight.json').write_text(json.dumps(self.snapshot))
        self.enterContext(patch.object(update, 'BASE', self.base))
        self.preflight = self.enterContext(patch.object(update, 'preflight',
            return_value=(self.release, self.evidence, self.old, self.snapshot)))
        self.sql = self.enterContext(patch.object(update.core, 'dbsql', return_value='t'))
        self.units = self.enterContext(patch.object(update.core, 'run', return_value=''))
        self.app_uid = 1234
        self.release_uid = self.app_uid
        self.enterContext(patch.object(update.core, 'pwd', SimpleNamespace(
            getpwnam=lambda _: SimpleNamespace(pw_uid=self.app_uid))))
        # Windows fixtures have no POSIX service account. Keep real types and links while
        # supplying the owner and protection bits of the production directories.
        original_stat = Path.stat
        def with_posix_metadata(path, **kwargs):
            fields = list(original_stat(path, **kwargs))
            fields[stat.ST_UID] = self.release_uid if path == self.release else 0
            fields[stat.ST_MODE] = stat.S_IFMT(fields[stat.ST_MODE]) | (0o700 if stat.S_ISDIR(fields[stat.ST_MODE]) else 0o600)
            return os.stat_result(fields)
        self.enterContext(patch.object(Path, 'stat', with_posix_metadata))

    def assert_recovery_rejected(self):
        with self.assertRaises(update.core.InstallationError):
            update.quarantine_controls_preparation(self.args, self.plan)
        self.assertEqual((self.release / 'partial-build').read_bytes(), b'partial')
        self.assertTrue((self.evidence / 'preflight.json').is_file())
        self.assertFalse(list((self.base / 'private').glob('interrupted-*')))

    def test_interrupted_build_and_original_evidence_are_preserved_separately(self):
        original_plan = self.plan_file.read_bytes()
        archived = update.quarantine_controls_preparation(self.args, self.plan)
        self.preflight.assert_called_once_with(self.args, self.plan, interrupted_preparation=True)
        self.assertEqual(archived.parent, self.base / 'private')
        self.assertEqual((archived / 'release/partial-build').read_bytes(), b'partial')
        self.assertEqual((archived / 'evidence/plan.json').read_bytes(), original_plan)
        self.assertEqual(json.loads((archived / 'evidence/preflight.json').read_text()), self.snapshot)
        self.assertFalse(self.release.exists())
        self.assertFalse(self.evidence.exists())
        self.assertTrue(self.old.is_dir())

    def test_backup_or_later_evidence_blocks_recovery_before_any_move(self):
        for marker in [self.backup, self.evidence / 'receipt.json', self.evidence / 'failure.json']:
            with self.subTest(marker=marker.name):
                marker.write_bytes(b'already exists')
                self.assert_recovery_rejected()
                self.assertEqual(marker.read_bytes(), b'already exists')
                marker.unlink()

    def test_changed_plan_history_or_release_owner_blocks_recovery(self):
        self.plan_file.write_text(json.dumps({**self.plan, 'previousReleaseSha256': 'f' * 64}, indent=2))
        self.assert_recovery_rejected()
        self.plan_file.write_bytes(json.dumps(self.plan, indent=2).encode())
        (self.evidence / 'preflight.json').write_text(json.dumps({**self.snapshot, 'migrationHistory': []}))
        self.assert_recovery_rejected()
        (self.evidence / 'preflight.json').write_text(json.dumps(self.snapshot))
        self.release_uid = 0
        self.assert_recovery_rejected()

    def test_schema_mismatch_or_live_prepare_job_blocks_recovery(self):
        self.sql.return_value = 'f'
        self.assert_recovery_rejected()
        self.sql.return_value = 't'
        self.units.return_value = 'tomasini-prepare-abc.scope loaded active running'
        self.assert_recovery_rejected()

    def test_evidence_move_failure_restores_the_incomplete_release(self):
        rename = Path.rename
        def fail_evidence_move(path, destination):
            if path == self.evidence:
                raise OSError('evidence unavailable')
            return rename(path, destination)
        with patch.object(Path, 'rename', fail_evidence_move), self.assertRaises(OSError):
            update.quarantine_controls_preparation(self.args, self.plan)
        self.assertEqual((self.release / 'partial-build').read_bytes(), b'partial')
        self.assertEqual(json.loads(self.plan_file.read_text()), self.plan)
        self.assertTrue(self.old.is_dir())


class UpdateTests(unittest.TestCase):
    def test_controls_accepts_only_the_reviewed_sql_after_fleet(self):
        plan = controls_plan()
        update.validate_plan(plan, plan['releaseSha256'])
        migration = Path(__file__).resolve().parents[1] / 'backend/prisma/migrations' / update.CONTROLS_MIGRATION / 'migration.sql'
        self.assertEqual(update.core.sha256(migration), update.CONTROLS_SQL_SHA256)
        cases = [
            {'migrations': plan['migrations'][:2] + plan['migrations'][3:]},
            {'migrations': plan['migrations'][:-1] + [{'name': update.CONTROLS_MIGRATION, 'sha256': 'f' * 64}]},
            {'pendingMigrations': [update.FLEET_MIGRATION, update.CONTROLS_MIGRATION]},
            {'backwardCompatible': False}, {'recoveryPolicy': 'forward-only'}, {'writePolicy': 'quiesce-tomasini'},
        ]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(update.core.InstallationError):
                update.validate_plan({**plan, **changes}, plan['releaseSha256'])

    def test_release_sql_inventory_rejects_an_undeclared_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory)
            file = release / 'backend/prisma/migrations' / update.CONTROLS_MIGRATION / 'migration.sql'
            file.parent.mkdir(parents=True)
            file.write_bytes(b'reviewed')
            migrations = [{'name': update.CONTROLS_MIGRATION, 'sha256': update.core.sha256(file)}]
            update.verify_release_migrations(release, migrations)
            other = file.parent.parent / '202611110002_other' / 'migration.sql'
            other.parent.mkdir()
            other.write_bytes(b'not approved')
            with self.assertRaises(update.core.InstallationError):
                update.verify_release_migrations(release, migrations)

    def test_controls_checks_effective_permissions_without_changing_grants(self):
        with patch.object(update.core, 'dbsql', return_value='t') as sql:
            update.verify_migration_permissions(update.CONTROLS_MIGRATION)
        statements = [call.args[0] for call in sql.call_args_list]
        self.assertEqual(len(statements), 4)
        self.assertTrue(all(statement.startswith('SELECT has_column_privilege(') and 'controlCount' in statement for statement in statements))
        self.assertTrue(any('tomasini_prod_backup' in statement for statement in statements))
        with patch.object(update.core, 'dbsql', return_value='f'), self.assertRaises(update.core.InstallationError):
            update.verify_migration_permissions(update.CONTROLS_MIGRATION)

    def test_fleet_failure_after_migration_never_exposes_previous_binary(self):
        for switched in [False, True]:
            with self.subTest(switched=switched), patch.object(update.core, 'run') as run, \
                    patch.object(update, 'switch_release') as switch, patch.object(update, 'verify_tomasini') as ready:
                rolled_back, issues = update.recover_failure(Path('/old'), Path('/new'), switched, True, True, True, True)
                self.assertFalse(rolled_back)
                self.assertTrue(issues)
                switch.assert_not_called()
                ready.assert_not_called()
                self.assertEqual([call.args[0] for call in run.call_args_list], [
                    ['systemctl', 'stop', 'tomasini-notifications.timer'],
                    ['systemctl', 'stop', 'tomasini.service'],
                ])

    def test_forward_recovery_attempts_both_stops_even_if_one_fails(self):
        for failed_unit in ['tomasini.service', 'tomasini-notifications.timer']:
            commands = []
            def run(arguments, **kwargs):
                commands.append(arguments)
                if arguments[-1] == failed_unit:
                    raise update.core.InstallationError('uncertain service stop')
                return ''
            with self.subTest(unit=failed_unit), patch.object(update.core, 'run', side_effect=run), patch.object(update, 'switch_release') as switch:
                rolled_back, issues = update.recover_failure(Path('/old'), Path('/new'), True, True, True, True, True)
            self.assertFalse(rolled_back)
            self.assertTrue(issues)
            switch.assert_not_called()
            self.assertIn(['systemctl', 'stop', 'tomasini-notifications.timer'], commands)
            self.assertIn(['systemctl', 'stop', 'tomasini.service'], commands)

    def test_pre_migration_recovery_restores_only_previously_active_writer_timer(self):
        for timer_was_active in [False, True]:
            with self.subTest(timer=timer_was_active), patch.object(update.core, 'run') as run, \
                    patch.object(update, 'switch_release') as switch, patch.object(update, 'verify_tomasini') as ready:
                rolled_back, issues = update.recover_failure(Path('/old'), Path('/new'), False, True, False, timer_was_active, True)
                self.assertFalse(rolled_back)
                self.assertEqual(issues, [])
                switch.assert_not_called()
                ready.assert_called_once()
                expected = [['systemctl', 'start', 'tomasini.service']]
                if timer_was_active:
                    expected.append(['systemctl', 'start', 'tomasini-notifications.timer'])
                self.assertEqual([call.args[0] for call in run.call_args_list], expected)

    def test_compatible_legacy_update_still_restores_previous_code(self):
        with patch.object(update.core, 'run') as run, patch.object(update, 'switch_release') as switch, \
                patch.object(update, 'verify_tomasini') as ready:
            rolled_back, issues = update.recover_failure(Path('/old'), Path('/new'), True, False, True, False, False)
        self.assertTrue(rolled_back)
        self.assertEqual(issues, [])
        switch.assert_called_once_with(Path('/old'), Path('/new'))
        ready.assert_called_once()
        self.assertEqual([call.args[0] for call in run.call_args_list], [['systemctl', 'restart', 'tomasini.service']])

    def test_quiescence_waits_for_delivery_then_stops_api_and_checks_own_sessions(self):
        commands = []
        states = iter(['active', 'inactive'])
        def run(arguments, **kwargs):
            commands.append(arguments)
            return next(states) if arguments[:2] == ['systemctl', 'show'] else ''
        def sql(statement):
            commands.append(statement)
            return '0'
        with patch.object(update.core, 'run', side_effect=run), patch.object(update.core, 'sql', side_effect=sql), \
                patch.object(update.time, 'sleep') as sleep:
            update.quiesce_writers()
        self.assertEqual(commands[0], ['systemctl', 'stop', 'tomasini-notifications.timer'])
        self.assertEqual(commands[-2], ['systemctl', 'stop', 'tomasini.service'])
        self.assertIn("usename='tomasini_prod_app' AND datname='tomasini_prod'", commands[-1])
        self.assertNotIn(['systemctl', 'stop', 'tomasini-notifications.service'], commands)
        sleep.assert_called_once_with(0.5)

    def test_quiescence_stops_before_migration_if_delivery_does_not_finish(self):
        commands = []
        def run(arguments, **kwargs):
            commands.append(arguments)
            return 'active' if arguments[:2] == ['systemctl', 'show'] else ''
        with patch.object(update.core, 'run', side_effect=run), patch.object(update.core, 'sql') as sql, \
                patch.object(update.time, 'sleep'):
            with self.assertRaises(update.core.InstallationError):
                update.quiesce_writers()
        self.assertNotIn(['systemctl', 'stop', 'tomasini.service'], commands)
        self.assertNotIn(['systemctl', 'stop', 'tomasini-notifications.service'], commands)
        sql.assert_not_called()

    def test_quiescence_rejects_remaining_application_connections(self):
        def run(arguments, **kwargs):
            return 'inactive' if arguments[:2] == ['systemctl', 'show'] else ''
        with patch.object(update.core, 'run', side_effect=run), patch.object(update.core, 'sql', return_value='1'):
            with self.assertRaises(update.core.InstallationError):
                update.quiesce_writers()

    def test_fleet_plan_requires_quiescence_and_forward_only_recovery(self):
        update.validate_plan(fleet_plan(), 'b' * 64)
        for field, value in [('backwardCompatible', True), ('writePolicy', 'online'),
                             ('recoveryPolicy', 'rollback-code'), ('migrationPolicy', 'destructive')]:
            with self.subTest(field=field):
                plan = fleet_plan()
                plan[field] = value
                with self.assertRaises(update.core.InstallationError):
                    update.validate_plan(plan, 'b' * 64)
        for field in ['writePolicy', 'recoveryPolicy']:
            with self.subTest(missing=field):
                plan = fleet_plan()
                del plan[field]
                with self.assertRaises(update.core.InstallationError):
                    update.validate_plan(plan, 'b' * 64)

    def test_fleet_plan_does_not_authorize_a_different_or_combined_migration(self):
        for pending in [['202611020002_invitations', '202611040001_trailers_optional_odometer'],
                        ['202611040002_unreviewed'], []]:
            with self.subTest(pending=pending):
                plan = fleet_plan()
                if pending == ['202611040002_unreviewed']:
                    plan['migrations'].append({'name': pending[0], 'sha256': 'f' * 64})
                plan['pendingMigrations'] = pending
                with self.assertRaises(update.core.InstallationError):
                    update.validate_plan(plan, 'b' * 64)

    def test_active_release_recognizes_ci_update_and_install_receipts(self):
        release_sha = 'a' * 64
        for kind in ['ci', 'updates', 'installed']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                old = base / 'releases' / release_sha[:16]
                path = (base / 'private/installed.json' if kind == 'installed' else
                        base / 'private' / kind / old.name / 'receipt.json')
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({'release': release_sha}))
                with patch.object(update, 'BASE', base):
                    self.assertEqual(update.previous_receipt_sha(old), release_sha)

    def test_active_release_receipts_accept_same_hash_and_reject_ambiguity(self):
        release_sha = 'a' * 64
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            old = base / 'releases' / release_sha[:16]
            paths = [base / 'private' / kind / old.name / 'receipt.json' for kind in ['ci', 'updates']]
            for path in paths:
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({'release': release_sha}))
            with patch.object(update, 'BASE', base):
                self.assertEqual(update.previous_receipt_sha(old), release_sha)
                paths[1].write_text(json.dumps({'release': release_sha[:16] + 'b' * 48}))
                with self.assertRaises(update.core.InstallationError):
                    update.previous_receipt_sha(old)

    def test_active_release_requires_a_matching_full_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            old = base / 'releases' / ('a' * 16)
            with patch.object(update, 'BASE', base):
                with self.assertRaises(update.core.InstallationError):
                    update.previous_receipt_sha(old)
                path = base / 'private/installed.json'
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({'release': 'b' * 64}))
                with self.assertRaises(update.core.InstallationError):
                    update.previous_receipt_sha(old)

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
