import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const marker = "__TOMASINI_FRONTEND_VERSION__";
const manifest = "frontend-version.json";

// The version covers the bytes served to the browser, including public assets.
// The two files that carry the version cannot contribute the digest itself.
export function stampFrontend(directory: string) {
  const index = join(directory, "index.html");
  const template = readFileSync(index, "utf8");
  if (template.split(marker).length !== 2) {
    throw new Error("Falta el marcador único de versión en el HTML del frontend.");
  }
  const paths = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((name) => name !== manifest)
    .sort();
  const hash = createHash("sha256");
  for (const name of paths) {
    const bytes = readFileSync(join(directory, name));
    hash.update(name + "\0" + bytes.length + "\0");
    hash.update(bytes);
  }
  const version = hash.digest("hex");
  writeFileSync(index, template.replace(marker, version));
  writeFileSync(join(directory, manifest), JSON.stringify({ version }) + "\n");
  return version;
}
