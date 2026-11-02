import { assertDatabaseScope, disconnect } from "../src/db.js";
import { runNotificationJob } from "../src/notifications.js";

async function main() {
  await assertDatabaseScope();
  const result = await runNotificationJob();
  console.log(
    `Tomasini avisos: ${result.reason}; enviados=${result.sent}, pendientes=${result.pending}.`,
  );
}
main()
  .catch(() => {
    console.error("No se pudo ejecutar el trabajo de avisos de Tomasini.");
    process.exitCode = 1;
  })
  .finally(disconnect);
