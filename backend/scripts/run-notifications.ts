import { assertDatabaseScope, disconnect } from "../src/db.js";
import { runNotificationJob } from "../src/notifications.js";
import { runHolidayCalendarSync } from "../src/holiday-calendar.js";

async function main() {
  await assertDatabaseScope();
  // Calendar refresh is independent from SMTP configuration and delivery.
  // A source outage must not prevent the existing notification job.
  try {
    const calendar = await runHolidayCalendarSync();
    console.log(
      `Tomasini feriados: ${calendar.reason}; consultados=${calendar.checked}, fallidos=${calendar.failed}.`,
    );
  } catch {
    console.error(
      "No se pudo actualizar la propuesta de feriados de Tomasini. Se conserva el calendario activo.",
    );
  }
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
