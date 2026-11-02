import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv.find(value => value.startsWith('--previous-manifest='));
if (!argument) throw new Error('Indicar --previous-manifest=ruta del manifiesto de la versión actualmente publicada.');
const previous = JSON.parse(readFileSync(resolve(argument.slice('--previous-manifest='.length)), 'utf8').replace(/^\uFEFF/, ''));
if (!/^[a-f0-9]{64}$/.test(previous.sha256)) throw new Error('Manifiesto anterior inválido.');
const packed = spawnSync(process.execPath, ['scripts/package-release.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (packed.status !== 0) throw new Error('No se pudo preparar el release nuevo.');
const output = JSON.parse(packed.stdout.trim());
const manifest = JSON.parse(readFileSync(output.archive + '.json', 'utf8'));
const migrationPattern = /^backend\/prisma\/migrations\/([^/]+)\/migration.sql$/;
const migrations = manifest.files.filter(file => migrationPattern.test(file.path)).map(file => ({ name: migrationPattern.exec(file.path)[1], sha256: file.sha256 })).sort((a,b) => a.name.localeCompare(b.name));
const priorMigrations = previous.files.filter(file => migrationPattern.test(file.path));
for (const file of priorMigrations) {
  if (!manifest.files.some(current => current.path === file.path && current.sha256 === file.sha256)) throw new Error('Una migración ya publicada cambió; no se crea un plan de actualización.');
}
const priorNames = new Set(priorMigrations.map(file => migrationPattern.exec(file.path)[1]));
const pendingMigrations = migrations.filter(item => !priorNames.has(item.name)).map(item => item.name);
if (JSON.stringify(pendingMigrations) !== JSON.stringify(['202611020002_invitations'])) throw new Error('Este plan está limitado a la migración aditiva de invitaciones revisada.');
const plan = { version: 1, releaseSha256: manifest.sha256, previousReleaseSha256: previous.sha256,
  migrationPolicy: 'additive', backwardCompatible: true, migrations, pendingMigrations,
  schemaSha256: manifest.files.find(file => file.path === 'backend/prisma/schema.prisma').sha256 };
const planPath = output.archive + '.update-plan.json';
const planBytes = JSON.stringify(plan, null, 2) + '\n';
writeFileSync(planPath, planBytes, { flag: 'wx' });
const hash = data => createHash('sha256').update(data).digest('hex');
const updateManifest = { ...manifest, mode: 'update', previousReleaseSha256: previous.sha256,
  planPath, planSha256: hash(planBytes), updaterSha256: hash(readFileSync(join(root, 'infra/update_vps.py'))),
  coreSha256: hash(readFileSync(join(root, 'infra/install_vps.py'))) };
const updateManifestPath = output.archive + '.update.json';
writeFileSync(updateManifestPath, JSON.stringify(updateManifest, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ archive: output.archive, sha256: manifest.sha256, planPath, manifest: updateManifestPath, pendingMigrations }));
