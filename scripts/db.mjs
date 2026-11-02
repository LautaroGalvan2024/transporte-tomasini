import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = join(root, ".local");
const data = join(local, "postgres-data");
const bin =
  process.env.TOMASINI_PG_BIN ||
  "C:/Users/Nico/Desktop/Horizontes/.tools/postgresql-16.15/pgsql/bin";
const port = 55440;
const marker = join(local, "postgres-owner.json");
const credentialsPath = join(local, "infra-credentials.json");
const exe = (name) =>
  join(bin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
const secret = () => randomBytes(32).toString("hex");
let credentials;

function run(name, args, options = {}) {
  const result = spawnSync(exe(name), args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    let detail = String(
      result.stderr || result.error || result.stdout || "Operación fallida",
    );
    for (const value of Object.values(credentials || {}))
      if (typeof value === "string")
        detail = detail.replaceAll(value, "[privado]");
    throw new Error(`${name}: ${detail.trim()}`);
  }
  return String(result.stdout || "").trim();
}

function protect(path) {
  if (process.platform === "win32") {
    const who = spawnSync("whoami.exe", [], {
      encoding: "utf8",
      windowsHide: true,
    }).stdout.trim();
    const result = spawnSync(
      "icacls.exe",
      [path, "/inheritance:r", "/grant:r", `${who}:(F)`],
      { encoding: "utf8", windowsHide: true },
    );
    if (result.status !== 0)
      throw new Error(
        "No se pudieron restringir los permisos del archivo privado.",
      );
  }
}

function verifyOwner() {
  if (!existsSync(marker))
    throw new Error("Falta el marcador del cluster exclusivo Tomasini.");
  const owner = JSON.parse(readFileSync(marker, "utf8"));
  if (owner.project !== root || owner.data !== data || owner.port !== port)
    throw new Error("El cluster no pertenece a este checkout de Tomasini.");
  credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
}

export async function assertPortAvailable(selectedPort) {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Puerto ${selectedPort} ocupado; no se detuvo ningún proceso.`,
        ),
      ),
    );
    server.listen(selectedPort, "127.0.0.1", () => server.close(accept));
  });
}

function sql(
  query,
  database = "postgres",
  user = "tomasini_cluster_admin",
  password = credentials.admin,
) {
  return run(
    "psql",
    [
      "-X",
      "-w",
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      user,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    {
      input: query,
      env: { ...process.env, PGPASSWORD: password },
    },
  );
}

function status() {
  verifyOwner();
  const result = spawnSync(exe("pg_ctl"), ["status", "-D", data], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}

async function start() {
  verifyOwner();
  if (!status()) {
    await assertPortAvailable(port);
    run(
      "pg_ctl",
      [
        "start",
        "-w",
        "-t",
        "30",
        "-D",
        data,
        "-l",
        join(local, "postgres.log"),
      ],
      { stdio: "ignore" },
    );
  }
  const identity = sql("SELECT current_setting('data_directory');");
  if (resolve(identity) !== data)
    throw new Error(
      "El servidor encontrado no corresponde al cluster Tomasini.",
    );
  console.log(
    `PostgreSQL Tomasini activo exclusivamente en 127.0.0.1:${port}.`,
  );
}

async function setup() {
  if (existsSync(marker)) {
    verifyOwner();
    await start();
    if (JSON.parse(readFileSync(marker, "utf8")).provisioned) return;
    if (
      sql(
        "SELECT count(*) FROM pg_roles WHERE rolname IN ('tomasini_dev_migrator','tomasini_dev_app','tomasini_shadow_dev_migrator');",
      ) !== "0"
    )
      throw new Error(
        "Aprovisionamiento parcial: revisar roles propios antes de continuar; no se resetean.",
      );
  } else {
    if (existsSync(data) || existsSync(credentialsPath))
      throw new Error(
        "Hay archivos previos sin marcador válido; revisar antes de continuar.",
      );
    await assertPortAvailable(port);
    mkdirSync(local, { recursive: true });
    credentials = { admin: secret(), app: secret(), migrator: secret() };
    writeFileSync(credentialsPath, JSON.stringify(credentials), {
      mode: 0o600,
      flag: "wx",
    });
    protect(credentialsPath);
    const pwfile = join(local, "initdb-password");
    writeFileSync(pwfile, credentials.admin, { mode: 0o600, flag: "wx" });
    protect(pwfile);
    try {
      run("initdb", [
        "-D",
        data,
        "-U",
        "tomasini_cluster_admin",
        "--pwfile",
        pwfile,
        "-A",
        "scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
      ]);
    } finally {
      rmSync(pwfile, { force: true });
    }
    writeFileSync(
      join(data, "postgresql.auto.conf"),
      `listen_addresses = '127.0.0.1'\nport = ${port}\nmax_connections = 30\nshared_buffers = '64MB'\nlogging_collector = off\n`,
    );
    writeFileSync(
      join(data, "pg_hba.conf"),
      [
        "host all tomasini_cluster_admin 127.0.0.1/32 scram-sha-256",
        "host tomasini_dev tomasini_dev_app,tomasini_dev_migrator 127.0.0.1/32 scram-sha-256",
        "host tomasini_shadow_dev tomasini_shadow_dev_migrator 127.0.0.1/32 scram-sha-256",
        "host tomasini_restore_check tomasini_dev_migrator 127.0.0.1/32 scram-sha-256",
        "host all all 127.0.0.1/32 reject",
        "",
      ].join("\n"),
    );
    writeFileSync(marker, JSON.stringify({ project: root, data, port }), {
      flag: "wx",
    });
    await start();
  }
  sql(`CREATE ROLE tomasini_dev_migrator LOGIN PASSWORD '${credentials.migrator}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
CREATE ROLE tomasini_dev_app LOGIN PASSWORD '${credentials.app}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;
CREATE ROLE tomasini_shadow_dev_migrator LOGIN PASSWORD '${credentials.migrator}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3;
CREATE DATABASE tomasini_dev OWNER tomasini_dev_migrator;
CREATE DATABASE tomasini_shadow_dev OWNER tomasini_shadow_dev_migrator;
REVOKE ALL ON DATABASE tomasini_dev FROM PUBLIC;
REVOKE ALL ON DATABASE tomasini_shadow_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE tomasini_dev TO tomasini_dev_app;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;`);
  sql(
    `CREATE SCHEMA tomasini AUTHORIZATION tomasini_dev_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA tomasini TO tomasini_dev_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tomasini_dev_migrator IN SCHEMA tomasini GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tomasini_dev_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tomasini_dev_migrator IN SCHEMA tomasini GRANT USAGE, SELECT ON SEQUENCES TO tomasini_dev_app;`,
    "tomasini_dev",
  );
  const envPath = join(root, "backend", ".env.development");
  if (existsSync(envPath))
    throw new Error(
      "La base está preparada; el archivo de ambiente ya existe y no se sobrescribió.",
    );
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(
    envPath,
    [
      `DATABASE_URL=postgresql://tomasini_dev_app:${credentials.app}@127.0.0.1:${port}/tomasini_dev?schema=tomasini`,
      `MIGRATION_DATABASE_URL=postgresql://tomasini_dev_migrator:${credentials.migrator}@127.0.0.1:${port}/tomasini_dev?schema=tomasini`,
      `SHADOW_DATABASE_URL=postgresql://tomasini_shadow_dev_migrator:${credentials.migrator}@127.0.0.1:${port}/tomasini_shadow_dev?schema=tomasini`,
      "NODE_ENV=development",
      "HOST=127.0.0.1",
      "PORT=3002",
      "APP_ORIGIN=http://127.0.0.1:5175",
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  protect(envPath);
  writeFileSync(
    marker,
    JSON.stringify({ project: root, data, port, provisioned: true }),
  );
  console.log(
    "Base, roles y configuración privada de desarrollo preparados. No se aplicaron migraciones.",
  );
}

async function setupTest() {
  verifyOwner();
  await start();
  const envPath = join(root, "backend", ".env.test");
  if (existsSync(envPath)) {
    console.log("La configuración privada de tests ya existe; se conserva.");
    return;
  }
  if (
    sql("SELECT count(*) FROM pg_database WHERE datname='tomasini_test';") !==
      "0" ||
    sql(
      "SELECT count(*) FROM pg_roles WHERE rolname IN ('tomasini_test_app','tomasini_test_migrator');",
    ) !== "0"
  )
    throw new Error(
      "Hay recursos de tests previos sin configuración; no se reutilizan ni borran.",
    );
  credentials.testApp = secret();
  credentials.testMigrator = secret();
  writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
  const hba = join(data, "pg_hba.conf");
  const prior = readFileSync(hba, "utf8");
  const rule =
    "host tomasini_test tomasini_test_app,tomasini_test_migrator 127.0.0.1/32 scram-sha-256\n";
  writeFileSync(hba, rule + prior);
  if (
    sql("SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL;") !==
    "0"
  ) {
    writeFileSync(hba, prior);
    throw new Error("Regla local de tests inválida; se conservó HBA anterior.");
  }
  sql("SELECT pg_reload_conf();");
  sql(`BEGIN;
CREATE ROLE tomasini_test_migrator LOGIN PASSWORD '${credentials.testMigrator}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
CREATE ROLE tomasini_test_app LOGIN PASSWORD '${credentials.testApp}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 6;
COMMIT;
CREATE DATABASE tomasini_test OWNER tomasini_test_migrator;
REVOKE ALL ON DATABASE tomasini_test FROM PUBLIC;
GRANT CONNECT ON DATABASE tomasini_test TO tomasini_test_app;`);
  sql(
    `CREATE SCHEMA tomasini AUTHORIZATION tomasini_test_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA tomasini TO tomasini_test_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tomasini_test_migrator IN SCHEMA tomasini GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO tomasini_test_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tomasini_test_migrator IN SCHEMA tomasini GRANT USAGE,SELECT ON SEQUENCES TO tomasini_test_app;`,
    "tomasini_test",
  );
  writeFileSync(
    envPath,
    [
      `DATABASE_URL=postgresql://tomasini_test_app:${credentials.testApp}@127.0.0.1:${port}/tomasini_test?schema=tomasini`,
      `MIGRATION_DATABASE_URL=postgresql://tomasini_test_migrator:${credentials.testMigrator}@127.0.0.1:${port}/tomasini_test?schema=tomasini`,
      "NODE_ENV=test",
      "HOST=127.0.0.1",
      "PORT=3003",
      "APP_ORIGIN=http://127.0.0.1:5175",
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  protect(envPath);
  console.log(
    "Base y roles de integración aislados preparados; configuración privada backend/.env.test.",
  );
}

function grant(target = "dev") {
  verifyOwner();
  if (!["dev", "test"].includes(target))
    throw new Error("Destino de grants inválido.");
  const role = `tomasini_${target}_app`;
  sql(
    `GRANT USAGE ON SCHEMA tomasini TO ${role};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tomasini TO ${role};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tomasini TO ${role};
DO $$ BEGIN IF to_regclass('tomasini._prisma_migrations') IS NOT NULL THEN REVOKE ALL ON tomasini._prisma_migrations FROM ${role}; END IF; END $$;`,
    `tomasini_${target}`,
  );
  console.log(
    "Permisos DML propios aplicados; historial de migraciones excluido.",
  );
}

function isolationCheck() {
  verifyOwner();
  const identity = sql(
    "SELECT current_database() || ':' || current_user;",
    "tomasini_dev",
    "tomasini_dev_app",
    credentials.app,
  );
  if (identity !== "tomasini_dev:tomasini_dev_app")
    throw new Error("Identidad app inesperada.");
  const denied = spawnSync(
    exe("psql"),
    [
      "-X",
      "-w",
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "tomasini_dev_app",
      "-d",
      "postgres",
      "-Atc",
      "SELECT 1",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PGPASSWORD: credentials.app },
    },
  );
  if (
    denied.status === 0 ||
    !/pg_hba.conf rejects|rechaza|rejects connection/i.test(denied.stderr)
  )
    throw new Error("No se comprobó el rechazo HBA de la base ajena.");
  const caps = sql(
    "SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=current_user;",
    "tomasini_dev",
    "tomasini_dev_app",
    credentials.app,
  );
  if (caps !== "f")
    throw new Error("La cuenta app tiene privilegios elevados.");
  console.log(
    "Aislamiento comprobado: identidad, privilegios mínimos y rechazo HBA de destinos ajenos.",
  );
}

function backupRestoreCheck() {
  verifyOwner();
  if (
    sql(
      "SELECT count(*) FROM pg_database WHERE datname='tomasini_restore_check';",
    ) !== "0"
  )
    throw new Error(
      "La base de restauración ya existe; no se elimina ni reutiliza.",
    );
  const dump = join(local, `restore-check-${Date.now()}.dump`);
  run(
    "pg_dump",
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "tomasini_dev_migrator",
      "-d",
      "tomasini_dev",
      "-Fc",
      "--no-owner",
      "--no-acl",
      "-f",
      dump,
    ],
    { env: { ...process.env, PGPASSWORD: credentials.migrator } },
  );
  protect(dump);
  let created = false;
  try {
    sql("CREATE DATABASE tomasini_restore_check OWNER tomasini_dev_migrator;");
    created = true;
    run(
      "pg_restore",
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-U",
        "tomasini_dev_migrator",
        "-d",
        "tomasini_restore_check",
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
        dump,
      ],
      { env: { ...process.env, PGPASSWORD: credentials.migrator } },
    );
    const tableCounts = `SELECT table_name || ':' || (xpath('/row/c/text()',query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema,table_name),false,true,'')))[1]::text FROM information_schema.tables WHERE table_schema='tomasini' AND table_type='BASE TABLE' ORDER BY table_name;`;
    if (
      sql(tableCounts, "tomasini_dev") !==
      sql(tableCounts, "tomasini_restore_check")
    )
      throw new Error(
        "La restauración difiere en tablas o cantidad de registros.",
      );
    console.log(
      "Backup restaurado en base local exclusiva: tablas y cantidades coinciden.",
    );
  } finally {
    if (created) sql("DROP DATABASE tomasini_restore_check;");
    rmSync(dump, { force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const action = process.argv[2] || "status";
  try {
    if (action === "setup") await setup();
    else if (action === "setup-test") await setupTest();
    else if (action === "start") await start();
    else if (action === "status")
      console.log(
        status()
          ? "PostgreSQL Tomasini activo."
          : "PostgreSQL Tomasini detenido.",
      );
    else if (action === "grant") grant();
    else if (action === "grant-test") grant("test");
    else if (action === "check") isolationCheck();
    else if (action === "backup-restore-check") backupRestoreCheck();
    else if (action === "stop") {
      verifyOwner();
      run("pg_ctl", ["stop", "-w", "-D", data, "-m", "fast"]);
      console.log("Se detuvo únicamente el cluster local Tomasini.");
    } else
      throw new Error(
        "Acción válida: setup, setup-test, start, status, grant, grant-test, check, backup-restore-check, stop.",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
