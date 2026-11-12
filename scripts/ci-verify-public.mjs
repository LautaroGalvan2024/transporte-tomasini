import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Compare the public site to the build that passed CI, without using a login or
// a deployment credential. A working API alone does not prove the UI switched.
const site = "https://tomasini.72-60-50-213.sslip.io";
const dist = new URL("../frontend/dist/", import.meta.url);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const get = (path) => fetch(site + path, {
  cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
});
async function verify() {
  const home = readFileSync(fileURLToPath(new URL("index.html", dist)));
  const assets = [...home.toString("utf8").matchAll(/(?:src|href)="(\/assets\/[A-Za-z0-9_.-]+\.(?:css|js))"/g)].map(m => m[1]);
  assert.ok(assets.some(p => p.endsWith(".js")) && assets.some(p => p.endsWith(".css")), "El build no tiene los recursos esperados.");
  for (const path of ["/", ...new Set(assets)]) {
    const local = path === "/" ? home : readFileSync(fileURLToPath(new URL(path.slice(1), dist)));
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(local), "Producción no sirve el build verificado: " + path);
  }
  assert.equal((await get("/api/ready")).status, 200, "La API no está lista.");
  assert.equal((await get("/api/trips/export")).status, 401, "El reporte debe exigir sesión.");
}
for (let attempt = 1; ; attempt++) {
  try {
    await verify();
    console.log("Sitio público verificado: HTML, JavaScript y CSS del build, API lista y Excel protegido.");
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
