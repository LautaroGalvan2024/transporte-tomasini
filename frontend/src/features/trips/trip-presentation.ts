import type { Trip } from "../../types.ts";

export function tripStatusPresentation(
  trip: Pick<Trip, "status" | "reviewedAt">,
) {
  if (trip.status === "CANCELLED")
    return { tone: "danger", icon: "cancelled", label: "Anulado" } as const;
  if (trip.reviewedAt)
    return { tone: "success", icon: "reviewed", label: "Revisado" } as const;
  return { tone: "neutral", icon: "pending", label: "Por revisar" } as const;
}

export type TripStatusPresentation = ReturnType<typeof tripStatusPresentation>;

export function tripRowPresentation(
  trip: Trip,
  format: {
    date: (value: string) => string;
    kilometers: (value: number) => string;
  },
) {
  const pending = trip.km100Context?.mode === "PENDING";
  return {
    trip,
    date: format.date(trip.departureAt),
    time: new Date(trip.departureAt).toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    }),
    driverName: trip.driver.name,
    truckPlate: trip.truck.plate,
    trailerLabel: trip.trailer
      ? `Acoplado ${trip.trailer.plate}`
      : "Sin acoplado registrado",
    distanceKm: format.kilometers(trip.distanceKm),
    km100: trip.km100 == null ? null : format.kilometers(trip.km100),
    km100DesktopSuffix: pending ? " · por validar" : "",
    km100MobileSuffix: pending ? " · pendiente de validar" : "",
    status: tripStatusPresentation(trip),
  };
}
