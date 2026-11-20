import { AppError, ensure } from "./errors.js";

export type TripMileage = {
  startKm: number | null;
  endKm: number | null;
  manualDistanceKm: number | null;
};
export type TimedTripMileage = TripMileage & {
  departureAt: Date;
  arrivalAt: Date;
};

export function tripDistance(trip: TripMileage) {
  if (trip.manualDistanceKm !== null) return trip.manualDistanceKm;
  if (trip.endKm === null || trip.startKm === null)
    throw new Error("El viaje tiene lecturas incompletas.");
  return trip.endKm - trip.startKm;
}

export function totalTripDistance(sum: TripMileage) {
  return (sum.manualDistanceKm ?? 0) + (sum.endKm ?? 0) - (sum.startKm ?? 0);
}

type MileageInput = {
  mileageMode?: "ODOMETER" | "DISTANCE";
  distanceKm?: number;
  startKm?: number;
  endKm?: number;
};

export function writeMileage(
  input: MileageInput,
  admin: boolean,
  old?: TripMileage,
): TripMileage {
  const storedMode =
    old && (old.manualDistanceKm === null ? "ODOMETER" : "DISTANCE");
  const mode = input.mileageMode ?? storedMode ?? "ODOMETER";
  ensure(
    admin ||
      (mode !== "DISTANCE" &&
        storedMode !== "DISTANCE" &&
        input.distanceKm === undefined),
    403,
    "Solo administración puede cargar o corregir viajes con kilómetros directos.",
  );
  ensure(
    !storedMode || mode === storedMode,
    400,
    "El método de carga se elige al crear el viaje.",
    "MILEAGE_MODE_FIXED",
  );
  if (mode === "DISTANCE") {
    ensure(
      input.startKm === undefined && input.endKm === undefined,
      400,
      "Con kilómetros directos no se informan odómetros.",
    );
    const distance = input.distanceKm ?? old?.manualDistanceKm;
    if (distance == null)
      throw new AppError(
        400,
        "Ingresá los kilómetros recorridos.",
        "INVALID_REQUEST",
        {
          distanceKm: "Indicá la distancia recorrida.",
        },
      );
    return { startKm: null, endKm: null, manualDistanceKm: distance };
  }
  ensure(
    input.distanceKm === undefined,
    400,
    "Para informar kilómetros directos, elegí ese método al crear el viaje.",
  );
  const startKm = input.startKm ?? old?.startKm;
  const endKm = input.endKm ?? old?.endKm;
  if (startKm == null || endKm == null)
    throw new AppError(
      400,
      "Ingresá los odómetros al salir y al llegar.",
      "INVALID_REQUEST",
      {
        ...(startKm == null ? { startKm: "Falta la lectura de salida." } : {}),
        ...(endKm == null ? { endKm: "Falta la lectura de llegada." } : {}),
      },
    );
  return { startKm, endKm, manualDistanceKm: null };
}
