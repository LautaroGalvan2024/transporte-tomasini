"""Declarative, backwards-compatible PostgreSQL migrations for the Tomasini CI receiver."""
import hashlib
import json
from pathlib import Path
import re
import sys
import uuid


NAME = re.compile(r'[0-9]{12,14}_[a-z0-9_]{1,90}')
MODEL = re.compile(r'[A-Z][A-Za-z0-9_]{0,62}')
FIELD = re.compile(r'[a-z][A-Za-z0-9_]{0,62}')
TYPES = {'Int': 'INTEGER', 'BigInt': 'BIGINT', 'String': 'TEXT', 'Boolean': 'BOOLEAN'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_plan(path):
    def unique(pairs):
        result = dict(pairs)
        require(len(result) == len(pairs), 'Duplicate key in CI migration plan.')
        return result
    require(path.stat().st_size <= 16_384, 'CI migration plan is too large.')
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)


def render_migration(plan):
    require(isinstance(plan, dict) and set(plan) == {'version', 'operations'}
            and type(plan['version']) is int and plan['version'] == 1, 'Invalid CI migration plan version.')
    operations = plan['operations']
    require(isinstance(operations, list) and 1 <= len(operations) <= 64, 'Expected 1–64 migration operations.')
    statements = []
    columns = set()
    for op in operations:
        keys = {'op', 'table', 'column', 'type'}
        require(isinstance(op, dict) and set(op) in (keys, keys | {'nonnegative'})
                and op['op'] == 'addNullableColumn', 'Unsupported CI migration operation.')
        table, column, field_type = op['table'], op['column'], op['type']
        require(isinstance(table, str) and MODEL.fullmatch(table) and
                isinstance(column, str) and FIELD.fullmatch(column), 'Invalid table or column name.')
        require(isinstance(field_type, str) and field_type in TYPES, 'Unsupported nullable column type.')
        check = op.get('nonnegative', False)
        require(type(check) is bool and (not check or field_type in ('Int', 'BigInt')), 'Invalid nonnegative constraint.')
        require((table, column) not in columns, 'Repeated column in CI migration.')
        columns.add((table, column))
        constraint = f' CHECK ("{column}" >= 0)' if check else ''
        statements.append(f'ALTER TABLE "tomasini"."{table}" ADD COLUMN "{column}" {TYPES[field_type]}{constraint};')
    return '\n'.join(statements) + '\n'


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prisma_files(root):
    files = {}
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'Prisma files may not be symlinks.')
        if path.is_file():
            files[path.relative_to(root).as_posix()] = file_hash(path)
    require('schema.prisma' in files and 'migrations/migration_lock.toml' in files, 'Incomplete Prisma history.')
    return files


def without_added_fields(schema, columns):
    """Remove exactly the declared fields, preserving every existing schema token."""
    model = None
    retained = []
    found = set()
    eligible_models = set()
    mapped_models = set()
    for line in schema.splitlines():
        stripped = line.strip()
        opening = re.fullmatch(r'model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{', stripped)
        if opening:
            model = opening.group(1)
        elif stripped == '}':
            model = None
        if model and stripped == '@@schema("tomasini")':
            eligible_models.add(model)
        if model and stripped.startswith('@@map'):
            mapped_models.add(model)
        # Exact two-token field declarations, without defaults, maps or native type overrides.
        parts = stripped.split()
        if model and len(parts) == 2 and (model, parts[0]) in columns:
            key = (model, parts[0])
            require(key not in found and parts[1] == columns[key] + '?', 'Prisma field differs from CI declaration.')
            found.add(key)
            continue
        # Prisma formatting can realign fields. Quoted string contents stay intact.
        retained.append(tuple(re.findall(r'"(?:[^"\\]|\\.)*"|[^\s"]+', line)))
    require(found == set(columns) and all(table in eligible_models - mapped_models for table, _ in columns),
            'CI migration fields must match existing models in the tomasini schema.')
    return retained


