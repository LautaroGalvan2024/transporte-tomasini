import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selected = [
  "package.json",
  "package-lock.json",
  "backend/package.json",
  "backend/prisma.config.ts",
  "backend/tsconfig.json",
  "backend/tsconfig.build.json",
  "backend/prisma",
  "backend/src",
  "backend/scripts/bootstrap-admin.ts",
  "backend/scripts/migrate.ts",
  "backend/scripts/run-notifications.ts",
  "backend/dist",
  "frontend/package.json",
  "frontend/dist",
  "infra/backup.py",
];
for (const required of [
  "backend/dist/server.js",
  "frontend/dist/index.html",
  "package-lock.json",
]) {
  if (!existsSync(join(root, required)))
    throw new Error(
      `Falta ${required}; compilar y verificar antes de empaquetar.`,
    );
}
const files = [];
function inspect(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink())
    throw new Error("No se empaquetan enlaces simbólicos del checkout.");
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) inspect(join(path, name));
    return;
  }
  const name = relative(root, path).replaceAll("\\", "/");
  if (
    /(^|\/)(\.env[^/]*|\.local|node_modules|\.git|__pycache__)(\/|$)/.test(
      name,
    ) ||
    /\.(log|dump|pyc)$/.test(name)
  )
    throw new Error(
      `Archivo privado o generado inesperado en la selección: ${name}`,
    );
  files.push({
    path: name,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  });
}
for (const name of selected) inspect(join(root, name));
const directory = join(root, ".local", "releases");
mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = join(directory, `tomasini-${stamp}.tar.gz`);
if (existsSync(archive))
  throw new Error("El archivo de release ya existe; no se sobrescribe.");
const result = spawnSync("tar", ["-czf", archive, "-C", root, ...selected], {
  encoding: "utf8",
  windowsHide: true,
});
if (result.status !== 0)
  throw new Error("No se pudo crear el archivo de release.");
const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(
  archive + ".json",
  JSON.stringify(
    { archive, sha256, createdAt: new Date().toISOString(), files,
      installerSha256: createHash('sha256').update(readFileSync(join(root, 'infra/install_vps.py'))).digest('hex'),
      exporterSha256: createHash('sha256').update(readFileSync(join(root, 'infra/export_artifacts.py'))).digest('hex'),
    },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(JSON.stringify({ archive, sha256, fileCount: files.length }));
