"""Exercise the production migration policy on GitHub's disposable PostgreSQL."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlsplit

from ci_migrations import apply_migrations, plan_migrations, render_migration

ROOT = Path(__file__).resolve().parents[1]
PRISMA = Path('backend/prisma')
TEST_PORT = 55440
# These commits identify main before reconciliation and the exact manually deployed history.
LAST_MANUAL_MAIN = '4a2b746237f651385d21b6770f9153b821d34bc3'
DEPLOYED_BASELINE = '8ece0a21088cbe1f31d2746d34d551d8f8801743'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def comparison_base():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    if os.environ['GITHUB_EVENT_NAME'] == 'pull_request':
        commit = event['pull_request']['base']['sha']
    elif os.environ['GITHUB_EVENT_NAME'] == 'push':
        commit = event['before']
    else:
        commit = git('merge-base', 'origin/main', 'HEAD').decode().strip()
    require(re.fullmatch('[a-f0-9]{40}', commit) and commit != '0' * 40, 'Invalid migration comparison commit.')
    return commit


def restore_prisma_tree(commit, destination):
    listing = git('ls-tree', '-rz', commit, '--', PRISMA.as_posix())
    for entry in listing.split(b'\0'):
        if not entry:
            continue
        metadata, raw_path = entry.split(b'\t', 1)
        mode, kind, blob = metadata.split()
        name = raw_path.decode()
        path = PurePosixPath(name)
        require(mode == b'100644' and kind == b'blob' and '\\' not in name
                and path.is_relative_to('backend/prisma') and '..' not in path.parts,
                'Unexpected file in Prisma history.')
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(git('cat-file', 'blob', blob.decode()))


def validate_transition(base_commit, scratch):
    baseline = scratch / 'deployed'
    restore_prisma_tree(DEPLOYED_BASELINE, baseline)
    all_plans = plan_migrations(baseline, ROOT)
    if base_commit == LAST_MANUAL_MAIN:
        require(not all_plans, 'Reconcile the exact deployed schema before introducing another migration.')
        return baseline, []
    previous = scratch / 'base'
    restore_prisma_tree(base_commit, previous)
    return previous, plan_migrations(previous, ROOT)


def test_connection(kind):
    migrator = kind == 'MIGRATION_DATABASE_URL'
    role = 'tomasini_test_migrator' if migrator else 'tomasini_test_app'
    endpoint = urlsplit(os.environ[kind])
    require((endpoint.scheme, endpoint.hostname, endpoint.port, endpoint.path, endpoint.username, endpoint.query)
            == ('postgresql', '127.0.0.1', TEST_PORT, '/tomasini_test', role, 'schema=tomasini'),
            'This check requires the isolated GitHub test database and matching role.')
    env = {name: value for name, value in os.environ.items() if not name.startswith('PG')}
    env.update(PGPASSWORD=unquote(endpoint.password or ''), PGCONNECT_TIMEOUT='5')

    def execute(sql):
        result = subprocess.run(['psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
                                 '-p', str(TEST_PORT), '-U', role, '-d', 'tomasini_test'],
                                input=sql, text=True, capture_output=True, env=env, timeout=90)
        require(result.returncode == 0, f'PostgreSQL rejected the {role} operation.')
        return result.stdout.strip()

    identity = execute("""SELECT current_database(), current_user,
      pg_get_userbyid(d.datdba), pg_get_userbyid(n.nspowner),
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
      FROM pg_database d, pg_namespace n, pg_roles r WHERE d.datname=current_database()
      AND n.nspname='tomasini' AND r.rolname=current_user;""")
    require(identity == f'tomasini_test|{role}|tomasini_test_migrator|tomasini_test_migrator|f',
            'Test database identity, ownership or privileges differ.')
    return execute


def migration_history(release):
    return [{'name': path.parent.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted((release / PRISMA / 'migrations').glob('*/migration.sql'))]


def verify_ledger(sql, history):
    rows = sql('SELECT migration_name, checksum, finished_at IS NOT NULL AND rolled_back_at IS NULL '
               'FROM tomasini._prisma_migrations ORDER BY migration_name;').splitlines()
    require(rows == [f"{item['name']}|{item['sha256']}|t" for item in history], 'Unexpected Prisma history.')


def deploy_prisma(release):
    config = release / 'prisma.config.mjs'
    config.write_text("""export default { schema: 'backend/prisma/schema.prisma',
  migrations: { path: 'backend/prisma/migrations' }, datasource: { url: process.env.MIGRATION_DATABASE_URL } };
