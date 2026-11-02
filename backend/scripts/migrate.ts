import "../src/load-env.js";
import { Client } from "pg";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateDatabaseUrl } from "../src/config.js";

async function main() {
  const raw = process.env.MIGRATION_DATABASE_URL;
  const expected = validateDatabaseUrl(raw, "migration");
  const connection = new Client({
    connectionString: raw,
    connectionTimeoutMillis: 5000,
  });
  try {
    await connection.connect();
    const { rows } =
      await connection.query(`SELECT current_database() AS database, current_user AS username, r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls AS elevated,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a WHERE a.grantee = 0) AS public_access
      FROM pg_roles r JOIN pg_database d ON d.datname = current_database() WHERE r.rolname = current_user`);
    const identity = rows[0];
    if (
      !identity ||
      identity.database !== expected.database ||
      identity.username !== expected.username ||
      identity.elevated ||
      identity.public_access
    )
      throw new Error("Destino o privilegios de migración rechazados.");
  } finally {
    await connection.end();
  }
  const cli = fileURLToPath(
    new URL("../../node_modules/prisma/build/index.js", import.meta.url),
  );
  const child = spawnSync(
    process.execPath,
    [cli, "migrate", "deploy", "--config", "prisma.config.ts"],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
  // Prisma output can echo connection identifiers; only emit operation status.
  if (child.status !== 0)
    throw new Error(
      "La migración no se completó. Revisá las migraciones y permisos exclusivos de Tomasini.",
    );
  console.log("Migraciones revisadas de Tomasini aplicadas correctamente.");
}
main().catch((error) => {
  console.error(
    error instanceof Error && error.message.startsWith("Destino")
      ? error.message
      : "No se pudo aplicar la migración de Tomasini.",
  );
  process.exitCode = 1;
});
