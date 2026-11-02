import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = "24.21.0";
const filename = `node-v${version}-linux-x64.tar.xz`;
const url = `https://nodejs.org/dist/v${version}/`;
const directory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".local",
  "runtime",
);
mkdirSync(directory, { recursive: true });
const response = await fetch(`${url}SHASUMS256.txt`, {
  signal: AbortSignal.timeout(30000),
});
if (!response.ok)
  throw new Error("No se pudo consultar el checksum oficial de Node.");
const sums = await response.text();
const expected = sums
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .find((parts) => parts[1] === filename)?.[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected))
  throw new Error("El archivo Linux x64 no aparece en el manifiesto oficial.");
const destination = join(directory, filename);
const checksum = (buffer) => createHash("sha256").update(buffer).digest("hex");
if (existsSync(destination)) {
  if (checksum(readFileSync(destination)) !== expected)
    throw new Error("El runtime previo no coincide; no se sobrescribió.");
} else {
  const archive = await fetch(`${url}${filename}`, {
    signal: AbortSignal.timeout(180000),
  });
  if (!archive.ok) throw new Error("No se pudo descargar el runtime oficial.");
  const bytes = Buffer.from(await archive.arrayBuffer());
  if (checksum(bytes) !== expected)
    throw new Error(
      "El archivo descargado no coincide con el checksum oficial.",
    );
  const temporary = join(directory, `${filename}.${randomUUID()}.partial`);
  try {
    writeFileSync(temporary, bytes, { flag: "wx" });
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
writeFileSync(
  join(directory, "node-verification.json"),
  JSON.stringify(
    {
      version,
      archive: destination,
      sha256: expected,
      checksumSource: `${url}SHASUMS256.txt`,
      verifiedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    archive: destination,
    sha256: expected,
    checksumSource: `${url}SHASUMS256.txt`,
  }),
);