""")
    cli = ROOT / 'node_modules/prisma/build/index.js'
    result = subprocess.run(['node', str(cli), 'migrate', 'deploy', '--config', str(config)],
                            cwd=release, capture_output=True, timeout=100)
    require(result.returncode == 0, 'Prisma could not deploy the reviewed history on the isolated database.')


def upgrade(scratch):
    previous, pending = validate_transition(comparison_base(), scratch)
    sql = test_connection('MIGRATION_DATABASE_URL')
    require(sql("SELECT to_regclass('tomasini._prisma_migrations') IS NULL;") == 't',
            'Upgrade rehearsal requires a freshly provisioned database.')
    deploy_prisma(previous)
    history = migration_history(previous)
    verify_ledger(sql, history)
    if pending:
        apply_migrations(sql, history, pending, database='tomasini_test')
    verify_ledger(sql, migration_history(ROOT))
    print(f'Migration review passed. Tested {len(pending)} pending migrations against the previous release.')


def probe(scratch):
    # This migration exists only on the disposable runner after all application/Prisma tests finish.
    sql = test_connection('MIGRATION_DATABASE_URL')
    app = test_connection('DATABASE_URL')
    history = migration_history(ROOT)
    verify_ledger(sql, history)
    candidate = scratch / 'candidate'
    shutil.copytree(ROOT / PRISMA, candidate / PRISMA)
    schema_file = candidate / PRISMA / 'schema.prisma'
    schema = schema_file.read_text()
    require(schema.count('model Truck {') == 1, 'The test fixture needs the Truck model.')
    schema_file.write_text(schema.replace('model Truck {', 'model Truck {\n  ciPipelineCount Int?'))
    plan = {'version': 1, 'operations': [{'op': 'addNullableColumn', 'table': 'Truck',
                                         'column': 'ciPipelineCount', 'type': 'Int', 'nonnegative': True}]}
    migration = candidate / PRISMA / 'migrations/999999999999_ci_rehearsal'
    migration.mkdir()
    (migration / 'ci.json').write_text(json.dumps(plan) + '\n')
    (migration / 'migration.sql').write_bytes(render_migration(plan).encode())
    pending = plan_migrations(ROOT, candidate)
    truck = 'b39485f5-a348-455d-b14f-bb84320d67ee'
    app(f"""INSERT INTO tomasini."Truck" (id, plate, label) VALUES ('{truck}', 'CIPROBE', 'Ficticio CI');""")
    # A caller using the application role or a different history must leave the migration pending.
    divergent = [*history[:-1], {**history[-1], 'sha256': '0' * 64}]
    for connection, starting_history in [(app, history), (sql, divergent)]:
        try:
            apply_migrations(connection, starting_history, pending, database='tomasini_test')
        except ValueError:
            verify_ledger(sql, history)
        else:
            raise ValueError('The receiver accepted a different role or a divergent Prisma history.')
    apply_migrations(sql, history, pending, database='tomasini_test')
    verify_ledger(sql, migration_history(candidate))
    require(app(f"""SELECT "ciPipelineCount" IS NULL FROM tomasini."Truck" WHERE id='{truck}';""") == 't',
            'New nullable column did not preserve existing data.')
    app(f"""UPDATE tomasini."Truck" SET "ciPipelineCount"=0 WHERE id='{truck}';""")
    try:
        app(f"""UPDATE tomasini."Truck" SET "ciPipelineCount"=-1 WHERE id='{truck}';""")
    except ValueError:
        pass
    else:
        raise ValueError('Nonnegative constraint did not reject negative values.')
    require(app(f"""SELECT "ciPipelineCount" FROM tomasini."Truck" WHERE id='{truck}';""") == '0',
            'Valid zero count was not retained.')
    deploy_prisma(candidate)
    verify_ledger(sql, migration_history(candidate))
    print('Production migration transaction, Prisma history, existing row and application permissions verified.')


def main():
    require(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'Linux'
            and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
            and Path(os.environ.get('GITHUB_WORKSPACE', '/')).resolve() == ROOT,
            'This command needs the disposable GitHub runner.')
    require(sys.argv[1:] in (['upgrade'], ['probe']), 'Expected upgrade or probe.')
    with tempfile.TemporaryDirectory(prefix='tomasini-ci-migrations-') as directory:
        (upgrade if sys.argv[1] == 'upgrade' else probe)(Path(directory))


if __name__ == '__main__':
    main()
