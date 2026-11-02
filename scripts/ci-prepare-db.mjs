import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function assertRunner(environment = process.env) {
  if (
    environment.GITHUB_ACTIONS !== "true" ||
    environment.RUNNER_OS !== "Linux" ||
    resolve(environment.GITHUB_WORKSPACE || ".") !== root
  )
    throw new Error(
      "La preparación de CI solo admite el checkout de un runner Linux de GitHub.",
    );
}
export async function prepareDatabase() {
  assertRunner();
  if (existsSync(join(root, "backend/.env.test")))
    throw new Error("No se sobrescribe una configuración de tests existente.");
  const password = process.env.TOMASINI_CI_ADMIN_PASSWORD;
  if (!password)
    throw new Error(
      "Falta la contraseña desechable del servicio PostgreSQL de CI.",
    );
  const admin = new Client({
    host: "127.0.0.1",
    port: 55440,
    database: "postgres",
    user: "tomasini_ci_admin",
    password,
    connectionTimeoutMillis: 5000,
  });
  const appPassword = randomBytes(32).toString("hex");
  const migratorPassword = randomBytes(32).toString("hex");
  // Register masks before any child process can include a connection in diagnostics.
  for (const value of [password, appPassword, migratorPassword])
    console.log(`::add-mask::${value}`);
  try {
    await admin.connect();
    const identity = (
      await admin.query(
        "SELECT current_database() AS database, current_user AS username",
      )
    ).rows[0];
    if (
      identity.database !== "postgres" ||
      identity.username !== "tomasini_ci_admin"
    )
      throw new Error("Identidad de bootstrap de CI inesperada.");
    const existing = (
      await admin.query(
        "SELECT (SELECT count(*) FROM pg_database WHERE datname='tomasini_test') + (SELECT count(*) FROM pg_roles WHERE rolname IN ('tomasini_test_app','tomasini_test_migrator')) AS count",
      )
    ).rows[0];
    if (Number(existing.count) !== 0)
      throw new Error(
        "El servicio de CI no está vacío; no se resetean bases ni roles.",
      );
    await admin.query(
      `CREATE ROLE tomasini_test_migrator LOGIN PASSWORD '${migratorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4`,
    );
    await admin.query(
      `CREATE ROLE tomasini_test_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10`,
    );
    await admin.query(
      "CREATE DATABASE tomasini_test OWNER tomasini_test_migrator",
    );
    await admin.query("REVOKE ALL ON DATABASE tomasini_test FROM PUBLIC");
    await admin.query(
      "GRANT CONNECT ON DATABASE tomasini_test TO tomasini_test_app",
    );
    await admin.query("REVOKE ALL ON DATABASE postgres FROM PUBLIC");
  } finally {
    await admin.end();
  }
  const migrationUrl = `postgresql://tomasini_test_migrator:${migratorPassword}@127.0.0.1:55440/tomasini_test?schema=tomasini`;
  const appUrl = `postgresql://tomasini_test_app:${appPassword}@127.0.0.1:55440/tomasini_test?schema=tomasini`;
  const migrator = new Client({
    connectionString: migrationUrl,
    connectionTimeoutMillis: 5000,
  });
  try {
    await migrator.connect();
    await migrator.query(`CREATE SCHEMA tomasini AUTHORIZATION tomasini_test_migrator;
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA tomasini TO tomasini_test_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA tomasini GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tomasini_test_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA tomasini GRANT USAGE, SELECT ON SEQUENCES TO tomasini_test_app;`);
  } finally {
    await migrator.end();
  }
  const environment = {
    NODE_ENV: "test",
    TOMASINI_INTEGRATION: "1",
    DATABASE_URL: appUrl,
    MIGRATION_DATABASE_URL: migrationUrl,
    HOST: "127.0.0.1",
    PORT: "3002",
    APP_ORIGIN: "http://127.0.0.1:5175",
    DB_POOL_MAX: "4",
  };
  writeFileSync(
    join(root, "backend/.env.test"),
    Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "PostgreSQL CI: tomasini_test, app sin DDL ni privilegios elevados y migrador propio.",
  );
  return environment;
}
