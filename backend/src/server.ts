import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { assertDatabaseScope, disconnect } from "./db.js";

async function main() {
  await assertDatabaseScope();
  const cfg = getConfig();
  const server = createApp().listen(cfg.port, cfg.host, () =>
    console.log(`API Tomasini disponible en ${cfg.host}:${cfg.port}`),
  );
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void disconnect().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
main().catch(() => {
  console.error(
    "No se pudo iniciar Tomasini. Revisá la configuración y el aislamiento PostgreSQL.",
  );
  process.exitCode = 1;
  void disconnect();
});
