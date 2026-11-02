import {
  readFileSync,
  realpathSync,
  statSync,
  lstatSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "tomasini.72-60-50-213.sslip.io";
const ORIGIN = `https://${HOST}`;
const SESSION_NAME = "__Host-tomasini_session";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let reportPath;
let stage = "validate_local_evidence";
let cookie = "";
let credential;
let failure = false;
const report = {
  target: ORIGIN,
  startedAt: new Date().toISOString(),
  status: "pending",
  checks: [],
  credentialsChanged: false,
  businessRecordsCreated: false,
  logoutAttempted: false,
};

function requireCheck(condition) {
  if (!condition) throw new Error("La comprobación no se completó.");
}
function contained(path, parent) {
  const normalizedPath =
    process.platform === "win32" ? path.toLowerCase() : path;
  const normalizedParent =
    process.platform === "win32" ? parent.toLowerCase() : parent;
  return normalizedPath.startsWith(normalizedParent + sep);
}
function json(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}
function passed(name, extra = {}) {
  report.checks.push({ check: name, status: "passed", ...extra });
}
async function request(
  path,
  { method = "GET", body, authenticated = false } = {},
) {
  const url = new URL(path, ORIGIN);
  requireCheck(
    url.origin === ORIGIN &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password,
  );
  const headers = { Accept: "application/json, text/html;q=0.8, */*;q=0.5" };
  if (method !== "GET") {
    headers.Origin = ORIGIN;
    headers["X-Tomasini-Request"] = "1";
    headers["Content-Type"] = "application/json";
  }
  if (authenticated) {
    requireCheck(Boolean(cookie));
    headers.Cookie = cookie;
  }
  return fetch(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
}
async function smallText(response, maximum = 1_000_000) {
  requireCheck(Number(response.headers.get("content-length") ?? 0) <= maximum);
  const reader = response.body?.getReader();
  requireCheck(reader);
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      requireCheck(length <= maximum);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}
async function responseJson(response) {
  requireCheck(
    /^application\/json(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? "",
    ),
  );
  return JSON.parse(await smallText(response, 100_000));
}
function attributes(tag) {
  return Object.fromEntries(
    Array.from(
      tag.matchAll(/\b([a-zA-Z-]+)\s*=\s*["']([^"']*)["']/g),
      (match) => [match[1].toLowerCase(), match[2]],
    ),
  );
}
function assetPath(value, extension) {
  const url = new URL(value, ORIGIN);
  requireCheck(
    url.origin === ORIGIN &&
      url.pathname.startsWith("/assets/") &&
      url.pathname.endsWith(extension) &&
      !url.username &&
      !url.password &&
      !url.hash,
  );
  return url.pathname + url.search;
}

try {
  const entries = process.argv.slice(2).map((value) => {
    const index = value.indexOf("=");
    requireCheck(value.startsWith("--") && index >= 3);
    return [value.slice(2, index), value.slice(index + 1)];
  });
  const args = Object.fromEntries(entries);
  requireCheck(entries.length === Object.keys(args).length);
  requireCheck(
    args.evidence &&
      args.credentials &&
      Object.keys(args).every((key) =>
        ["evidence", "credentials"].includes(key),
      ),
  );
  const evidenceBase = realpathSync(join(ROOT, ".local", "deployments"));
  const accessBase = realpathSync(join(ROOT, ".local", "production-access"));
  const evidence = realpathSync(args.evidence);
  const credentialsFile = realpathSync(args.credentials);
  requireCheck(
    contained(evidence, evidenceBase) && statSync(evidence).isDirectory(),
  );
  requireCheck(
    contained(credentialsFile, accessBase) &&
      statSync(credentialsFile).isFile(),
  );
  requireCheck(!lstatSync(resolve(args.credentials)).isSymbolicLink());
  requireCheck(basename(credentialsFile) === "admin-inicial.json");
  const releaseId = basename(evidence);
  requireCheck(
    /^[a-f0-9]{16,64}$/.test(releaseId) &&
      basename(dirname(credentialsFile)) === releaseId,
  );
  const installed = json(join(evidence, "installed.json"));
  requireCheck(
    installed.host === HOST &&
      installed.database === "tomasini_prod" &&
      installed.verification?.publicReadiness === 200 &&
      installed.verification?.existingApplicationsPreserved === true,
  );
  requireCheck(
    typeof installed.release === "string" &&
      /^[a-f0-9]{64}$/.test(installed.release) &&
      installed.release.startsWith(releaseId),
  );
  reportPath = join(evidence, "smoke-production.json");
  requireCheck(!existsSync(reportPath));
  credential = json(credentialsFile);
  requireCheck(
    typeof credential.username === "string" &&
      credential.username.length >= 3 &&
      typeof credential.password === "string" &&
      credential.password.length >= 12 &&
      credential.password.length <= 128 &&
      credential.mustChangePassword === true,
  );
  passed(stage);

  stage = "public_readiness";
  const readiness = await request("/api/ready");
  requireCheck(
    readiness.status === 200 && (await responseJson(readiness)).status === "ok",
  );
  passed(stage, { httpStatus: 200 });

  stage = "homepage";
  const homepage = await request("/");
  requireCheck(
    homepage.status === 200 &&
      /^text\/html(?:\s*;|$)/i.test(homepage.headers.get("content-type") ?? ""),
  );
  const html = await smallText(homepage);
  const scripts = [
    ...new Set(
      Array.from(
        html.matchAll(/<script\b[^>]*>/gi),
        (match) => attributes(match[0]).src,
      )
        .filter(Boolean)
        .map((value) => assetPath(value, ".js")),
    ),
  ];
  const styles = [
    ...new Set(
      Array.from(html.matchAll(/<link\b[^>]*>/gi), (match) =>
        attributes(match[0]),
      )
        .filter((attr) => (attr.rel ?? "").split(/\s+/).includes("stylesheet"))
        .map((attr) => assetPath(attr.href, ".css")),
    ),
  ];
  requireCheck(scripts.length > 0 && styles.length > 0);
  passed(stage, { httpStatus: 200 });
  stage = "javascript_assets";
  for (const path of scripts) {
    const response = await request(path);
    requireCheck(
      response.status === 200 &&
        /^(?:text|application)\/(?:javascript|ecmascript)(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        ),
    );
    await response.body?.cancel();
  }
  passed(stage, { count: scripts.length, httpStatus: 200 });
  stage = "stylesheet_assets";
  for (const path of styles) {
    const response = await request(path);
    requireCheck(
      response.status === 200 &&
        /^text\/css(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        ),
    );
    await response.body?.cancel();
  }
  passed(stage, { count: styles.length, httpStatus: 200 });

  stage = "anonymous_trips_rejected";
  const anonymous = await request("/api/trips");
  requireCheck(
    anonymous.status === 401 &&
      (await responseJson(anonymous)).error?.code === "UNAUTHENTICATED",
  );
  passed(stage, { httpStatus: 401 });

  stage = "bootstrap_login_and_cookie";
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { username: credential.username, password: credential.password },
  });
  // Keep only the cookie pair in memory, including when a later assertion fails.
  const sessionCookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SESSION_NAME}=`));
  if (sessionCookie) cookie = sessionCookie.split(";", 1)[0];
  requireCheck(login.status === 200 && sessionCookie);
  requireCheck(new RegExp(`^${SESSION_NAME}=[a-f0-9]{64}$`).test(cookie));
  requireCheck(
    /;\s*Secure(?:;|$)/i.test(sessionCookie) &&
      /;\s*HttpOnly(?:;|$)/i.test(sessionCookie) &&
      /;\s*SameSite=Strict(?:;|$)/i.test(sessionCookie) &&
      /;\s*Path=\/(?:;|$)/i.test(sessionCookie) &&
      !/;\s*Domain=/i.test(sessionCookie),
  );
  const loggedIn = await responseJson(login);
  requireCheck(
    loggedIn.role === "ADMIN" &&
      loggedIn.active === true &&
      loggedIn.mustChangePassword === true,
  );
  credential.password = "";
  passed(stage, {
    httpStatus: 200,
    secureCookie: true,
    httpOnlyCookie: true,
    sameSite: "Strict",
    mustChangePassword: true,
  });

  stage = "authenticated_profile";
  const me = await request("/api/auth/me", { authenticated: true });
  const profile = await responseJson(me);
  requireCheck(
    me.status === 200 &&
      profile.role === "ADMIN" &&
      profile.active === true &&
      profile.mustChangePassword === true,
  );
  passed(stage, { httpStatus: 200 });

  stage = "password_change_gate";
  const dashboard = await request("/api/dashboard", { authenticated: true });
  requireCheck(
    dashboard.status === 403 &&
      (await responseJson(dashboard)).error?.code ===
        "PASSWORD_CHANGE_REQUIRED",
  );
  passed(stage, { httpStatus: 403 });
} catch {
  failure = true;
  report.checks.push({ check: stage, status: "failed" });
} finally {
  if (credential) credential.password = "";
  if (cookie) {
    report.logoutAttempted = true;
    try {
      const logout = await request("/api/auth/logout", {
        method: "POST",
        authenticated: true,
      });
      requireCheck(logout.status === 204);
      passed("logout", { httpStatus: 204 });
      const revoked = await request("/api/auth/me", { authenticated: true });
      requireCheck(revoked.status === 401);
      await revoked.body?.cancel();
      passed("session_revoked", { httpStatus: 401 });
    } catch {
      failure = true;
      report.checks.push({
        check: "logout_or_session_revocation",
        status: "failed",
      });
    } finally {
      cookie = "";
    }
  }
  credential = undefined;
  report.status = failure ? "failed" : "passed";
  report.completedAt = new Date().toISOString();
  if (reportPath) {
    try {
      writeFileSync(reportPath, JSON.stringify(report, null, 2), {
        mode: 0o600,
        flag: "wx",
      });
    } catch {
      failure = true;
    }
  }
}
console.log(
  failure
    ? "Smoke de producción: FAILED. Revisar la evidencia privada, sin secretos impresos."
    : "Smoke de producción: PASSED. Sesión cerrada; contraseña y registros operativos sin cambios. Evidencia privada guardada.",
);
if (failure) process.exitCode = 1;
