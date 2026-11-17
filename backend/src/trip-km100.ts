import type { Tx } from "./db.js";
import { AppError, ensure } from "./errors.js";
import { getCalendar } from "./holiday-calendar.js";
import { createKm100Context, evaluateKm100 } from "./holiday-domain.js";

export async function tripKm100(
  tx: Tx,
  trip: { departureAt: Date; arrivalAt: Date; startKm: number; endKm: number },
  input: { km100?: number | null; km100CalendarToken?: string },
  options: { keepPending?: boolean; resolve?: boolean } = {},
) {
  const preview = evaluateKm100(await getCalendar(tx), trip);
  ensure(
    !input.km100CalendarToken ||
      input.km100CalendarToken === preview.calendarToken,
    409,
    "El calendario de feriados cambió. Revisá nuevamente los kilómetros al 100%.",
    "KM100_CALENDAR_CHANGED",
  );
  if (options.resolve)
    ensure(
      preview.mode !== "PENDING",
      409,
      "Confirmá los feriados de los años del viaje antes de resolverlo.",
      "KM100_CALENDAR_PENDING",
    );
  const distance = trip.endKm - trip.startKm;
  if (input.km100 != null && (input.km100 < 0 || input.km100 > distance))
    throw new AppError(400, "Revisá los kilómetros al 100%.", "KM100_RANGE", {
      km100: "Deben estar entre 0 y la distancia total del viaje.",
    });
  let value = preview.suggestedKm;
  if (value === null) {
    if (input.km100 == null)
      throw new AppError(
        400,
        "Indicá los kilómetros recorridos al 100%.",
        "KM100_REQUIRED",
        {
          km100:
            "Ingresá los kilómetros recorridos en los horarios indicados, o 0 si no circulaste.",
        },
      );
    value = input.km100;
  } else if (input.km100 != null && input.km100 !== value) {
    throw new AppError(
      400,
      "El valor no coincide con el horario del viaje.",
      "KM100_RANGE",
      {
        km100: `Para este viaje corresponden ${value} km al 100%. Revisá las fechas y el odómetro.`,
      },
    );
  }
  return {
    km100: value,
    km100Context: createKm100Context({
      ...preview,
      ...(options.keepPending && !options.resolve
        ? { mode: "PENDING" as const }
        : {}),
    }),
  };
}
