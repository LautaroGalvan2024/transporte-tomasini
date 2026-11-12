import { spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRunner,
  prepareDatabase,
  restrictMigrationHistory,
} from "./ci-prepare-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    timeout: 600_000,
  });
  if (result.status !== 0 || result.error)
    throw new Error(`Falló la verificación: ${command} ${args.join(" ")}`);
}
let prepared = false;
try {
  assertRunner();
  if (process.version !== "v24.21.0")
    throw new Error("CI requiere exactamente Node.js 24.21.0.");
  const environment = { ...process.env, NODE_ENV: "development" };
  for (const name of [
    "TOMASINI_INTEGRATION",
    "DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "TOMASINI_CI_ADMIN_PASSWORD",
  ])
    delete environment[name];
  run("npm", ["run", "check"], environment);
  run(
    process.execPath,
    ["--test", "scripts/test-infra.mjs", "scripts/ci-security.test.mjs"],
    environment,
  );
  run(
    "python3",
    ["-m", "unittest", "discover", "-s", "infra", "-p", "test_*.py"],
    environment,
  );
  const testEnvironment = await prepareDatabase();
  prepared = true;
  const integrationEnvironment = { ...environment, ...testEnvironment };
  run("python3", ["infra/ci_check_migrations.py", "upgrade"], integrationEnvironment);
  run(
    "npm",
    ["run", "db:migrate", "--workspace", "@tomasini/backend"],
    integrationEnvironment,
  );
  await restrictMigrationHistory(testEnvironment);
  run(
    "npm",
    ["run", "test:integration", "--workspace", "@tomasini/backend"],
    integrationEnvironment,
  );
  run(
    process.execPath,
    ["--test", "scripts/test-migrations.mjs"],
    integrationEnvironment,
  );
  run("python3", ["infra/ci_check_migrations.py", "probe"], integrationEnvironment);
  console.log(
    "CI completa: compilación, tipos, pruebas unitarias, API PostgreSQL y migraciones verificadas.",
  );
} catch {
  console.error(
    "CI detenida. Revisá la verificación fallida; no se publica ningún release.",
  );
  process.exitCode = 1;
} finally {
  if (prepared) unlinkSync(join(root, "backend/.env.test"));
}
