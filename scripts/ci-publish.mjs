import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertRunner } from "./ci-prepare-db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = "LautaroGalvan2024/transporte-tomasini";
const digestPattern = /^[a-f0-9]{64}$/;
export function validatePublishContext(environment) {
  if (
    environment.GITHUB_REPOSITORY !== repository ||
    environment.GITHUB_REF !== "refs/heads/main" ||
    !["push", "workflow_dispatch"].includes(environment.GITHUB_EVENT_NAME)
  )
    throw new Error(
      "Solo se publica main del repositorio Tomasini mediante push o ejecución manual.",
    );
  if (!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA || ""))
    throw new Error("Commit de publicación inválido.");
  if (
    !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(
      environment.TOMASINI_DEPLOY_HOST || "",
    )
  )
    throw new Error("Host SSH inválido o sin configurar.");
  if (environment.TOMASINI_DEPLOY_USER !== "tomasini-ci")
    throw new Error("El usuario de publicación debe ser tomasini-ci.");
  if (!environment.TOMASINI_DEPLOY_KNOWN_HOSTS?.trim())
    throw new Error("Falta la clave pública verificada del host SSH.");
  if (
    !environment.TOMASINI_DEPLOY_KEY?.includes(
      "-----BEGIN OPENSSH PRIVATE KEY-----",
    )
  )
    throw new Error("Falta la llave exclusiva de publicación.");
  return {
    host: environment.TOMASINI_DEPLOY_HOST,
    user: environment.TOMASINI_DEPLOY_USER,
    commit: environment.GITHUB_SHA,
  };
}
export function validateReceipt(receipt, sha, commit) {
  if (
    receipt?.status !== "deployed" ||
    receipt.commit !== commit ||
    receipt.release !== sha ||
    !digestPattern.test(receipt.previousRelease || "")
  )
    throw new Error("El receptor no confirmó el release y commit esperados.");
  return {
    status: "deployed",
    commit,
    release: sha,
    previousRelease: receipt.previousRelease,
  };
}
function publicChildEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    "TOMASINI_DEPLOY_KEY",
    "TOMASINI_DEPLOY_KNOWN_HOSTS",
    "GITHUB_TOKEN",
    "TOMASINI_CI_ADMIN_PASSWORD",
  ])
    delete environment[name];
  return environment;
}
async function assertLatestMain(commit) {
  if (!process.env.GITHUB_TOKEN)
    throw new Error("Falta el token de lectura para verificar main.");
  const response = await fetch(
    `https://api.github.com/repos/${repository}/git/ref/heads/main`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error("No se pudo verificar el commit actual de main.");
  const value = await response.json();
  if (value?.object?.sha !== commit)
    throw new Error(
      "Main avanzó a otro commit. Esta ejecución anterior no se publica.",
    );
}
export async function publish() {
  assertRunner();
  if (process.version !== "v24.21.0")
    throw new Error("La publicación requiere Node.js 24.21.0.");
  const { host, user, commit } = validatePublishContext(process.env);
  const childEnvironment = publicChildEnvironment();
  const checkedOut = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    env: childEnvironment,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (checkedOut.status !== 0 || checkedOut.stdout.trim() !== commit)
    throw new Error("El checkout no coincide con el commit del workflow.");
  await assertLatestMain(commit);
  const packaged = spawnSync(
    process.execPath,
    ["scripts/package-release.mjs"],
    { cwd: root, env: childEnvironment, encoding: "utf8", timeout: 60_000 },
  );
  if (packaged.status !== 0)
    throw new Error("No se pudo empaquetar el release verificado.");
  let artifact;
  try {
    artifact = JSON.parse(packaged.stdout.trim());
  } catch {
    throw new Error("El empaquetador no devolvió un manifiesto válido.");
  }
  if (!digestPattern.test(artifact.sha256 || ""))
    throw new Error("Huella de release inválida.");
  const archive = realpathSync(artifact.archive);
  const within = relative(realpathSync(join(root, ".local/releases")), archive);
  const stats = lstatSync(archive);
  if (
    within.startsWith("..") ||
    within.startsWith("/") ||
    !stats.isFile() ||
    stats.size < 1 ||
    stats.size > 3 * 1024 * 1024
  )
    throw new Error(
      "El paquete está fuera de la carpeta o del tamaño admitido.",
    );
  if (
    createHash("sha256").update(readFileSync(archive)).digest("hex") !==
    artifact.sha256
  )
    throw new Error("El paquete cambió después de calcular su huella.");
  const temporary = mkdtempSync(join(process.env.RUNNER_TEMP, "tomasini-ssh-"));
  chmodSync(temporary, 0o700);
  let archiveFd;
  try {
    const key = join(temporary, "deploy.key");
    const knownHosts = join(temporary, "known_hosts");
    writeFileSync(
      key,
      process.env.TOMASINI_DEPLOY_KEY.replaceAll("\r\n", "\n").trim() + "\n",
      { mode: 0o600, flag: "wx" },
    );
    writeFileSync(
      knownHosts,
      process.env.TOMASINI_DEPLOY_KNOWN_HOSTS.trim() + "\n",
      { mode: 0o600, flag: "wx" },
    );
    const pinned = spawnSync("ssh-keygen", ["-F", host, "-f", knownHosts], {
      env: childEnvironment,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (pinned.status !== 0 || !pinned.stdout.trim())
      throw new Error(
        "La lista de hosts verificados no contiene el servidor configurado.",
      );
    // Recheck immediately before the only command that can change the VPS.
    await assertLatestMain(commit);
    archiveFd = openSync(archive, "r");
    const result = spawnSync(
      "ssh",
      [
        "-T",
        "-F",
        "/dev/null",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${knownHosts}`,
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "IdentityAgent=none",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "RequestTTY=no",
        "-o",
        "ConnectTimeout=20",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-i",
        key,
        "-l",
        user,
        host,
        `deploy ${artifact.sha256} ${commit}`,
      ],
      {
        cwd: root,
        env: childEnvironment,
        stdio: [archiveFd, "pipe", "pipe"],
        encoding: "utf8",
        timeout: 20 * 60 * 1000,
        maxBuffer: 256 * 1024,
      },
    );
    if (result.status !== 0 || result.error) {
      if (
        /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(
          result.stderr || "",
        )
      )
        throw new Error(
          "La clave SSH del servidor no coincide con la verificada. No se publicó.",
        );
      if (/Permission denied/.test(result.stderr || ""))
        throw new Error(
          "La llave exclusiva no fue aceptada por el receptor Tomasini.",
        );
      throw new Error(
        "El receptor no confirmó la publicación. Revisar el recibo y diagnóstico privado en la VPS antes de reintentar.",
      );
    }
    let receipt;
    try {
      receipt = JSON.parse(result.stdout.trim());
    } catch {
      throw new Error("La respuesta de publicación no es un recibo válido.");
    }
    const verified = validateReceipt(receipt, artifact.sha256, commit);
    console.log(JSON.stringify(verified));
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Tomasini publicado.\n\n- Commit: \`${commit}\`\n- Release: \`${artifact.sha256}\`\n- Versión anterior: \`${verified.previousRelease}\`\n\nLa base, sus usuarios y la configuración de producción se conservan.\n`,
      );
  } finally {
    if (archiveFd !== undefined) closeSync(archiveFd);
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  publish().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Publicación detenida.",
    );
    process.exitCode = 1;
  });
}
