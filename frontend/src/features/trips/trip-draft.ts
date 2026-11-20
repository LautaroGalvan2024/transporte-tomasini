import type { Km100Preview, Role, Trip } from "../../types.ts";
import { tripDateForRequest } from "../../trip-date.ts";

export type TripFormValues = {
  truckId: string;
  trailerId: string;
  driverId: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  mileageMode: Trip["mileageMode"];
  distanceKm: string;
  startKm: string;
  endKm: string;
  km100: string;
  controlCount: string;
  allowance: string;
  notes: string;
};
export const emptyValues = (): TripFormValues => ({
  truckId: "",
  trailerId: "",
  driverId: "",
  origin: "",
  destination: "",
  departureAt: "",
  arrivalAt: "",
  mileageMode: "ODOMETER",
  distanceKm: "",
  startKm: "",
  endKm: "",
  km100: "",
  controlCount: "0",
  allowance: "",
  notes: "",
});

export function draftMileage(values: TripFormValues) {
  const errors: Record<string, string> = {};
  const validKm = (value: string) =>
    /^\d+$/.test(value) && Number(value) <= 9_999_999;
  if (values.mileageMode === "DISTANCE") {
    if (!validKm(values.distanceKm))
      errors.distanceKm =
        "Ingresá los kilómetros recorridos, entre 0 y 9.999.999.";
    return {
      errors,
      distance: errors.distanceKm ? null : Number(values.distanceKm),
    };
  }
  if (!validKm(values.startKm))
    errors.startKm = "Ingresá una lectura de salida entre 0 y 9.999.999 km.";
  if (!validKm(values.endKm))
    errors.endKm = "Ingresá una lectura de llegada entre 0 y 9.999.999 km.";
  if (errors.startKm || errors.endKm) return { errors, distance: null };
  const distance = Number(values.endKm) - Number(values.startKm);
  if (distance < 0)
    errors.endKm = "El kilometraje final debe ser igual o mayor al inicial.";
  return { errors, distance: distance < 0 ? null : distance };
}

export function tripToDraft(
  trip: Trip,
  localInput: (instant: string) => string,
): TripFormValues {
  return {
    truckId: trip.truckId,
    trailerId: trip.trailerId || "",
    driverId: trip.driverId,
    origin: trip.origin,
    destination: trip.destination,
    departureAt: localInput(trip.departureAt),
    arrivalAt: localInput(trip.arrivalAt),
    mileageMode: trip.mileageMode,
    distanceKm: trip.mileageMode === "DISTANCE" ? String(trip.distanceKm) : "",
    startKm: trip.startKm?.toString() ?? "",
    endKm: trip.endKm?.toString() ?? "",
    km100: trip.km100?.toString() ?? "",
    controlCount: trip.controlCount?.toString() ?? "",
    allowance: trip.allowance == null ? "" : String(trip.allowance),
    notes: trip.notes || "",
  };
}

type MileageInput =
  | { startKm: number; endKm: number }
  | { mileageMode: "DISTANCE"; distanceKm: number };

type TripRequestFields = MileageInput & {
  truckId: string;
  trailerId: string | null;
  driverId?: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  km100?: number;
  km100CalendarToken?: string;
  km100Resolve?: true;
  controlCount: number | null;
  allowance: number | null;
  notes: string | null;
};

export type CreateTripRequest = Readonly<
  TripRequestFields & { clientRequestId: string; version?: never }
>;
export type UpdateTripRequest = Readonly<
  TripRequestFields & { version: number; clientRequestId?: never }
>;
export type TripWriteRequest = CreateTripRequest | UpdateTripRequest;
export type TripWriteMode =
  | { kind: "create"; clientRequestId: string }
  | { kind: "update"; version: number };

export type TripPreviewRequest = MileageInput &
  Pick<TripRequestFields, "departureAt" | "arrivalAt">;

type StoredTripDates = Pick<Trip, "departureAt" | "arrivalAt">;

export function tripPreviewRequest(
  values: TripFormValues,
  baseline: TripFormValues,
  savedTrip?: StoredTripDates | null,
): TripPreviewRequest {
  return {
    departureAt: tripDateForRequest(
      values.departureAt,
      baseline.departureAt,
      savedTrip?.departureAt,
    ),
    arrivalAt: tripDateForRequest(
      values.arrivalAt,
      baseline.arrivalAt,
      savedTrip?.arrivalAt,
    ),
    ...(values.mileageMode === "DISTANCE"
      ? {
          mileageMode: "DISTANCE" as const,
          distanceKm: Number(values.distanceKm),
        }
      : { startKm: Number(values.startKm), endKm: Number(values.endKm) }),
  };
}

export function tripFromDraft(
  values: TripFormValues,
  context: {
    baseline: TripFormValues;
    savedTrip: StoredTripDates | null;
    role: Role;
    evaluateKm: boolean;
    preview: Km100Preview | null;
    resolveKm100: boolean;
    mode: TripWriteMode;
  },
): TripWriteRequest {
  const fields: TripRequestFields = {
    truckId: values.truckId,
    trailerId: values.trailerId || null,
    driverId: context.role === "ADMIN" ? values.driverId : undefined,
    origin: values.origin.trim(),
    destination: values.destination.trim(),
    ...tripPreviewRequest(values, context.baseline, context.savedTrip),
    km100: context.evaluateKm ? Number(values.km100) : undefined,
    controlCount:
      values.controlCount === "" ? null : Number(values.controlCount),
    allowance:
      values.allowance === ""
        ? null
        : Number(values.allowance.replace(",", ".")),
    notes: values.notes.trim() || null,
    km100CalendarToken: context.evaluateKm
      ? context.preview?.calendarToken
      : undefined,
    ...(context.resolveKm100 ? { km100Resolve: true } : {}),
  };
  // Every request field is scalar. Freezing this snapshot keeps an ambiguous
  // retry independent of subsequent draft/preview changes, including its UUID.
  return context.mode.kind === "create"
    ? Object.freeze({
        ...fields,
        clientRequestId: context.mode.clientRequestId,
      })
    : Object.freeze({ ...fields, version: context.mode.version });
}

export function reuseTripAttempt(
  pending: TripWriteRequest | null,
  create: () => TripWriteRequest,
): TripWriteRequest {
  return pending ?? create();
}

export function tripErrorSection(fields: Record<string, string>) {
  return Object.keys(fields).some(
    (key) => !["allowance", "notes"].includes(key),
  )
    ? ("trip" as const)
    : ("extras" as const);
}

export function tripSaveFailure(error: {
  status: number;
  code: string;
  message: string;
}) {
  return {
    clearPending: error.status > 0 && error.status < 500,
    conflict: error.code === "VERSION_CONFLICT",
    refreshPreview: error.code === "KM100_CALENDAR_CHANGED",
    message:
      error.status === 0 || error.status >= 500
        ? "No pudimos confirmar el guardado. Reintentá el mismo envío para comprobarlo sin duplicar el viaje."
        : error.message,
  };
}
