#!/usr/bin/env python3
"""Update an existing Tomasini installation; preserve its database, users and configuration."""
from __future__ import annotations

import argparse
import hashlib
try:
    import fcntl
except ImportError:
    fcntl = None
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import subprocess
import sys
import time
import urllib.request
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import install_vps as core

BASE = core.BASE
APP_ENV = BASE / 'private/api.env'
MIGRATOR = 'tomasini_prod_migrator'
DATABASE = 'tomasini_prod'
NODE = BASE / 'runtime/bin/node'
NPM = BASE / 'runtime/lib/node_modules/npm/bin/npm-cli.js'
FLEET_MIGRATION = '202611040001_trailers_optional_odometer'
INVITATIONS_MIGRATION = '202611020002_invitations'
CONTROLS_MIGRATION = '202611110001_trip_control_count'
CONTROLS_SQL_SHA256 = '23cf06652284267907692f723b7b175a817ac3557063257395b018c3b96e58d8'


def validate_plan(plan, release_sha):
    core.require(plan.get('version') == 1 and plan.get('releaseSha256') == release_sha, 'Plan de actualización incorrecto.')
    core.require(re.fullmatch(r'[a-f0-9]{64}', plan.get('previousReleaseSha256', '')) is not None, 'Falta la versión anterior exacta.')
    core.require(plan.get('migrationPolicy') == 'additive', 'Solo se permiten migraciones aditivas revisadas.')
    migrations = plan.get('migrations', [])
    core.require(bool(migrations), 'Falta el historial SQL revisado.')
    names = [item.get('name', '') for item in migrations]
    core.require(names == sorted(set(names)), 'El historial debe estar ordenado, sin nombres repetidos.')
    for item in migrations:
        core.require(re.fullmatch(r'\d{12,14}_[a-z0-9_]+', item.get('name', '')) is not None and
                     re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')) is not None, 'Migración revisada inválida.')
    pending = plan.get('pendingMigrations', [])
    core.require(bool(pending) and names[-len(pending):] == pending, 'Las migraciones nuevas deben ser el sufijo del historial revisado.')
    if pending == [CONTROLS_MIGRATION]:
        core.require(names == ['202611020001_initial', INVITATIONS_MIGRATION, FLEET_MIGRATION, CONTROLS_MIGRATION]
                     and migrations[-1]['sha256'] == CONTROLS_SQL_SHA256,
                     'Controles requiere el historial de flota y el SQL exacto revisado.')
        core.require(plan.get('backwardCompatible') is True and 'writePolicy' not in plan and 'recoveryPolicy' not in plan,
                     'Controles requiere actualización compatible con el código de flota activo.')
    elif pending == [INVITATIONS_MIGRATION]:
        core.require(plan.get('backwardCompatible') is True, 'Invitaciones requiere compatibilidad con el código anterior.')
    else:
        core.require(pending == [FLEET_MIGRATION] and plan.get('backwardCompatible') is False and
                     plan.get('writePolicy') == 'quiesce-tomasini' and plan.get('recoveryPolicy') == 'forward-only',
                     'La ampliación de flota requiere pausa exclusiva de escrituras y recuperación hacia adelante.')
    return migrations


def verify_release_migrations(release, migrations):
    directory = release / 'backend/prisma/migrations'
    actual = {path.parent.name: core.sha256(path) for path in directory.glob('*/migration.sql')}
    core.require(actual == {item['name']: item['sha256'] for item in migrations},
                 'Los archivos SQL del release no coinciden con el historial revisado.')


def verify_migration_permissions(migration):
    if migration == CONTROLS_MIGRATION:
        # The existing Trip table grants already cover its new nullable column.
        for role, permission in [('tomasini_prod_app', 'SELECT'), ('tomasini_prod_app', 'INSERT'),
                                 ('tomasini_prod_app', 'UPDATE'), ('tomasini_prod_backup', 'SELECT')]:
            core.require(core.dbsql(f"""SELECT has_column_privilege('{role}', 'tomasini."Trip"', 'controlCount', '{permission}');""") == 't',
                         'La columna de controles carece de los permisos de aplicación o respaldo esperados.')
        return
    new_table = {FLEET_MIGRATION: 'Trailer', INVITATIONS_MIGRATION: 'Invitation'}[migration]
    core.dbsql(f'GRANT SELECT,INSERT,UPDATE,DELETE ON tomasini."{new_table}" TO tomasini_prod_app; GRANT SELECT ON tomasini."{new_table}" TO tomasini_prod_backup;')
    core.require(core.dbsql(f"""SELECT has_table_privilege('tomasini_prod_backup', 'tomasini."{new_table}"', 'SELECT');""") == 't', 'Falta permiso de respaldo sobre la nueva tabla.')


def previous_receipt_sha(old):
    candidates = [BASE / 'private/ci' / old.name / 'receipt.json',
                  BASE / 'private/updates' / old.name / 'receipt.json', BASE / 'private/installed.json']
    matches = set()
    for path in candidates:
        if path.is_file() and not path.is_symlink():
            value = json.loads(path.read_text()).get('release', '')
            if re.fullmatch('[a-f0-9]{64}', value) and value.startswith(old.name):
                matches.add(value)
    core.require(len(matches) == 1, 'Falta un recibo inequívoco de la versión activa.')
    return matches.pop()


def check_history(applied, migrations, expected_pending):
    core.require(len(applied) <= len(migrations), 'La base contiene migraciones no previstas.')
    for actual, expected in zip(applied, migrations):
        core.require(actual['name'] == expected['name'] and actual['checksum'] == expected['sha256'] and
                     actual.get('finished') and not actual.get('rolledBack'), 'Historial aplicado divergente o incompleto; no se modifica.')
    core.require([item['name'] for item in migrations[len(applied):]] == expected_pending, 'Las migraciones pendientes no coinciden con el plan aprobado.')


def migration_history():
    return json.loads(core.dbsql("SELECT COALESCE(json_agg(json_build_object('name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name),'[]'::json) FROM tomasini._prisma_migrations;"))


def counts():
    # Counts only. Never export names, email addresses, passwords or operational records.
    return json.loads(core.dbsql('SELECT json_build_object(\'users\',(SELECT count(*) FROM tomasini."User"),\'drivers\',(SELECT count(*) FROM tomasini."Driver"),\'trucks\',(SELECT count(*) FROM tomasini."Truck"),\'trips\',(SELECT count(*) FROM tomasini."Trip"),\'obligations\',(SELECT count(*) FROM tomasini."Obligation"));'))


def runtime_environment():
    core.require(APP_ENV.is_file() and not APP_ENV.is_symlink() and APP_ENV.stat().st_uid == 0 and APP_ENV.stat().st_mode & 0o022 == 0, 'La configuración privada no tiene los permisos esperados.')
    # Parse with Node's dotenv parser, without evaluating shell commands or exposing values.
    code = 'process.loadEnvFile(process.argv[1]);process.stdout.write(JSON.stringify(process.env))'
    result = subprocess.run([str(NODE), '-e', code, str(APP_ENV)], capture_output=True, text=True, env=core.SAFE_ENV, timeout=20)
    core.require(result.returncode == 0, 'No se pudo leer la configuración privada.')
    environment = json.loads(result.stdout)
    url = urlparse(environment.get('DATABASE_URL', ''))
    core.require(url.scheme in ('postgres', 'postgresql') and url.hostname == '127.0.0.1' and url.port == 5432 and
                 url.path == '/tomasini_prod' and unquote(url.username or '') == 'tomasini_prod_app', 'La aplicación no apunta a su base y rol exclusivos.')
    core.require(environment.get('NODE_ENV') == 'production' and environment.get('HOST') == '127.0.0.1' and
                 environment.get('PORT') == '3102' and environment.get('APP_ORIGIN') == f'https://{core.HOST}', 'La configuración productiva cambió de identidad.')
    for key, value in environment.items():
        if value and (any(word in key.upper() for word in ['PASSWORD', 'SECRET', 'TOKEN', 'DATABASE_URL']) or key == 'SMTP_USER'):
            core.PRIVATE_VALUES.append(value)
    if url.password:
        core.PRIVATE_VALUES.append(unquote(url.password))
    return environment


def preflight(args, plan, *, interrupted_preparation=False):
    core.require(sys.platform.startswith('linux') and os.geteuid() == 0, 'La actualización requiere sudo en Linux.')
    core.require(re.fullmatch(r'[a-f0-9]{64}', args.release_sha) is not None and core.sha256(args.release) == args.release_sha, 'El release no coincide con su huella.')
    core.require(core.sha256(args.plan) == args.plan_sha and core.sha256(core.__file__) == args.core_sha, 'Plan o biblioteca operativa cambiaron después de revisión.')
    migrations = validate_plan(plan, args.release_sha)
    current = BASE / 'current'
    old = BASE / 'releases' / plan['previousReleaseSha256'][:16]
    core.require(current.is_symlink() and current.resolve() == old.resolve() and old.is_dir() and old.stat().st_uid == 0, 'La versión activa no coincide con el origen del plan.')
    core.require(previous_receipt_sha(old) == plan['previousReleaseSha256'], 'No coincide el recibo de la versión activa.')
    if plan['pendingMigrations'] == [CONTROLS_MIGRATION]:
        verify_release_migrations(old, migrations[:-1])
    release = BASE / 'releases' / args.release_sha[:16]
    directory = BASE / 'private/updates' / args.release_sha[:16]
    if not interrupted_preparation:
        core.require(not release.exists() and not release.is_symlink() and not directory.exists() and not directory.is_symlink(), 'Ya hay estado para esta actualización; requiere revisión, no sobrescritura.')
    for parent in [BASE, BASE / 'releases', BASE / 'private', BASE / 'backups']:
        core.require(parent.is_dir() and not parent.is_symlink() and parent.stat().st_uid == 0 and parent.stat().st_mode & 0o022 == 0, 'Una carpeta operativa no tiene el aislamiento esperado.')
    updates_parent = BASE / 'private/updates'
    if updates_parent.exists() or updates_parent.is_symlink():
        core.require(updates_parent.is_dir() and not updates_parent.is_symlink() and updates_parent.stat().st_uid == 0 and updates_parent.stat().st_mode & 0o022 == 0, 'El historial de actualizaciones no tiene los permisos esperados.')
    core.require(core.run(['systemctl', 'is-active', 'tomasini.service']) == 'active' and core.status_http(f'https://{core.HOST}/api/ready') == 200, 'Tomasini no está sano antes de actualizar.')
    core.require(core.run(['systemctl', 'show', 'tomasini.service', '-p', 'FragmentPath', '--value']) == str(core.UNIT), 'La unidad activa es inesperada.')
    role = json.loads(core.sql("SELECT json_build_object('login',rolcanlogin,'passwordNull',rolpassword IS NULL,'elevated',rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) FROM pg_authid WHERE rolname='tomasini_prod_migrator';"))
    core.require(role == {'login': False, 'passwordNull': True, 'elevated': False}, 'El migrador no está inactivo y aislado como se esperaba.')
    core.require(core.sql("SELECT count(*) FROM pg_stat_activity WHERE usename='tomasini_prod_migrator';") == '0', 'Hay una sesión de migración previa; no interferir.')
    try:
        core.pwd.getpwnam('tomasini-migrate')
    except KeyError:
        pass
    else:
        raise core.InstallationError('La identidad temporal de migración ya está ocupada.')
    core.require(core.sql("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='tomasini_prod';") == MIGRATOR, 'Propiedad de base inesperada.')
    core.require(core.dbsql("SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='tomasini';") == MIGRATOR, 'Propiedad de esquema inesperada.')
    runtime_environment()
    applied = migration_history()
    check_history(applied, migrations, plan['pendingMigrations'])
    core.require(shutil.disk_usage('/opt').free > 3 * 1024**3, 'Espacio insuficiente para actualización y respaldo.')
    memory = dict(re.findall(r'^(\w+):\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M))
    core.require(int(memory.get('MemAvailable', 0)) > 1024**2, 'Memoria disponible insuficiente.')
    snapshot = core.snapshot_existing()
    core.require(all(status == 200 for status in snapshot['health'].values()), 'Una aplicación preexistente no está sana.')
    snapshot.update({'tomasiniPid': core.run(['systemctl', 'show', 'tomasini.service', '-p', 'MainPID', '--value']),
                     'apiEnvSha256': core.sha256(APP_ENV), 'hbaSha256': core.sha256(core.HBA),
                     'serviceSha256': core.sha256(core.UNIT), 'counts': counts(), 'migrationHistory': applied})
    return release, directory, old, snapshot


def verify_preparation_entry(path, *, directory, uid, private=False):
    info = path.lstat()
    expected_type = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1
    forbidden_mode = 0o077 if private else 0o022
    core.require(expected_type and info.st_uid == uid and not info.st_mode & forbidden_mode,
                 'Tipo, dueño o permisos inesperados en el intento interrumpido.')


def quarantine_controls_preparation(args, plan):
    core.require(plan.get('pendingMigrations') == [CONTROLS_MIGRATION],
                 'La reanudación solo admite la preparación de la actualización de controles.')
    release, directory, old, snapshot = preflight(args, plan, interrupted_preparation=True)
    core.require(release != old and not old.is_symlink(), 'El release activo no puede archivarse.')
    app_uid = core.pwd.getpwnam('tomasini').pw_uid
    core.require(app_uid != 0, 'La identidad de aplicación debe ser distinta de root.')
    verify_preparation_entry(release, directory=True, uid=app_uid)
    verify_preparation_entry(directory, directory=True, uid=0, private=True)
    core.require({child.name for child in directory.iterdir()} == {'plan.json', 'preflight.json'},
                 'El intento anterior ya avanzó o su evidencia está incompleta.')
    for name in ('plan.json', 'preflight.json'):
        verify_preparation_entry(directory / name, directory=False, uid=0, private=True)
    # update() stores the reviewed plan in this canonical representation before extracting.
    core.require((directory / 'plan.json').read_bytes() == json.dumps(plan, indent=2).encode(),
                 'El plan guardado del intento anterior difiere del autorizado.')
    prior = json.loads((directory / 'preflight.json').read_text())
    for field in ('migrationHistory', 'serviceSha256', 'hbaSha256', 'apiEnvSha256'):
        core.require(field in prior and prior[field] == snapshot[field],
                     'La configuración o el historial cambiaron desde la preparación.')
    backup = BASE / 'backups' / f'update-{release.name}-before.dump'
    core.require(not backup.exists() and not backup.is_symlink(),
                 'Existe un respaldo de este intento. Revisar su fase antes de continuar.')
    scopes = core.run(['systemctl', 'list-units', '--state=active,activating,deactivating',
                       '--no-legend', '--plain', 'tomasini-prepare-*.scope'])
    core.require(not scopes, 'Sigue activa una preparación de Tomasini.')
    core.require(core.dbsql("""SELECT current_database() = 'tomasini_prod'
        AND (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) = 'tomasini_prod_migrator'
        AND to_regclass('tomasini."Trip"') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('tomasini."Trip"')
                        AND attname = 'controlCount' AND NOT attisdropped);""") == 't',
                 'La base, su dueño o la columna de controles no corresponden al estado previo.')
    private = BASE / 'private'
    core.require(release.lstat().st_dev == directory.lstat().st_dev == private.stat().st_dev,
                 'La cuarentena requiere el mismo sistema de archivos.')
    quarantine = private / f'interrupted-{release.name}-{secrets.token_hex(8)}'
    quarantine.mkdir(mode=0o700)
    # Only rename the two directory entries in their protected parents. Never follow or
    # execute files in the incomplete, application-owned installation.
    release.rename(quarantine / 'release')
    try:
        directory.rename(quarantine / 'evidence')
    except OSError:
        (quarantine / 'release').rename(release)
        raise
    return quarantine


def verify_preserved(snapshot):
    core.verify_existing(snapshot)
    core.require(core.sha256(APP_ENV) == snapshot['apiEnvSha256'], 'La configuración privada cambió durante la actualización; no sobrescribirla.')
    core.require(core.sha256(core.HBA) == snapshot['hbaSha256'] and core.sha256(core.UNIT) == snapshot['serviceSha256'], 'Cambió una configuración que esta actualización no debe modificar.')
    core.require(core.sql("SELECT NOT rolcanlogin AND rolpassword IS NULL FROM pg_authid WHERE rolname='tomasini_prod_migrator';") == 't', 'El migrador debe quedar sin LOGIN ni contraseña.')
    current_counts = counts()
    core.require(all(current_counts[key] >= value for key, value in snapshot['counts'].items()), 'Disminuyó una cantidad de registros existentes; requiere revisión.')


def create_backup(directory, release_sha):
    path = BASE / 'backups' / f'update-{release_sha[:16]}-before.dump'
    core.require(not path.exists() and not path.is_symlink(), 'El respaldo previo ya existe; no se sobrescribe.')
    env = {**core.SAFE_ENV, 'PGPASSFILE': str(BASE / 'private/backup.pgpass'), 'PGCONNECT_TIMEOUT': '10'}
    core.run(['/usr/bin/pg_dump', '-h', '127.0.0.1', '-U', 'tomasini_prod_backup', '-d', DATABASE,
              '-Fc', '--no-owner', '--no-acl', '-f', str(path)], env=env, timeout=180, label='Respaldo previo de Tomasini')
    os.chmod(path, 0o600)
    core.run(['/usr/bin/pg_restore', '--list', str(path)], timeout=30, label='Validar respaldo previo')
    metadata = {'database': DATABASE, 'sha256': core.sha256(path), 'bytes': path.stat().st_size,
                'createdAt': time.time(), 'purpose': 'before-additive-update'}
    core.write_new(directory / 'backup-manifest.json', json.dumps(metadata, indent=2))
    return path


def notification_timer_active():
    return core.run(['systemctl', 'is-active', 'tomasini-notifications.timer'], check=False) == 'active'


def quiesce_writers():
    core.run(['systemctl', 'stop', 'tomasini-notifications.timer'], label='Pausar únicamente timer de correo Tomasini')
    # Let a delivery already in progress finish; never interrupt another app or SMTP attempt.
    for _ in range(60):
        state = core.run(['systemctl', 'show', 'tomasini-notifications.service', '-p', 'ActiveState', '--value'])
        if state in ('inactive', 'failed'):
            break
        time.sleep(0.5)
    else:
        raise core.InstallationError('El correo de Tomasini sigue trabajando; no se inicia la migración.')
    core.run(['systemctl', 'stop', 'tomasini.service'], label='Pausar únicamente Tomasini para migración')
    core.require(core.sql("SELECT count(*) FROM pg_stat_activity WHERE usename='tomasini_prod_app' AND datname='tomasini_prod';") == '0',
                 'Quedan conexiones de escritura Tomasini; no se inicia la migración.')


def data_fingerprints(columns=None):
    # Hash every original column while the only application writers are stopped.
    # No row data or secrets leave PostgreSQL in this check.
    if columns is None:
        columns = json.loads(core.dbsql("SELECT COALESCE(json_agg(json_build_object('table',table_name,'column',column_name) ORDER BY table_name,ordinal_position),'[]'::json) FROM information_schema.columns WHERE table_schema='tomasini' AND table_name <> '_prisma_migrations';"))
    tables = {}
    for item in columns:
        tables.setdefault(item['table'], []).append(item['column'])
    quote = lambda value: '"' + value.replace('"', '""') + '"'
    rows = {}
    for table, fields in tables.items():
        statement = 'SELECT json_build_object(\'count\',count(*),\'sha\',md5(COALESCE(string_agg(to_jsonb(q)::text,\'\' ORDER BY to_jsonb(q)::text),\'\'))) FROM (SELECT ' + ','.join(map(quote, fields)) + ' FROM tomasini.' + quote(table) + ') q;'
        rows[table] = json.loads(core.dbsql(statement))
    return {'columns': columns, 'tables': rows}


def verify_new_data_access(release, directory):
    code = """import {assertDatabaseScope,getDb,disconnect} from './backend/dist/db.js';
import {truckDtos,obligationDtos,tripDto,tripInclude} from './backend/dist/models.js';
import {trailerDtos} from './backend/dist/trailer-models.js';
try { await assertDatabaseScope(); const db=getDb();
const [mode]=await db.$queryRaw`SHOW default_transaction_read_only`;
if(mode.default_transaction_read_only!=='on')throw new Error('read-only verification required');
const trucks=await truckDtos(); const trailers=await trailerDtos(); const obligations=await obligationDtos();
const trips=await db.trip.findMany({include:tripInclude,take:20}); trips.forEach(tripDto);
if(trucks.some(t=>(t.odometer===null)!==(t.odometerAt===null)))throw new Error('invalid reading pair');
console.log(JSON.stringify({database:'tomasini_prod',trucks:trucks.length,trailers:trailers.length,obligations:obligations.length,tripsRead:trips.length,readOnly:true}));
} finally { await disconnect(); }"""
    result = core.prepare_scoped(['/usr/sbin/runuser', '-u', 'tomasini', '--', str(NODE), '--input-type=module', '-e', code],
                                 env={**runtime_environment(), 'PGOPTIONS': '-c default_transaction_read_only=on'}, timeout=60,
                                 label='Lectura real con el nuevo backend y rol exclusivo', cwd=str(release))
    summary = json.loads(result)
    core.require(summary.get('readOnly') is True and summary.get('database') == DATABASE, 'No se verificó acceso real del nuevo backend.')
    core.write_new(directory / 'data-access.json', json.dumps(summary, indent=2))


def recover_failure(old, release, switched, quiesced, migration_attempted, timer_was_active, forward_only):
    issues = []
    rolled_back = False
    if forward_only and migration_attempted:
        # Even a lost migration response is uncertain. Never expose the previous binary.
        for unit in ['tomasini-notifications.timer', 'tomasini.service']:
            try:
                core.run(['systemctl', 'stop', unit], label='Mantener solo Tomasini pausado para recuperación revisada')
            except Exception:
                issues.append('pausa de ' + unit + ' requiere revisión')
        issues.append('migración iniciada: recuperar hacia adelante sin restauración automática')
    else:
        try:
            if switched:
                switch_release(old, release)
                core.run(['systemctl', 'restart', 'tomasini.service'], label='Restaurar únicamente el código anterior compatible')
                verify_tomasini()
                rolled_back = True
            elif quiesced:
                core.run(['systemctl', 'start', 'tomasini.service'], label='Retomar Tomasini sin migración')
                verify_tomasini()
            if quiesced and timer_was_active:
                core.run(['systemctl', 'start', 'tomasini-notifications.timer'], label='Retomar timer propio sin migración')
        except Exception:
            issues.append('recuperación de código/servicio propio requiere revisión')
    return rolled_back, issues


def migrate_isolated(release, directory):
    password = secrets.token_hex(32)
    core.PRIVATE_VALUES.append(password)
    url = f'postgresql://{MIGRATOR}:{password}@127.0.0.1:5432/{DATABASE}?schema=tomasini'
    env_file = directory / 'migration.env'
    values = {'NODE_ENV': 'production', 'MIGRATION_DATABASE_URL': url,
              'PATH': f'{BASE}/runtime/bin:' + core.SAFE_ENV['PATH'], 'HOME': '/tmp',
              'npm_config_cache': '/tmp/tomasini-npm-cache', 'XDG_CACHE_HOME': '/tmp/tomasini-cache'}
    core.write_new(env_file, '\n'.join(f'{key}={value}' for key, value in values.items()) + '\n')
    unit = f'tomasini-migration-{secrets.token_hex(8)}.service'
    core.require(core.run(['systemctl', 'show', unit, '-p', 'LoadState', '--value'], check=False) == 'not-found', 'Unidad temporal ocupada.')
    enabled = False
    try:
        # A client error can occur after PostgreSQL committed ALTER ROLE.
        # Revoke after any attempted enable, not only a confirmed response.
        enabled = True
        core.sql(f"ALTER ROLE {MIGRATOR} LOGIN PASSWORD '{password}';")
        core.run(['systemd-run', '--wait', '--pipe', '--collect', '--quiet', f'--unit={unit}',
                  '--property=DynamicUser=yes', '--property=User=tomasini-migrate', '--property=PrivateTmp=yes', '--property=ProtectSystem=strict',
                  '--property=ProtectHome=yes', '--property=NoNewPrivileges=yes', '--property=MemoryMax=768M',
                  '--property=CPUQuota=40%', '--property=TasksMax=96', f'--property=WorkingDirectory={release}',
                  f'--property=EnvironmentFile={env_file}', str(NODE), str(NPM), '--prefix', str(release),
                  'run', 'db:migrate', '--workspace', '@tomasini/backend'], timeout=240, label='Migración aditiva aislada')
    finally:
        failures = []
        try:
            core.run(['systemctl', 'stop', unit], check=False, label='Cerrar unidad temporal propia')
        except Exception:
            failures.append('detención de la unidad temporal')
        try:
            if enabled:
                try:
                    core.sql(f'ALTER ROLE {MIGRATOR} NOLOGIN PASSWORD NULL;')
                except Exception:
                    failures.append('revocación del migrador')
                try:
                    core.sql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='{MIGRATOR}' AND datname='{DATABASE}';")
                except Exception:
                    failures.append('cierre de sesiones propias de migración')
        finally:
            env_file.unlink(missing_ok=True)
        core.require(not failures, 'Revisar limpieza de migración: ' + ', '.join(failures))


def switch_release(target, expected):
    core.require((BASE / 'current').is_symlink() and (BASE / 'current').resolve() == expected.resolve(), 'El enlace activo cambió; no reemplazarlo.')
    temporary = BASE / f'current-switch-{secrets.token_hex(8)}'
    temporary.symlink_to(target)
    try:
        os.replace(temporary, BASE / 'current')
    finally:
        temporary.unlink(missing_ok=True)


def verify_tomasini():
    for attempt in range(30):
        try:
            if core.status_http(f'https://{core.HOST}/api/ready') == 200:
                return
        except Exception:
            pass
        time.sleep(0.5)
    raise core.InstallationError('Tomasini no recuperó readiness con la versión seleccionada.')


def verify_public_release(release):
    index = release / 'frontend/dist/index.html'
    with urllib.request.urlopen(f'https://{core.HOST}/', timeout=15) as response:
        core.require(hashlib.sha256(response.read()).hexdigest() == core.sha256(index), 'El origen público no sirve el frontend nuevo.')
    assets = re.findall(r'(?:src|href)="(/assets/[^"?]+)"', index.read_text())
    core.require(bool(assets), 'El frontend nuevo no contiene sus assets esperados.')
    for asset in assets:
        local = release / 'frontend/dist' / asset.lstrip('/')
        core.require(local.resolve().is_relative_to((release / 'frontend/dist').resolve()), 'Ruta de asset inválida.')
        with urllib.request.urlopen(f'https://{core.HOST}{asset}', timeout=15) as response:
            core.require(hashlib.sha256(response.read()).hexdigest() == core.sha256(local), 'Un asset público difiere del release nuevo.')


def copy_private_files(files, destination):
    core.run(['/usr/sbin/runuser', '-u', 'mozzi', '--', 'python3', '-c',
              'import os,sys;os.mkdir(sys.argv[1],0o700)', str(destination)], env=core.SAFE_ENV, cwd='/', label='Entrega privada de actualización')
    copy = 'import os,sys,shutil; fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600); f=os.fdopen(fd,"wb"); shutil.copyfileobj(sys.stdin.buffer,f); f.close()'
    for name, source in files.items():
        core.require(source.is_file() and not source.is_symlink() and source.stat().st_uid == 0, 'Origen de entrega privado inesperado.')
        with source.open('rb') as stream:
            result = subprocess.run(['/usr/sbin/runuser', '-u', 'mozzi', '--', 'python3', '-c', copy, str(destination / name)],
                                    stdin=stream, capture_output=True, env=core.SAFE_ENV, cwd='/', timeout=120)
        core.require(result.returncode == 0, 'La entrega privada requiere revisión.')


def export_private(directory, backup, release_sha):
    destination = Path('/home/mozzi') / f'tomasini-update-{release_sha[:16]}' / 'handoff'
    files = {'installed.json': directory / 'receipt.json', 'preflight.json': directory / 'preflight.json',
             'postflight.json': directory / 'postflight.json', 'backup-manifest.json': directory / 'backup-manifest.json',
             'tomasini_prod.dump': backup, 'migration-plan.json': directory / 'plan.json'}
    for name in ['data-preservation.json', 'data-access.json']:
        if (directory / name).is_file():
            files[name] = directory / name
    copy_private_files(files, destination)


def update(args):
    plan = json.loads(Path(args.plan).read_text())
    if args.resume_preparation:
        quarantine_controls_preparation(args, plan)
    release, directory, old, snapshot = preflight(args, plan)
    directory.mkdir(parents=True, mode=0o700)
    core.write_new(directory / 'preflight.json', json.dumps(snapshot, indent=2))
    core.write_new(directory / 'plan.json', json.dumps(plan, indent=2))
    switched = False
    forward_only = plan.get('recoveryPolicy') == 'forward-only'
    quiesced = False
    migration_attempted = False
    timer_was_active = False
    fingerprints = None
    prior_logs = set((BASE / 'private').glob('command-failure-*.json'))
    phase = 'preparar release nuevo'
    try:
        release.mkdir(mode=0o755)
        core.safe_extract(args.release, release)
        env = {**core.SAFE_ENV, 'NODE_ENV': 'production', 'PATH': f'{BASE}/runtime/bin:' + core.SAFE_ENV['PATH'],
               'HOME': str(BASE / 'private/runtime'), 'npm_config_cache': str(BASE / 'private/runtime/npm-cache'),
               'XDG_CACHE_HOME': str(BASE / 'private/runtime/cache')}
        core.run(['chown', '-R', '--no-dereference', 'tomasini:tomasini', str(release)], label='Preparar propiedad del release nuevo')
        core.prepare_scoped(['/usr/sbin/runuser', '-u', 'tomasini', '--', str(NODE), str(NPM), '--prefix', str(release),
                             'ci', '--include=dev', '--no-audit', '--no-fund'], env=env, timeout=600, label='Dependencias del release nuevo', cwd=str(release))
        core.prepare_scoped(['/usr/sbin/runuser', '-u', 'tomasini', '--', str(NODE), str(NPM), '--prefix', str(release),
                             'run', 'db:generate', '--workspace', '@tomasini/backend'], env=env, timeout=180, label='Generar cliente Linux nuevo', cwd=str(release))
        core.run(['chown', '-R', '--no-dereference', 'root:root', str(release)], label='Inmovilizar release nuevo')
        core.run(['chmod', '-R', 'a+rX,go-w', str(release)], label='Permitir lectura aislada y retirar escritura al runtime')
        verify_release_migrations(release, plan['migrations'])
        core.require(core.sha256(release / 'backend/prisma/schema.prisma') == plan['schemaSha256'], 'Esquema preparado inesperado.')
        verify_preserved(snapshot)
        if forward_only:
            phase = 'pausar escrituras exclusivas Tomasini'
            timer_was_active = notification_timer_active()
            quiesced = True
            quiesce_writers()
            fingerprints = data_fingerprints()
        phase = 'respaldo previo'
        backup = create_backup(directory, args.release_sha)
        check_history(migration_history(), plan['migrations'], plan['pendingMigrations'])
        phase = 'migración aditiva'
        migration_attempted = True
        migrate_isolated(release, directory)
        check_history(migration_history(), plan['migrations'], [])
        verify_migration_permissions(plan['pendingMigrations'][0])
        if fingerprints is not None:
            after = data_fingerprints(fingerprints['columns'])
            core.require(after == fingerprints, 'La migración alteró datos existentes; no se habilitan escrituras.')
            core.write_new(directory / 'data-preservation.json', json.dumps({'before': fingerprints, 'after': after, 'preserved': True}, indent=2))
            phase = 'verificar lectura backend nueva antes de habilitar escrituras'
            verify_new_data_access(release, directory)
        verify_preserved(snapshot)
        phase = 'activar código nuevo'
        switch_release(release, old)
        switched = True
        core.run(['systemctl', 'restart', 'tomasini.service'], label='Reiniciar únicamente Tomasini')
        verify_tomasini()
        verify_public_release(release)
        verify_preserved(snapshot)
        if quiesced and timer_was_active:
            core.run(['systemctl', 'start', 'tomasini-notifications.timer'], label='Retomar exclusivamente timer de correo Tomasini')
            core.require(notification_timer_active(), 'El timer de correo propio no recuperó su estado.')
        postflight = core.snapshot_existing()
        postflight.update({'tomasiniPid': core.run(['systemctl', 'show', 'tomasini.service', '-p', 'MainPID', '--value']),
                           'counts': counts(), 'migrationHistory': migration_history(), 'apiEnvSha256': core.sha256(APP_ENV)})
        core.write_new(directory / 'postflight.json', json.dumps(postflight, indent=2))
        receipt = {'kind': 'update', 'release': args.release_sha, 'previousRelease': plan['previousReleaseSha256'],
                   'database': DATABASE, 'host': core.HOST, 'timestamp': time.time(), 'migrations': plan['pendingMigrations'],
                   'recoveryPolicy': plan.get('recoveryPolicy', 'compatible-code-rollback'),
                   'verification': {'existingApplicationsPreserved': True, 'apiEnvironmentPreserved': True, 'migrationRoleLocked': True, 'publicReadiness': 200,
                                    'originalDataPreserved': fingerprints is not None, 'newBackendReadOnlyVerified': fingerprints is not None,
                                    'notificationTimerRestored': not quiesced or notification_timer_active() == timer_was_active,
                                    'backupBeforeMigrationValidated': True, 'beforeSha256': core.sha256(directory / 'preflight.json'),
                                    'afterSha256': core.sha256(directory / 'postflight.json')}}
        core.write_new(directory / 'receipt.json', json.dumps(receipt, indent=2))
    except Exception as error:
        rolled_back, issues = recover_failure(old, release, switched, quiesced, migration_attempted, timer_was_active, forward_only)
        try:
            verify_preserved(snapshot)
        except Exception:
            issues.append('verificación de aplicaciones/datos/configuración requiere revisión')
        core.write_new(directory / 'failure.json', json.dumps({'phase': phase, 'timestamp': time.time(),
                       'rolledBackCode': rolled_back, 'issues': issues,
                       'databaseReset': False, 'detail': type(error).__name__}, indent=2))
        try:
            logs = [json.loads(path.read_text()) for path in sorted(set((BASE / 'private').glob('command-failure-*.json')) - prior_logs)]
            core.write_new(directory / 'diagnostics.json', json.dumps({'phase': phase, 'commands': logs}, indent=2))
            copy_private_files({'failure.json': directory / 'failure.json', 'diagnostics.json': directory / 'diagnostics.json'},
                               Path('/home/mozzi') / f'tomasini-update-{args.release_sha[:16]}' / 'diagnostics')
        except Exception:
            pass
        raise
    # Handoff is deliberately outside rollback: a download problem cannot undo a healthy update.
    try:
        export_private(directory, backup, args.release_sha)
    except Exception as error:
        core.write_new(directory / 'handoff-pending.json', json.dumps({'timestamp': time.time(), 'detail': type(error).__name__}))
        print('Actualización verificada; entrega privada pendiente. No repetir la actualización.', file=sys.stderr)
        return 2
    print(f'Tomasini actualizado y verificado: https://{core.HOST}. Datos y configuración conservados.')
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True)
    parser.add_argument('--release-sha', required=True)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--plan-sha', required=True)
    parser.add_argument('--core-sha', required=True)
    parser.add_argument('--resume-preparation', action='store_true',
                        help='Archivar una preparación de controles interrumpida antes del respaldo y repetirla desde el paquete verificado.')
    args = parser.parse_args()
    try:
        core.require(os.geteuid() == 0, 'Se requiere sudo.')
        # A file lock prevents two updates from enabling the same migrator concurrently.
        lock_fd = os.open(BASE / 'private/update.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(lock_fd, 'a') as lock:
            lock_stat = os.fstat(lock.fileno())
            core.require(stat.S_ISREG(lock_stat.st_mode) and lock_stat.st_uid == 0 and lock_stat.st_nlink == 1, 'El lock de actualización no es un archivo propio regular.')
            os.fchmod(lock.fileno(), 0o600)
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return update(args)
    except Exception as error:
        print(f'Actualización detenida: {type(error).__name__}: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
