import importlib.util
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('upgrade_ci_receiver', Path(__file__).with_name('upgrade_ci_receiver.py'))
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class ReceiverUpgradeTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.source = Path(scratch.name) / 'root-staging'
        self.ops = Path(scratch.name) / 'ops'
        self.source.mkdir()
        self.ops.mkdir()
        self.old = b'# previous reviewed receiver\n'
        self.new = b'# next reviewed receiver\n'
        self.module = b'# reviewed migration module\n'
        self.receiver_path = self.ops / upgrade.RECEIVER
        self.module_path = self.ops / upgrade.MODULE
        self.receiver_path.write_bytes(self.old)
        (self.source / upgrade.RECEIVER).write_bytes(self.new)
        (self.source / upgrade.MODULE).write_bytes(self.module)
        self.expected = {upgrade.RECEIVER: upgrade.digest(self.new), upgrade.MODULE: upgrade.digest(self.module)}
        self.enterContext(patch.object(upgrade, 'OLD_RECEIVER_SHA', upgrade.digest(self.old)))
        self.enterContext(patch.object(upgrade, 'protected', side_effect=lambda path: self.assertTrue(path.is_file())))
        self.probe = self.enterContext(patch.object(upgrade.subprocess, 'run'))

    def test_atomic_upgrade_then_idempotent_verified_retry(self):
        upgrade.install(self.source, self.ops, self.expected)
        self.assertEqual(self.receiver_path.read_bytes(), self.new)
        self.assertEqual(self.module_path.read_bytes(), self.module)
        self.assertIn('-I', self.probe.call_args.args[0])
        self.assertIn('-B', self.probe.call_args.args[0])
        with patch.object(upgrade.os, 'replace', side_effect=AssertionError('Duplicate writes')):
            upgrade.install(self.source, self.ops, self.expected)

    def test_rejects_unexpected_files_changes_and_unknown_receiver_before_writing(self):
        invalid = [
            {**self.expected, 'deploy-root': '0' * 64},
            {**self.expected, upgrade.MODULE: 'a' * 64},
            {upgrade.RECEIVER: 'x'},
        ]
        for plan in invalid:
            with self.subTest(plan=plan), self.assertRaises(RuntimeError):
                upgrade.install(self.source, self.ops, plan)
            self.assertEqual(self.receiver_path.read_bytes(), self.old)
            self.assertFalse(self.module_path.exists())
        self.receiver_path.write_bytes(b'unrecognized')
        with self.assertRaisesRegex(RuntimeError, 'outside'):
            upgrade.install(self.source, self.ops, self.expected)
        self.assertFalse(self.module_path.exists())

    def test_failed_probe_restores_exact_old_receiver_and_removes_only_its_module(self):
        self.probe.side_effect = subprocess.SubprocessError()
        for already_staged in (False, True):
            if already_staged:
                self.module_path.write_bytes(self.module)
            with self.subTest(already_staged=already_staged), self.assertRaises(subprocess.SubprocessError):
                upgrade.install(self.source, self.ops, self.expected)
            self.assertEqual(self.receiver_path.read_bytes(), self.old)
            self.assertEqual(self.module_path.exists(), already_staged)

    def test_conflicting_module_preserved(self):
        self.module_path.write_bytes(b'unrelated')
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            upgrade.install(self.source, self.ops, self.expected)
        self.assertEqual(self.module_path.read_bytes(), b'unrelated')
        self.assertEqual(self.receiver_path.read_bytes(), self.old)


class TrustedFilesTests(unittest.TestCase):
    def test_link_owner_or_writable_file_is_rejected(self):
        for mode, uid, links in [(stat.S_IFLNK | 0o777, 0, 1), (stat.S_IFREG | 0o644, 1001, 1),
                                 (stat.S_IFREG | 0o664, 0, 1), (stat.S_IFREG | 0o600, 0, 2)]:
            path = Mock()
            path.lstat.return_value = SimpleNamespace(st_mode=mode, st_uid=uid, st_nlink=links)
            with self.subTest(mode=mode, uid=uid, links=links), self.assertRaises(RuntimeError):
                upgrade.protected(path)