def plan_migrations(old, incoming):
    old_root, new_root = (Path(root) / 'backend/prisma' for root in (old, incoming))
    previous, current = prisma_files(old_root), prisma_files(new_root)
    if previous == current:
        return []
    require(all(current.get(key) == value for key, value in previous.items() if key != 'schema.prisma'),
            'An existing Prisma migration, plan, or lock changed.')
    names = sorted({path.split('/')[1] for path in current.keys() - previous.keys()
                    if re.fullmatch(r'migrations/[^/]+/migration\.sql', path)})
    prior_names = [key.split('/')[1] for key in previous if re.fullmatch(r'migrations/[^/]+/migration\.sql', key)]
    require(prior_names and 1 <= len(names) <= 64 and all(NAME.fullmatch(name) and name > max(prior_names) for name in names),
            'CI requires an append-only sequence of reviewed migrations.')
    expected = {f'migrations/{name}/{filename}' for name in names for filename in ('ci.json', 'migration.sql')}
    require(current.keys() - previous.keys() == expected, 'Each new migration must contain migration.sql and ci.json.')
    changes = []
    columns = {}
    for name in names:
        folder = new_root / 'migrations' / name
        plan = read_plan(folder / 'ci.json')
        sql = render_migration(plan)
        require((folder / 'migration.sql').read_bytes() == sql.encode('utf-8'), 'SQL differs from the reviewed CI operations.')
        for op in plan['operations']:
            key = (op['table'], op['column'])
            require(key not in columns, 'The same column appears in multiple migrations.')
            columns[key] = op['type']
        changes.append({'name': name, 'sha256': current[f'migrations/{name}/migration.sql'],
                        'operations': plan['operations'], 'sql': sql})
    require(len(columns) <= 256 and all((root / 'schema.prisma').stat().st_size <= 1024 * 1024
                                        for root in (old_root, new_root)), 'CI migration exceeds schema limits.')
    old_schema = (old_root / 'schema.prisma').read_text(encoding='utf-8')
    new_schema = (new_root / 'schema.prisma').read_text(encoding='utf-8')
    require(without_added_fields(old_schema, {}) == without_added_fields(new_schema, columns),
            'The Prisma schema includes changes outside the declared nullable columns.')
    return changes


def apply_migrations(dbsql, applied_history, pending, *, database='tomasini_prod'):
    """Run trusted generated SQL on a fixed DB. dbsql must use psql -X with ON_ERROR_STOP."""
    require(database in ('tomasini_prod', 'tomasini_test'), 'Unknown CI migration target.')
    if not pending:
        return
    role = database + '_migrator'
    role_policy = 'AND NOT r.rolcanlogin' if database == 'tomasini_prod' else ''
    verified_history = []
    for entry in [*applied_history, *pending]:
        require(NAME.fullmatch(entry['name']) and re.fullmatch(r'[a-f0-9]{64}', entry['sha256']),
                'Invalid migration history metadata.')
        verified_history.append([entry['name'], entry['sha256']])
    names = [name for name, _ in verified_history]
    require(names == sorted(set(names)), 'CI migration history is out of order.')
    # Only the validated metadata and SQL generated by this trusted module enter psql.
    # All startup files are disabled; no project code receives a database credential.
    expected = json.dumps(verified_history[:len(applied_history)], separators=(',', ':'))
    commands = [f"""BEGIN;
SET LOCAL ROLE "{role}";
SET LOCAL search_path TO pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF current_database() <> '{database}' OR current_user <> '{role}' OR NOT EXISTS (
    SELECT 1 FROM pg_roles r JOIN pg_database d ON d.datdba = r.oid
      JOIN pg_namespace n ON n.nspowner = r.oid
    WHERE r.rolname = current_user AND d.datname = current_database() AND n.nspname = 'tomasini'
      AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) {role_policy}
  ) THEN RAISE EXCEPTION 'Unexpected Tomasini database or migrator'; END IF;
END $$;
LOCK TABLE tomasini._prisma_migrations IN EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM tomasini._prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
     OR (SELECT COALESCE(jsonb_agg(jsonb_build_array(migration_name,checksum) ORDER BY migration_name),'[]'::jsonb)
           FROM tomasini._prisma_migrations) <> '{expected}'::jsonb THEN
    RAISE EXCEPTION 'Tomasini migration history changed';
  END IF;
END $$;"""]
    for entry in pending:
        sql = render_migration({'version': 1, 'operations': entry['operations']})
        require(hashlib.sha256(sql.encode()).hexdigest() == entry['sha256'], 'Invalid canonical migration checksum.')
        commands.append(sql)
        commands.append(f"""INSERT INTO tomasini._prisma_migrations
            (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
            VALUES ('{uuid.uuid4()}', '{entry['sha256']}', '{entry['name']}', transaction_timestamp(), clock_timestamp(), 1);""")
    dbsql('\n'.join(commands) + '\nCOMMIT;')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python3 ci_migrations.py path/to/ci.json')
    # Always produce the same LF bytes on Windows and Linux.
    sys.stdout.buffer.write(render_migration(read_plan(Path(sys.argv[1]))).encode('utf-8'))
