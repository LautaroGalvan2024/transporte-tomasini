import { spawn, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortAvailable } from "./db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await assertPortAvailable(3002);
await assertPortAvailable(5175);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
function launch(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  children.push(child);
  return child;
}
const db = launch(process.execPath, ["scripts/db.mjs", "start"]);
await new Promise((accept, reject) => {
  db.on("error", reject);
  db.on("exit", (code) =>
    code === 0
      ? accept()
      : reject(new Error("No se pudo iniciar PostgreSQL Tomasini.")),
  );
});
const launchNpm = (workspace) =>
  process.platform === "win32"
    ? launch(process.env.ComSpec || "cmd.exe", [
        "/d",
        "/s",
        "/c",
        `npm.cmd run dev --workspace ${workspace}`,
      ])
    : launch(npm, ["run", "dev", "--workspace", workspace]);
launchNpm("@tomasini/backend");
launchNpm("@tomasini/frontend");
console.log(
  "Tomasini: http://127.0.0.1:5175 · API http://127.0.0.1:3002/api/health",
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children)
    if (child.exitCode === null) {
      if (process.platform === "win32")
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else child.kill("SIGTERM");
    }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
