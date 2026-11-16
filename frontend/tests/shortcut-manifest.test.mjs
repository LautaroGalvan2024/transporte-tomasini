import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const publicDir = new URL("../public/", import.meta.url);

function linkedFile(rel) {
  const tag = html
    .match(/<link\b[^>]*>/gi)
    .find((line) => line.includes(`rel="${rel}"`));
  const href = tag?.match(/\bhref="([^"]+)"/i)?.[1];
  assert.ok(href?.startsWith("/"), `Falta el recurso local ${rel}`);
  return new URL(href.slice(1), publicDir);
}

function checkPng(path, width) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  assert.equal(bytes.readUInt32BE(16), width);
  assert.equal(bytes.readUInt32BE(20), width);
}

test("el acceso instalado abre Inicio desde cualquier ruta y usa los íconos de Tomasini", () => {
  const manifest = JSON.parse(readFileSync(linkedFile("manifest"), "utf8"));
  assert.equal(manifest.name, "Transporte Tomasini");
  assert.equal(manifest.short_name, "Tomasini");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  for (const [size, purpose] of [
    [192, "any"],
    [512, "any"],
    [512, "maskable"],
  ]) {
    const icon = manifest.icons.find(
      (entry) =>
        entry.sizes === `${size}x${size}` &&
        (entry.purpose || "any").split(" ").includes(purpose),
    );
    assert.equal(icon?.type, "image/png");
    assert.ok(
      icon.src.startsWith("/"),
      "El ícono debe estar en el dominio del frontend.",
    );
    checkPng(new URL(icon.src.slice(1), publicDir), size);
  }
  checkPng(linkedFile("apple-touch-icon"), 180);
});
