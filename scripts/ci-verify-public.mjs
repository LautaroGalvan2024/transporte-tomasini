import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Compare the public site to the build that passed CI, without using a login or
// a deployment credential. A working API alone does not prove the UI switched.
const site = "https://transporte-tomasini.com";
const apiSite = "https://transporte-tomasini-api.com";
const previousSite = "https://tomasini.72-60-50-213.sslip.io";
const dist = new URL("../frontend/dist/", import.meta.url);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const get = (path, origin = site) => fetch(origin + path, {
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
  for (const origin of [site, apiSite]) {
    const ready = await get("/api/ready", origin);
    assert.equal(ready.status, 200, origin);
    assert.equal((await ready.json()).status, "ok", origin);
    const report = await get("/api/trips/export?format=monthly", origin);
    assert.equal(report.status, 401, origin);
    assert.equal((await report.json()).error?.code, "UNAUTHENTICATED", origin);
  }
  assert.equal((await get("/", apiSite)).status, 404, "La portada sólo se sirve en el frontend.");
  for (const [alias, target, path] of [
    [previousSite, site, "/join?ref=verify"],
    ["https://www.transporte-tomasini.com", site, "/join?ref=verify"],
    ["https://www.transporte-tomasini-api.com", apiSite, "/api/ready?ref=verify"],
  ]) {
    const response = await fetch(alias + path, {
      redirect: "manual", signal: AbortSignal.timeout(15_000),
    });
    assert.ok([301, 308].includes(response.status), alias);
    assert.equal(response.headers.get("location"), target + path, alias);
  }
}
for (let attempt = 1; ; attempt++) {
  try {
    await verify();
    console.log("Frontend del build verificado, API lista en ambos dominios, Excel protegido y redirecciones verificadas.");
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
