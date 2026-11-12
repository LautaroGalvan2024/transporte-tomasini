import { AppError, ensure } from "./errors.js";
import { BUSINESS_TIMEZONE } from "./config.js";

export function businessDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function businessHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: BUSINESS_TIMEZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
}
export function dayStart(day: string) {
  return new Date(`${day}T00:00:00-03:00`);
}
export function dayAfter(day: string) {
  return new Date(dayStart(day).getTime() + 86_400_000);
}
export function dateOnly(date: Date | null | undefined) {
  return date?.toISOString().slice(0, 10) ?? null;
}
export function calculateStatus(
  obligation: {
    dueDate: Date | null;
    dueKm: number | null;
    warningDays: number;
    warningKm: number;
    intervalMonths?: number | null;
    intervalKm?: number | null;
  },
  odometer: number | null,
  now = new Date(),
) {
  const daysRemaining = obligation.dueDate
    ? Math.round(
        (Date.parse(dateOnly(obligation.dueDate)!) -
          Date.parse(businessDay(now))) /
          86_400_000,
      )
    : null;
  const kmRemaining =
    obligation.dueKm !== null && odometer !== null
      ? obligation.dueKm - odometer
      : null;
  const odometerMissing =
    odometer === null &&
    (obligation.dueKm !== null || obligation.intervalKm != null);
  const status =
    (daysRemaining !== null && daysRemaining <= 0) ||
    (kmRemaining !== null && kmRemaining <= 0)
      ? "OVERDUE"
      : (daysRemaining !== null && daysRemaining <= obligation.warningDays) ||
          (kmRemaining !== null && kmRemaining <= obligation.warningKm)
        ? "UPCOMING"
        : odometerMissing ||
            (daysRemaining === null && kmRemaining === null) ||
            (obligation.intervalMonths != null &&
              obligation.dueDate === null) ||
            (obligation.intervalKm != null && obligation.dueKm === null)
          ? "UNCONFIGURED"
          : "OK";
  return { status, daysRemaining, kmRemaining, odometerMissing } as const;
}
export interface Reading {
  at: Date;
  km: number;
  label: string;
}
export function validateReadings(readings: Reading[]) {
  const sorted = [...readings].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.km - b.km,
  );
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1],
      current = sorted[i];
    if (
      current.km < previous.km ||
      (current.at.getTime() === previous.at.getTime() &&
        current.km !== previous.km)
    ) {
      throw new AppError(
        409,
        `Los kilómetros no coinciden con el historial: ${previous.label} (${previous.km.toLocaleString("es-AR")} km) y ${current.label} (${current.km.toLocaleString("es-AR")} km). Revisá fecha y odómetro.`,
        "ODOMETER_CONFLICT",
      );
    }
  }
}
export function validateTripDates(
  data: { departureAt: Date; arrivalAt: Date; startKm: number; endKm: number },
  now = new Date(),
) {
  ensure(
    data.endKm >= data.startKm,
    400,
    "El kilometraje final debe ser igual o mayor al inicial.",
    "ODOMETER_RANGE",
  );
  ensure(
    data.arrivalAt >= data.departureAt,
    400,
    "La llegada debe ser posterior a la salida.",
    "DATE_RANGE",
  );
  ensure(
    data.arrivalAt.getTime() <= now.getTime() + 60_000,
    400,
    "Solo se pueden cargar viajes ya realizados.",
    "FUTURE_TRIP",
  );
  ensure(
    data.arrivalAt > data.departureAt || data.endKm === data.startKm,
    400,
    "Un viaje con kilómetros recorridos debe tener una llegada posterior a la salida.",
    "DATE_RANGE",
  );
}
export function nextMonthDate(date: string, months: number) {
  const current = new Date(`${date}T00:00:00Z`);
  const target = new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(current.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}
