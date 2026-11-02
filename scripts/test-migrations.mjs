import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { Client } from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(root, "backend");
const environment = {
  ...process.env,
  ...parse(readFileSync(join(backend, ".env.test"))),
  NODE_ENV: "test",
};
const destination = new URL(environment.MIGRATION_DATABASE_URL);
if (
  destination.hostname !== "127.0.0.1" ||
  destination.port !== "55440" ||
  destination.pathname !== "/tomasini_test" ||
  destination.username !== "tomasini_test_migrator"
)
  throw new Error(
    "Esta prueba solo admite el cluster local de tests de Tomasini.",
  );
function migrate(overrides = {}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrate.ts"],
    {
      cwd: backend,
      env: { ...environment, ...overrides },
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
    },
  );
}

test("el wrapper rechaza base ajena y rol de aplicación antes de conectarse", () => {
  for (const url of [
    "postgresql://mozzi_app:do-not-print@127.0.0.1:1/mozzi",
    "postgresql://tomasini_test_app:do-not-print@127.0.0.1:1/tomasini_test?schema=tomasini",
  ]) {
    const result = migrate({ MIGRATION_DATABASE_URL: url });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /do-not-print/);
    assert.match(result.stderr, /Destino rechazado/);
  }
});

test("dos ejecuciones sin pendientes conservan exactamente el historial aplicado", async () => {
  const connection = new Client({
    connectionString: environment.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await connection.connect();
    const identity = await connection.query(
      "SELECT current_database() AS database, current_user AS username",
    );
    assert.deepEqual(identity.rows, [
      { database: "tomasini_test", username: "tomasini_test_migrator" },
    ]);
    const query =
      "SELECT id, migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count FROM tomasini._prisma_migrations ORDER BY migration_name";
    const before = (await connection.query(query)).rows;
    assert.ok(
      before.length > 0,
      "Aplicar la migración inicial de tests antes de esta prueba.",
    );
    assert.ok(before.every((row) => row.finished_at && !row.rolled_back_at));
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = migrate();
      assert.equal(
        result.status,
        0,
        "El wrapper no completó la migración sobre el destino aislado.",
      );
    }
    const after = (await connection.query(query)).rows;
    assert.deepEqual(after, before);
  } finally {
    await connection.end();
  }
});
