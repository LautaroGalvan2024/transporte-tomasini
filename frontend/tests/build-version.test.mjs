import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stampFrontend } from "../build-version.ts";

test("la versión identifica el HTML y los archivos servidos, incluidos los de public", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tomasini-front-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const index = join(dir, "index.html");
  const logo = join(dir, "brand", "logo.webp");
  const template = '<meta name="tomasini-frontend-version" content="__TOMASINI_FRONTEND_VERSION__">';
  mkdirSync(join(dir, "brand"));
  writeFileSync(logo, Buffer.from([0, 255]));
  writeFileSync(index, template);
  const first = stampFrontend(dir);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.ok(readFileSync(index, "utf8").includes(first));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "frontend-version.json"))), { version: first });
  writeFileSync(index, template);
  assert.equal(stampFrontend(dir), first);
  writeFileSync(index, template);
  writeFileSync(logo, Buffer.from([1, 255]));
  assert.notEqual(stampFrontend(dir), first);
  writeFileSync(index, "<html></html>");
  assert.throws(() => stampFrontend(dir), /marcador/);
});
