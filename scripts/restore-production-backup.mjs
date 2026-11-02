import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argument = process.argv.find((value) => value.startsWith("--evidence="));
if (!argument)
  throw new Error(
    "Indicar --evidence=ruta de evidencia local de este despliegue.",
  );
const evidence = realpathSync(argument.slice("--evidence=".length));
const allowed = realpathSync(join(root, ".local", "deployments")) + sep;
if (!evidence.startsWith(allowed))
  throw new Error(
    "La evidencia debe estar dentro de .local/deployments de Tomasini.",
  );
const json = (path) =>
  JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
const receipt = json(join(evidence, "installed.json"));
const metadata = json(join(evidence, "backup-manifest.json"));
const dump = join(evidence, "tomasini_prod.dump");
const dumpHash = createHash("sha256").update(readFileSync(dump)).digest("hex");
if (
  receipt.database !== "tomasini_prod" ||
  !receipt.verification?.existingApplicationsPreserved ||
  metadata.database !== "tomasini_prod" ||
  metadata.sha256 !== dumpHash
)
  throw new Error("Recibo o respaldo inválido; no se restaura.");
const marker = json(join(root, ".local", "postgres-owner.json"));
if (
  marker.project !== root ||
  marker.port !== 55440 ||
  marker.data !== join(root, ".local", "postgres-data")
)
  throw new Error("El cluster de pruebas no pertenece a este checkout.");
const credentials = json(join(root, ".local", "infra-credentials.json"));
const bin =
  process.env.TOMASINI_PG_BIN ||
  "C:/Users/Nico/Desktop/Horizontes/.tools/postgresql-16.15/pgsql/bin";
const environment = {
  ...process.env,
  PGPASSWORD: credentials.admin,
  PGCONNECT_TIMEOUT: "5",
};
const database = "tomasini_prod_restore_check";
function run(name, args, input) {
  const result = spawnSync(
    join(bin, name + (process.platform === "win32" ? ".exe" : "")),
    args,
    {
      input,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `${name} no completó la restauración aislada; no se imprimen datos ni credenciales.`,
    );
  return result.stdout.trim();
}
function sql(statement, target = "postgres") {
  return run(
    "psql",
    [
      "-X",
      "-w",
      "-h",
      "127.0.0.1",
      "-p",
      "55440",
      "-U",
      "tomasini_cluster_admin",
      "-d",
      target,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    statement,
  );
}
function verifyCluster() {
  if (resolve(sql("SELECT current_setting('data_directory');")) !== marker.data)
    throw new Error("Identidad del cluster local inesperada.");
}
verifyCluster();
if (
  sql(`SELECT count(*) FROM pg_database WHERE datname='${database}';`) !== "0"
)
  throw new Error(
    "La base de restauración ya existe; no se reutiliza ni elimina.",
  );
const reportPath = join(evidence, "restore-verification.json");
if (existsSync(reportPath))
  throw new Error("La restauración ya tiene evidencia; no se sobrescribe.");
let created = false;
let report;
try {
  sql(
    `CREATE DATABASE ${database} OWNER tomasini_dev_migrator; REVOKE ALL ON DATABASE ${database} FROM PUBLIC;`,
  );
  created = true;
  run("pg_restore", [
    "-h",
    "127.0.0.1",
    "-p",
    "55440",
    "-U",
    "tomasini_cluster_admin",
    "-d",
    database,
    "--role=tomasini_dev_migrator",
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    dump,
  ]);
  const tables = sql(
    `SELECT table_name || ':' || (xpath('/row/c/text()',query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema,table_name),false,true,'')))[1]::text FROM information_schema.tables WHERE table_schema='tomasini' AND table_type='BASE TABLE' ORDER BY table_name;`,
    database,
  );
  const adminCount = Number(
    sql("SELECT count(*) FROM tomasini.\"User\" WHERE role='ADMIN';", database),
  );
  const migrations = Number(
    sql(
      "SELECT count(*) FROM tomasini._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;",
      database,
    ),
  );
  const failedMigrations = Number(
    sql(
      "SELECT count(*) FROM tomasini._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;",
      database,
    ),
  );
  if (adminCount < 1 || migrations < 1 || failedMigrations !== 0 || !tables)
    throw new Error(
      "El respaldo restaurado no contiene una estructura y administración completas.",
    );
  report = {
    status: "restored_and_verified",
    sourceDatabase: "tomasini_prod",
    sha256: dumpHash,
    verifiedAt: new Date().toISOString(),
    target: "local isolated PostgreSQL 55440",
    adminCount,
    migrations,
    tableCounts: tables.split(/\r?\n/).map((line) => {
      const [table, count] = line.split(":");
      return { table, count: Number(count) };
    }),
  };
} finally {
  if (created) {
    verifyCluster();
    sql(`DROP DATABASE ${database};`);
  }
}
writeFileSync(reportPath, JSON.stringify(report, null, 2), {
  mode: 0o600,
  flag: "wx",
});
console.log(
  "Respaldo productivo restaurado y verificado en PostgreSQL local exclusivo. La base temporal propia fue retirada. Evidencia guardada sin datos personales.",
);
