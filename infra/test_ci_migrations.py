import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import Mock

import ci_migrations as migrations


class CiMigrationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.old = Path(temporary.name) / 'old'
        self.new = Path(temporary.name) / 'new'
        self.prisma = 'backend/prisma'
        self.name = '202611120001_trip_count'
        self.initial = '202611020001_initial'
        old_folder = self.old / self.prisma / 'migrations' / self.initial
        old_folder.mkdir(parents=True)
        (old_folder / 'migration.sql').write_bytes(b'-- prior, previously applied SQL\n')
        (old_folder.parent / 'migration_lock.toml').write_bytes(b'provider = "postgresql"\n')
        self.schema = 'model Trip {\n  id Int @id\n  @@schema("tomasini")\n}\n'
        (self.old / self.prisma / 'schema.prisma').write_bytes(self.schema.encode())
        shutil.copytree(self.old, self.new)
        self.folder = self.new / self.prisma / 'migrations' / self.name
        self.operation = {'op': 'addNullableColumn', 'table': 'Trip', 'column': 'inspectionCount',
                          'type': 'Int', 'nonnegative': True}
        self.plan = {'version': 1, 'operations': [self.operation]}
        self.declaration = '  inspectionCount Int?\n'

    def prepare(self):
        self.folder.mkdir()
        (self.folder / 'ci.json').write_text(json.dumps(self.plan), encoding='utf-8')
        (self.folder / 'migration.sql').write_bytes(migrations.render_migration(self.plan).encode())
        self.set_field(self.declaration)

    def set_field(self, line):
        (self.new / self.prisma / 'schema.prisma').write_bytes(
            self.schema.replace('  @@schema', line + '  @@schema').encode())

    def test_nullable_column_requires_plan_matching_both_sql_and_schema(self):
        self.assertEqual(migrations.plan_migrations(self.old, self.new), [])
        self.prepare()
        changes = migrations.plan_migrations(self.old, self.new)
        self.assertEqual([entry['name'] for entry in changes], [self.name])
        self.assertEqual(changes[0]['sql'], 'ALTER TABLE "tomasini"."Trip" ADD COLUMN "inspectionCount" INTEGER CHECK ("inspectionCount" >= 0);\n')
        for line in ('  inspectionCount Int\n', self.declaration + '  extra String?\n',
                     '  inspectionCount Int? @map("other")\n', self.declaration + self.declaration):
            with self.subTest(line=line), self.assertRaises(ValueError):
                self.set_field(line)
                migrations.plan_migrations(self.old, self.new)
        self.set_field(self.declaration)
        (self.folder / 'migration.sql').write_text(changes[0]['sql'] + 'DROP TABLE "Trip";')
        with self.assertRaisesRegex(ValueError, 'SQL differs'):
            migrations.plan_migrations(self.old, self.new)

    def test_unqualified_or_unreviewed_schema_changes_and_modified_history_are_rejected(self):
        self.set_field(self.declaration)
        with self.assertRaises(ValueError):
            migrations.plan_migrations(self.old, self.new)
        self.prepare()
        review = self.folder / 'ci.json'
        review.unlink()
        with self.assertRaisesRegex(ValueError, 'ci.json'):
            migrations.plan_migrations(self.old, self.new)
        review.write_text(json.dumps(self.plan))
        (self.folder.parent / self.initial / 'migration.sql').write_text('-- modified')
        with self.assertRaisesRegex(ValueError, 'existing'):
            migrations.plan_migrations(self.old, self.new)

    def test_operation_fields_cannot_inject_sql_or_psql_commands(self):
        for key, value in [('op', 'runSql'), ('column', 'a"; DROP TABLE a; --'), ('table', '_prisma_migrations'),
                           ('type', 'integer; RESET ROLE;'), ('column', 'a\n\\!id'), ('table', 'Trip.Name'),
                           ('nonnegative', 1), ('sql', 'RESET ROLE'), ('type', 'Boolean')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                migrations.render_migration({'version': 1, 'operations': [{**self.operation, key: value}]})
        for field_type in ['Int', 'BigInt', 'Boolean', 'String']:
            operation = dict(self.operation, type=field_type)
            del operation['nonnegative']
            self.assertNotIn('CHECK', migrations.render_migration({'version': 1, 'operations': [operation]}))
        with self.assertRaises(ValueError):
            migrations.render_migration({'version': 1, 'operations': [self.operation, self.operation]})

    def test_database_executor_uses_generated_sql_and_a_single_transaction(self):
        self.prepare()
        changes = migrations.plan_migrations(self.old, self.new)
        old_sql = self.old / self.prisma / 'migrations' / self.initial / 'migration.sql'
        history = [{'name': self.initial, 'sha256': hashlib.sha256(old_sql.read_bytes()).hexdigest()}]
        dbsql = Mock()
        changes[0]['sql'] = 'RESET ROLE;'  # This string is never used to execute migrations.
        migrations.apply_migrations(dbsql, history, changes)
        sql = dbsql.call_args.args[0]
        dbsql.assert_called_once()
        self.assertNotIn('RESET ROLE', sql)
        for text in ['BEGIN;', 'SET LOCAL ROLE "tomasini_prod_migrator"', 'current_database()', 'NOT r.rolcanlogin',
                     'LOCK TABLE tomasini._prisma_migrations', 'ALTER TABLE "tomasini"."Trip"',
                     'INSERT INTO tomasini._prisma_migrations', 'COMMIT;']:
            self.assertIn(text, sql)
        self.assertLess(sql.index('LOCK TABLE'), sql.index('ALTER TABLE'))
        changes[0]['sha256'] = '0' * 64
        for target in ('tomasini_prod', 'postgres', 'another_database'):
            with self.subTest(target=target), self.assertRaises(ValueError):
                migrations.apply_migrations(dbsql, history, changes, database=target)
        dbsql.assert_called_once()

    def test_plan_cannot_hide_duplicate_keys_or_move_an_existing_model(self):
        self.prepare()
        (self.folder / 'ci.json').write_text('{"version":1,"version":1,"operations":[]}')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            migrations.plan_migrations(self.old, self.new)
        (self.folder / 'ci.json').write_text(json.dumps(self.plan))
        self.set_field(self.declaration + '  @@map("different_table")\n')
        with self.assertRaises(ValueError):
            migrations.plan_migrations(self.old, self.new)


if __name__ == '__main__':
    unittest.main()
